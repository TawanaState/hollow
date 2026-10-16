# Networking

Online play is **server-authoritative**. Players send what they are holding; the server runs the one true simulation and sends back the world. Clients only draw.

```
 phone/browser ──input (60/s)──►  Room ── Game.tick() @ 60 F/s ──┐
 phone/browser ──input (60/s)──►   (server)                      │
        ▲                                                         │
        └──────── snapshot { world, events } (60/s) ◄────────────┘
```

## Running it

| Command | What you get |
|---|---|
| `npm run dev` | Vite dev server on **:5173** *and* the game WebSocket at `/ws` on the same port. Exposed on your LAN. One command |
| `npm run play` | builds, then runs the production server on **:3000** (static files + `/ws`). `PORT=4000 npm run server` to change it |

The server prints your WiFi addresses when it starts. On the same WiFi, open `http://<that address>:3000` (or `:5173` for dev) on each phone, tap **Play online**, and enter the same room code. The first two to join become **P1** and **P2**; later joiners spectate and take over a seat if someone leaves. If a phone cannot connect, allow Node through the Windows firewall for private networks.

The server is Node running the TypeScript directly (`--experimental-strip-types`), using the [`ws`](https://github.com/websockets/ws) library. It imports the very same `src/core` as the client, which is why the simulation is identical on both sides.

## Rooms

* A room is created when the first client says hello with its code (default `lobby`), and deleted when it empties.
* The sim only runs while **both seats are filled**. When a pairing forms, a fresh match starts. When a player leaves, the match resets and the room waits.
* One match per room; any number of rooms.

## Protocol

JSON text frames. The single source of truth is [`src/net/protocol.ts`](../src/net/protocol.ts). The server validates every client message (`decodeClient`) and drops anything malformed; payloads over 4 KB are refused.

**Client → server**

| Message | Meaning |
|---|---|
| `{t:'hello', v, name?, room?}` | first message. `v` must equal `PROTOCOL_VERSION` (1) |
| `{t:'input', seq, bits}` | one per frame: the buttons held (`Btn` bitmask) |
| `{t:'ping', ts}` | latency probe, answered with `pong` |

**Server → client**

| Message | Meaning |
|---|---|
| `{t:'welcome', v, room, slot, tickMs}` | `slot` is `0`, `1` or `'spectator'` |
| `{t:'roster', players, spectators, waiting}` | who is seated |
| `{t:'snapshot', tick, world, events}` | the full world after one frame, plus the events of that frame (~1 KB) |
| `{t:'pong', ts}` | |
| `{t:'error', code, message}` | e.g. `bad-version` |

## How it stays smooth

* **Inputs are queued per frame** (`QueueSource`, depth 4). One client frame becomes one server frame, so a quick tap is never lost. If the queue runs dry the last input repeats; if it floods, the oldest frames are dropped but their *buttons* are merged forward.
* **Snapshots go through a small jitter buffer** on the client (`OnlineSession`, target depth 2 frames), consumed at a steady 60/s regardless of packet timing. Events are published to the client's `EventBus` only when their snapshot is consumed, so effects and sound line up with what is drawn.
* The client renders by interpolating between consecutive snapshots, exactly as it does for a local sim.

## Transport abstraction

The game never touches a socket. [`net/transport.ts`](../src/net/transport.ts) defines:

```ts
interface Transport<Out, In> { isOpen; send(msg); onMessage(fn); onClose(fn); close(); }
```

`server/gameServer.ts` adapts a `ws` socket to it; `client/session.ts` adapts a browser `WebSocket`; tests use `createLoopbackPair()`. `Room` only sees `Transport`s, so it is tested in-process (`tests/server.test.ts`). Swapping in WebRTC means writing a new adapter, nothing else.

## Known limits (honest list)

* **No client-side prediction.** What you see is the server's state, so your own inputs feel delayed by your round-trip time plus about two frames. Fine on a LAN (a few ms); noticeable over the internet. The deterministic sim makes rollback netcode the natural upgrade.
* **Full snapshots, not deltas.** About 60 KB/s per client. Fine on WiFi.
* No accounts, no reconnect-into-seat, no TLS in the bundled server (put it behind a proxy for `wss`; the client already switches to `wss` on https pages).
* No rematch/ready handshake: rounds restart on their own after a K.O.
