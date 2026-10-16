import { FRAME_MS, Game, NullSource } from '../core/index.ts';
import type { EventBus, GameEvent, InputSource, World } from '../core/index.ts';
import { PROTOCOL_VERSION, WS_PATH, decodeServer, encode } from '../net/protocol.ts';
import type { ClientMsg, RosterEntry, ServerMsg, Slot } from '../net/protocol.ts';
import type { Transport } from '../net/transport.ts';
import { Emitter } from '../net/transport.ts';
import { createWorld } from '../core/sim.ts';

/**
 * A Session is "where the world comes from": a local sim, or a server over the network.
 * The renderer, HUD, VFX and audio only ever see a Session, so they work unchanged for both.
 */
export interface Session {
  readonly kind: 'local' | 'online';
  readonly world: World;
  /** Publishes every GameEvent as it becomes visible. Subscribe VFX, audio, HUD, logs here. */
  readonly bus: EventBus;
  /** Advance by `dtMs` of real time (scaled by slow-mo). Returns interpolation alpha 0..1. */
  update(dtMs: number, timeScale: number): number;
  /** Called right before each world change, with the world as it was. */
  onStep(fn: (before: World) => void): void;
  dispose(): void;
}

/** Simulate locally. Two seats, each fed by any InputSource. */
export class LocalSession implements Session {
  readonly kind = 'local';
  readonly game: Game;
  private acc = 0;
  private stepListeners: ((w: World) => void)[] = [];

  constructor(bus: EventBus, p1: InputSource, p2: InputSource) {
    this.game = new Game(bus);
    this.game.router.attach(0, p1);
    this.game.router.attach(1, p2);
  }

  get world(): World {
    return this.game.world;
  }
  get bus(): EventBus {
    return this.game.bus;
  }

  onStep(fn: (before: World) => void): void {
    this.stepListeners.push(fn);
  }

  update(dtMs: number, timeScale: number): number {
    this.acc = Math.min(this.acc + dtMs * timeScale, FRAME_MS * 6);
    while (this.acc >= FRAME_MS) {
      this.acc -= FRAME_MS;
      for (const fn of this.stepListeners) fn(this.game.world);
      this.game.tick();
    }
    return this.acc / FRAME_MS;
  }

  dispose(): void {
    this.game.router.attach(0, new NullSource());
    this.game.router.attach(1, new NullSource());
  }
}

export type OnlineStatus = 'connecting' | 'waiting' | 'playing' | 'closed' | 'error';

export interface OnlineInfo {
  status: OnlineStatus;
  slot: Slot | null;
  room: string;
  players: RosterEntry[];
  spectators: number;
  /** Round-trip time in ms. */
  ping: number;
  message: string;
}

/** A Transport over a browser WebSocket. */
function browserTransport(url: string): Transport<ClientMsg, ServerMsg> & { onOpen(fn: () => void): void } {
  const ws = new WebSocket(url);
  const messages = new Emitter<ServerMsg>();
  const closes = new Emitter<void>();
  const opens = new Emitter<void>();
  ws.onopen = () => opens.emit();
  ws.onmessage = (ev) => {
    const msg = decodeServer(String(ev.data));
    if (msg) messages.emit(msg);
  };
  ws.onclose = () => closes.emit();
  ws.onerror = () => closes.emit();
  return {
    get isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },
    send: (m) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encode(m));
    },
    onMessage: (fn) => messages.on(fn),
    onClose: (fn) => closes.on(fn),
    onOpen: (fn) => void opens.on(fn),
    close: () => ws.close(),
  };
}

interface Snapshot {
  world: World;
  events: GameEvent[];
}

/**
 * Play on the server's simulation. We send our held buttons once per frame; the server
 * sends back the world and events once per frame. Snapshots go through a tiny jitter
 * buffer so playback is smooth even if packets arrive unevenly.
 */
