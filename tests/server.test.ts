import { describe, expect, it } from 'vitest';
import { Btn } from '../src/core/input.ts';
import { RULES } from '../src/content/config.ts';
import { PROTOCOL_VERSION } from '../src/net/protocol.ts';
import type { ClientMsg, ServerMsg } from '../src/net/protocol.ts';
import { createLoopbackPair } from '../src/net/transport.ts';
import type { Transport } from '../src/net/transport.ts';
import { RoomManager } from '../server/room.ts';
import type { Room } from '../server/room.ts';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

interface TestClient {
  link: Transport<ClientMsg, ServerMsg>;
  got: ServerMsg[];
  of: <T extends ServerMsg['t']>(t: T) => Extract<ServerMsg, { t: T }>[];
}

function connect(mgr: RoomManager, room = 'test', name = 'x'): TestClient {
  const [client, server] = createLoopbackPair<ClientMsg, ServerMsg>();
  // The server side sends ServerMsg and receives ClientMsg.
  mgr.accept(server as unknown as Transport<ServerMsg, ClientMsg>);
  const got: ServerMsg[] = [];
  client.onMessage((m) => got.push(m));
  client.send({ t: 'hello', v: PROTOCOL_VERSION, room, name });
  return { link: client, got, of: (t) => got.filter((m): m is never => m.t === t) };
}

describe('room', () => {
  it('seats two players, then spectators, and tells everyone the roster', async () => {
    const mgr = new RoomManager();
    const a = connect(mgr, 'r1', 'ann');
    const b = connect(mgr, 'r1', 'bob');
    const c = connect(mgr, 'r1', 'cat');
    await flush();
    expect(a.of('welcome')[0].slot).toBe(0);
    expect(b.of('welcome')[0].slot).toBe(1);
    expect(c.of('welcome')[0].slot).toBe('spectator');
    const roster = c.of('roster').at(-1)!;
    expect(roster.players.map((p) => p.name)).toEqual(['ann', 'bob']);
    expect(roster.waiting).toBe(false);
    expect(roster.spectators).toBe(1);
    mgr.closeAll();
  });

  it('runs the authoritative sim from the players\' inputs and broadcasts snapshots with events', async () => {
    const mgr = new RoomManager();
    const a = connect(mgr, 'r2', 'ann');
    const b = connect(mgr, 'r2', 'bob');
    await flush();
    // Reach the room object through a tick: the first snapshot proves the sim is live.
    // Intro lasts RULES.introF frames; feed neutral input, then P1 jabs.
    const room = (mgr as unknown as { rooms: Map<string, Room> }).rooms.get('r2')!;
    room.stop(); // drive ticks by hand for determinism
    for (let i = 0; i < RULES.introF + 2; i++) {
      a.link.send({ t: 'input', seq: i, bits: 0 });
      b.link.send({ t: 'input', seq: i, bits: 0 });
      await flush();
      room.tick();
    }
    expect(room.game.world.phase).toBe('fight');
    room.game.world.fighters[0].x = -40;
    room.game.world.fighters[1].x = 40;
    a.link.send({ t: 'input', seq: 999, bits: Btn.LIGHT });
    await flush();
    for (let i = 0; i < 12; i++) {
      room.tick();
      a.link.send({ t: 'input', seq: 1000 + i, bits: 0 });
      await flush();
    }
    const snaps = b.of('snapshot');
    const events = snaps.flatMap((s) => s.events);
    expect(events.some((e) => e.t === 'HIT' && e.atk === 0)).toBe(true);
    expect(snaps.at(-1)!.world.fighters[1].hp).toBeLessThan(RULES.maxHp);
    mgr.closeAll();
  });

  it('rejects the wrong protocol version, answers pings, and drops empty rooms', async () => {
    const mgr = new RoomManager();
    const [client, server] = createLoopbackPair<ClientMsg, ServerMsg>();
    mgr.accept(server as unknown as Transport<ServerMsg, ClientMsg>);
    const got: ServerMsg[] = [];
    client.onMessage((m) => got.push(m));
    client.send({ t: 'hello', v: 999 });
    await flush();
    expect(got[0]).toMatchObject({ t: 'error', code: 'bad-version' });

    const p = connect(mgr, 'r3');
    await flush();
    p.link.send({ t: 'ping', ts: 42 });
    await flush();
    expect(p.of('pong')[0].ts).toBe(42);
    expect(mgr.roomCount).toBe(1);
    p.link.close();
    await flush();
    expect(mgr.roomCount).toBe(0);
    mgr.closeAll();
  });

  it('a player leaving frees the seat and the next spectator is promoted', async () => {
    const mgr = new RoomManager();
    const a = connect(mgr, 'r4', 'ann');
    connect(mgr, 'r4', 'bob');
    const c = connect(mgr, 'r4', 'cat');
    await flush();
    a.link.close();
    await flush();
    const welcomes = c.of('welcome');
    expect(welcomes.at(-1)!.slot).toBe(0);
    mgr.closeAll();
  });
});
