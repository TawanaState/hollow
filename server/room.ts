import { QueueSource } from '../src/core/control.ts';
import { Game } from '../src/core/game.ts';
import { FRAME_MS } from '../src/core/time.ts';
import type { FighterId } from '../src/core/types.ts';
import { PROTOCOL_VERSION } from '../src/net/protocol.ts';
import type { ClientMsg, RosterEntry, ServerMsg, Slot } from '../src/net/protocol.ts';
import type { Transport } from '../src/net/transport.ts';

export type HelloMsg = Extract<ClientMsg, { t: 'hello' }>;

export type ClientLink = Transport<ServerMsg, ClientMsg>;

interface Client {
  link: ClientLink;
  name: string;
  slot: Slot;
  source: QueueSource | null;
}

/**
 * One match. Holds the authoritative Game, seats up to two players plus spectators,
 * and runs the sim at exactly 1 frame per FRAME_MS. Knows nothing about sockets:
 * it only sees Transports, so it is tested in-process with loopback pipes.
 *
 * The sim only runs while both seats are filled.
 */
export class Room {
  readonly game = new Game();
  private clients = new Set<Client>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  /** Called when the room has been empty (so the manager can drop it). */
  onEmpty: () => void = () => {};

  readonly name: string;

  constructor(name: string) {
    this.name = name;
    // Server-side matches do not need to hold on to every input forever.
    this.game.recording = false;
  }

  /** Seat a connection that has already said hello (the RoomManager reads the hello to pick the room). */
  admit(link: ClientLink, hello: HelloMsg): void {
    const client: Client = { link, name: hello.name?.trim() || 'player', slot: 'spectator', source: null };
    link.onMessage((msg) => {
      if (msg.t === 'input') client.source?.push(msg.bits);
      else if (msg.t === 'ping') link.send({ t: 'pong', ts: msg.ts });
    });
    link.onClose(() => this.leave(client));
    this.seat(client);
  }

  get playerCount(): number {
    return this.players().length;
  }

  get size(): number {
    return this.clients.size;
  }

  start(): void {
    if (this.timer) return;
    this.last = performance.now();
    this.acc = 0;
    this.timer = setInterval(() => this.pump(), 4);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Run as many frames as real time owes us (capped so a stall never spirals). */
  pump(now = performance.now()): void {
    this.acc = Math.min(this.acc + (now - this.last), FRAME_MS * 5);
    this.last = now;
    while (this.acc >= FRAME_MS) {
      this.acc -= FRAME_MS;
      this.tick();
    }
  }

  /** Advance exactly one frame and broadcast the result. Public so tests can drive it. */
  tick(): void {
    if (this.playerCount < 2) return;
    const events = this.game.tick();
    this.broadcast({ t: 'snapshot', tick: this.game.world.frame, world: this.game.world, events });
  }

  // ── seating ──

  private players(): Client[] {
    return [...this.clients].filter((c) => c.slot !== 'spectator');
  }

  private seat(client: Client): void {
    const taken = new Set(this.players().map((c) => c.slot));
    const free = ([0, 1] as FighterId[]).find((s) => !taken.has(s));
    this.clients.add(client);
    if (free !== undefined) {
      client.slot = free;
      client.source = new QueueSource(`remote:${client.name}`);
      this.game.router.attach(free, client.source);
    }
    client.link.send({ t: 'welcome', v: PROTOCOL_VERSION, room: this.name, slot: client.slot, tickMs: FRAME_MS });
    // A fresh pairing starts a fresh match.
    if (this.playerCount === 2) this.game.restart();
    this.broadcastRoster();
    if (this.playerCount === 2) this.broadcast({ t: 'snapshot', tick: this.game.world.frame, world: this.game.world, events: [] });
  }

  private leave(client: Client): void {
    if (!this.clients.delete(client)) return;
    if (client.slot !== 'spectator') {
      const slot = client.slot;
      const src = this.game.router.sourceOf(slot);
      if (src === client.source) this.game.router.attach(slot, new QueueSource('empty'));
      this.game.restart();
      // Promote a waiting spectator into the free seat.
      const next = [...this.clients].find((c) => c.slot === 'spectator');
      if (next) {
        next.slot = slot;
        next.source = new QueueSource(`remote:${next.name}`);
        this.game.router.attach(slot, next.source);
        next.link.send({ t: 'welcome', v: PROTOCOL_VERSION, room: this.name, slot, tickMs: FRAME_MS });
        if (this.playerCount === 2) this.game.restart();
      }
    }
    this.broadcastRoster();
    if (this.clients.size === 0) this.onEmpty();
  }

  private broadcastRoster(): void {
    const players: RosterEntry[] = this.players().map((c) => ({ slot: c.slot as FighterId, name: c.name }));
    const spectators = this.clients.size - players.length;
    this.broadcast({ t: 'roster', players, spectators, waiting: players.length < 2 });
  }

  private broadcast(msg: ServerMsg): void {
    for (const c of this.clients) if (c.link.isOpen) c.link.send(msg);
  }
}

/** Finds or creates rooms by code, and tidies up empty ones. */
export class RoomManager {
  private rooms = new Map<string, Room>();

  /** Handle a brand-new connection: wait for its `hello`, then seat it in the requested room. */
  accept(link: ClientLink): void {
    const off = link.onMessage((msg) => {
      if (msg.t !== 'hello') return;
      off();
      if (msg.v !== PROTOCOL_VERSION) {
        link.send({ t: 'error', code: 'bad-version', message: `server speaks protocol ${PROTOCOL_VERSION}` });
        link.close();
        return;
      }
      this.roomFor(msg.room?.trim() || 'lobby').admit(link, msg);
    });
  }

  private roomFor(name: string): Room {
    let room = this.rooms.get(name);
    if (!room) {
      const created = new Room(name);
      created.onEmpty = () => {
        created.stop();
        this.rooms.delete(name);
      };
      this.rooms.set(name, created);
      created.start();
      room = created;
    }
    return room;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  closeAll(): void {
    for (const r of this.rooms.values()) r.stop();
    this.rooms.clear();
  }
}