export class OnlineSession implements Session {
  readonly kind = 'online';
  readonly bus: EventBus;
  info: OnlineInfo;
  onInfo: (info: OnlineInfo) => void = () => {};
  private current: World = createWorld();
  private pending: Snapshot[] = [];
  private acc = 0;
  private sendAcc = 0;
  private seq = 0;
  private link: ReturnType<typeof browserTransport>;
  private stepListeners: ((w: World) => void)[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly input: InputSource;

  /** Target number of buffered snapshots before we start consuming. */
  private static readonly TARGET_DEPTH = 2;

  constructor(opts: { room: string; name: string; input: InputSource; bus: EventBus; url?: string }) {
    this.bus = opts.bus;
    this.input = opts.input;
    this.info = { status: 'connecting', slot: null, room: opts.room, players: [], spectators: 0, ping: 0, message: 'Connecting…' };
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.link = browserTransport(opts.url ?? `${proto}//${location.host}${WS_PATH}`);
    this.link.onOpen(() => {
      this.link.send({ t: 'hello', v: PROTOCOL_VERSION, name: opts.name, room: opts.room });
      this.pingTimer = setInterval(() => this.link.send({ t: 'ping', ts: performance.now() }), 1000);
    });
    this.link.onMessage((m) => this.handle(m));
    this.link.onClose(() => {
      if (this.info.status !== 'error') this.set({ status: 'closed', message: 'Disconnected from server' });
      if (this.pingTimer) clearInterval(this.pingTimer);
    });
  }

  get world(): World {
    return this.current;
  }

  onStep(fn: (before: World) => void): void {
    this.stepListeners.push(fn);
  }

  /** Which fighter this device controls (null while connecting, 'spectator' if watching). */
  get slot(): Slot | null {
    return this.info.slot;
  }

  private set(patch: Partial<OnlineInfo>): void {
    this.info = { ...this.info, ...patch };
    this.onInfo(this.info);
  }

  private handle(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.set({ slot: m.slot, room: m.room, status: 'waiting', message: 'Waiting for an opponent…' });
        break;
      case 'roster':
        this.set({
          players: m.players,
          spectators: m.spectators,
          status: m.waiting ? 'waiting' : 'playing',
          message: m.waiting ? 'Waiting for an opponent…' : '',
        });
        if (m.waiting) {
          this.pending = [];
          this.current = createWorld();
        }
        break;
      case 'snapshot':
        this.pending.push({ world: m.world, events: m.events });
        break;
      case 'pong':
        this.set({ ping: Math.round(performance.now() - m.ts) });
        break;
      case 'error':
        this.set({ status: 'error', message: m.message });
        break;
    }
  }

  update(dtMs: number): number {
    // 1. send our input once per frame
    this.sendAcc = Math.min(this.sendAcc + dtMs, FRAME_MS * 6);
    while (this.sendAcc >= FRAME_MS) {
      this.sendAcc -= FRAME_MS;
      if (this.info.slot !== 'spectator' && this.info.slot !== null) {
        this.link.send({ t: 'input', seq: this.seq++, bits: this.input.poll(this.seq) });
      }
    }
    // 2. consume snapshots at a steady pace
    this.acc = Math.min(this.acc + dtMs, FRAME_MS * 6);
    while (this.acc >= FRAME_MS && this.pending.length > 0) {
      this.acc -= FRAME_MS;
      // too far behind? skip ahead gently
      const behind = this.pending.length - OnlineSession.TARGET_DEPTH;
      const take = behind > 3 ? 2 : 1;
      for (let i = 0; i < take && this.pending.length; i++) {
        const snap = this.pending.shift()!;
        for (const fn of this.stepListeners) fn(this.current);
        this.current = snap.world;
        this.bus.emitAll(snap.events);
      }
    }
    if (this.pending.length === 0) this.acc = Math.min(this.acc, FRAME_MS);
    return Math.min(1, this.acc / FRAME_MS);
  }

  dispose(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.link.close();
  }
}
