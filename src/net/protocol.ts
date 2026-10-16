import type { InputFrame } from '../core/input.ts';
import type { FighterId, GameEvent, World } from '../core/types.ts';

/**
 * WIRE PROTOCOL between a client and the game server. JSON text frames over a
 * WebSocket. Only this file defines what goes over the wire.
 *
 *   client -> server   hello, input (one per frame), ping
 *   server -> client   welcome, roster, snapshot (one per frame), pong, error
 *
 * The server owns the truth. Clients send what they HOLD; the server simulates and
 * sends back the world plus the events that happened that frame.
 */
export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 3000;
export const WS_PATH = '/ws';

export type Slot = FighterId | 'spectator';

export type ClientMsg =
  | { t: 'hello'; v: number; name?: string; room?: string }
  | { t: 'input'; seq: number; bits: InputFrame }
  | { t: 'ping'; ts: number };

export interface RosterEntry {
  slot: FighterId;
  name: string;
}

export type ServerMsg =
  | { t: 'welcome'; v: number; room: string; slot: Slot; tickMs: number }
  | { t: 'roster'; players: RosterEntry[]; spectators: number; waiting: boolean }
  | { t: 'snapshot'; tick: number; world: World; events: GameEvent[] }
  | { t: 'pong'; ts: number }
  | { t: 'error'; code: ErrorCode; message: string };

export type ErrorCode = 'bad-message' | 'bad-version' | 'room-closed';

export const encode = (msg: ClientMsg | ServerMsg): string => JSON.stringify(msg);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Parse and validate a message from a client. Returns null for anything malformed. */
export function decodeClient(raw: string): ClientMsg | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  switch (m.t) {
    case 'hello':
      if (typeof m.v !== 'number') return null;
      return {
        t: 'hello',
        v: m.v,
        name: typeof m.name === 'string' ? m.name.slice(0, 24) : undefined,
        room: typeof m.room === 'string' ? m.room.slice(0, 32) : undefined,
      };
    case 'input':
      if (typeof m.seq !== 'number' || typeof m.bits !== 'number') return null;
      return { t: 'input', seq: m.seq, bits: m.bits & 0x1ff };
    case 'ping':
      if (typeof m.ts !== 'number') return null;
      return { t: 'ping', ts: m.ts };
    default:
      return null;
  }
}

/** Parse a message from the server (clients trust it more, but still check the shape). */
export function decodeServer(raw: string): ServerMsg | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  return m as ServerMsg;
}
