import { describe, expect, it } from 'vitest';
import { InputRouter, NullSource, QueueSource, ScriptedSource } from '../src/core/control.ts';
import { EventBus } from '../src/core/events.ts';
import { Game } from '../src/core/game.ts';
import { Btn } from '../src/core/input.ts';
import { describeEvent } from '../src/core/log.ts';
import type { GameEvent } from '../src/core/types.ts';
import { RULES } from '../src/content/config.ts';
import { createLoopbackPair } from '../src/net/transport.ts';
import { decodeClient, encode } from '../src/net/protocol.ts';
import type { ClientMsg, ServerMsg } from '../src/net/protocol.ts';

const goEvent: GameEvent = { t: 'ROUND_GO', f: 1 };
const koEvent: GameEvent = { t: 'KO', f: 2, id: 1, winner: 0, x: 0, y: 70 };

describe('EventBus', () => {
  it('delivers typed events to the right listeners, and unsubscribes', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const offKo = bus.on('KO', (e) => seen.push(`ko:${e.winner}`));
    bus.onAny((e) => seen.push(`any:${e.t}`));
    bus.emit(goEvent);
    bus.emit(koEvent);
    offKo();
    bus.emit(koEvent);
    expect(seen).toEqual(['any:ROUND_GO', 'ko:0', 'any:KO', 'any:KO']);
  });

  it('once fires once, order controls sequence, a throwing listener does not break others', () => {
    const bus = new EventBus();
    const errors: unknown[] = [];
    bus.onError = (e) => errors.push(e);
    const seen: string[] = [];
    bus.once('ROUND_GO', () => seen.push('once'));
    bus.on('ROUND_GO', () => seen.push('late'), { order: -1 });
    bus.on('ROUND_GO', () => seen.push('early'), { order: 5 });
    bus.on('ROUND_GO', () => {
      throw new Error('boom');
    });
    bus.emit(goEvent);
    bus.emit(goEvent);
    expect(seen).toEqual(['early', 'once', 'late', 'early', 'late']);
    expect(errors).toHaveLength(2);
  });
});

describe('InputRouter and sources', () => {
  it('routes per slot and swaps sources live', () => {
    const r = new InputRouter();
    r.attach(0, new ScriptedSource([Btn.LIGHT, Btn.HEAVY]));
    expect(r.poll(0)).toEqual([Btn.LIGHT, 0]);
    expect(r.poll(1)).toEqual([Btn.HEAVY, 0]);
    const detach = r.attach(1, new ScriptedSource(() => Btn.GUARD));
    expect(r.poll(2)[1]).toBe(Btn.GUARD);
    detach();
    expect(r.sourceOf(1)).toBeInstanceOf(NullSource);
  });

  it('QueueSource keeps order, repeats the last frame when empty, and keeps taps when catching up', () => {
    const q = new QueueSource('t', 2);
    q.push(Btn.RIGHT);
    q.push(Btn.RIGHT | Btn.LIGHT);
    q.push(Btn.RIGHT); // over depth: oldest dropped, its buttons merged forward
    expect(q.poll() & Btn.LIGHT).toBe(Btn.LIGHT);
    expect(q.poll()).toBe(Btn.RIGHT);
    expect(q.poll()).toBe(Btn.RIGHT); // repeat last
  });
});

describe('Game host', () => {
  it('ticks the sim, publishes events on the bus, and records inputs', () => {
    const game = new Game();
    const seen: string[] = [];
    game.bus.onAny((e) => seen.push(e.t));
    game.router.attach(0, new ScriptedSource(() => 0));
    for (let i = 0; i < RULES.introF + 3; i++) game.tick();
    expect(seen).toContain('ROUND_START');
    expect(seen).toContain('ROUND_GO');
    expect(game.recorder.inputs).toHaveLength(RULES.introF + 3);
  });
});

describe('log', () => {
  it('describes events as readable lines', () => {
    expect(describeEvent(koEvent)).toBe('f2 P2 K.O. P1 wins');
  });
});

describe('transport and protocol', () => {
  it('loopback delivers typed messages both ways', async () => {
    const [client, server] = createLoopbackPair<ClientMsg, ServerMsg>();
    const got: ServerMsg[] = [];
    client.onMessage((m) => got.push(m));
    const heard: ClientMsg[] = [];
    server.onMessage((m) => heard.push(m));
    client.send({ t: 'ping', ts: 5 });
    server.send({ t: 'pong', ts: 5 });
    await Promise.resolve();
    await Promise.resolve();
    expect(heard).toEqual([{ t: 'ping', ts: 5 }]);
    expect(got).toEqual([{ t: 'pong', ts: 5 }]);
  });

  it('decodeClient accepts valid messages and rejects junk', () => {
    expect(decodeClient(encode({ t: 'input', seq: 1, bits: Btn.LIGHT }))).toEqual({ t: 'input', seq: 1, bits: Btn.LIGHT });
    expect(decodeClient('nope')).toBeNull();
    expect(decodeClient('{"t":"input","seq":"x"}')).toBeNull();
    expect(decodeClient('{"t":"explode"}')).toBeNull();
    expect(decodeClient('{"t":"input","seq":1,"bits":99999999}')).toEqual({ t: 'input', seq: 1, bits: 99999999 & 0x1ff });
  });
});
