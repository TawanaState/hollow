# Events and input API

Two public contracts: **what the game tells you** (events) and **how you tell the game what to do** (input). Both are in [`src/core/`](../src/core), exported together from [`src/core/index.ts`](../src/core/index.ts). They are plain data, JSON-safe, and identical in the browser and on the server.

## Listening: `GameEvent` and `EventBus`

`step()` returns `GameEvent[]`; `Game.tick()` also publishes them on `game.bus`.

```ts
const off = game.bus.on('HIT', (e) => {          // e is narrowed to the HIT event
  console.log(e.atk, 'hit', e.def, 'for', e.damage, e.tier, e.counter);
});
game.bus.onAny((e) => log(e));                    // everything
game.bus.once('KO', (e) => showWinner(e.winner));
game.bus.on('HIT', fn, { order: 10 });            // higher order runs first
off();                                            // unsubscribe
```

A listener that throws goes to `bus.onError` and does not stop the others or the game.

### The events

Every event has `t` (type) and `f` (world frame). Defined in [`core/types.ts`](../src/core/types.ts).

| `t` | Fields | When |
|---|---|---|
| `ROUND_START` / `ROUND_GO` | | intro begins / "FIGHT" |
| `STATE` | `id, from, to` | any fighter state change (noisy; the HUD and logs ignore it) |
| `SKILL` | `id, skill, tier` | an attack starts |
| `HIT` | `atk, def, skill, tier, damage, x, y, dir, counter, side, launch, combo, comboDamage, hitstop` | an attack connected |
| `BLOCK` | `atk, def, skill, tier, chip, x, y, dir, hitstop` | an attack was blocked |
| `PARRY` | `atk, def, skill, tier, x, y, dir, hitstop` | a perfect guard |
| `GUARD_BREAK` | `id, x, y` | guard hit zero |
| `JUMP` / `LAND` / `DASH` | `id, x` (+ `power` / `dir`) | movement |
| `KNOCKDOWN` | `id, x` | hit the floor |
| `COMBO_END` | `id, hits, damage` | the victim `id` recovered |
| `KO` | `id, winner, x, y` | a fighter died (`x, y` is where). `winner` is `-1` for a draw |

`x, y` are the point of impact in world space, `dir` the direction the attack travelled, `side` is `front` or `back` (a cross-up).

### Readable text: `describeEvent`

```ts
describeEvent(e)   // "f155 P1 Jab HITS P2 -35hp (light) combo 1"   (null for noisy events)
```

This is the stream a future AI observer reads instead of looking at the screen. Try it live: open the game with `?log` and watch the browser console, or `hollow.log(true)`.

## Driving: `InputSource` and `InputRouter`

Every fighter is driven by an `InputSource`. The sim never knows or cares whether it is a keyboard, a phone, a recording, a bot or a remote player.

```ts
interface InputSource {
  readonly kind: string;
  poll(frame: number): InputFrame;   // called once per sim frame: what is HELD right now
  dispose?(): void;
}
```

An `InputFrame` is a bitmask of `Btn.LEFT | RIGHT | UP | DOWN | LIGHT | HEAVY | SKILL | GUARD | DASH`. Send what is *held*; the sim detects presses and buffers them itself.

```ts
game.router.attach(0, keyboard.source(P1_KEYS));            // seat 0 = keyboard
const detach = game.router.attach(1, new QueueSource());    // seat 1 = fed from outside
detach();                                                    // seat 1 goes back to NullSource
game.router.onAttach((slot, src) => ...);                    // notified of swaps
```

Sources provided:

| Source | For |
|---|---|
| `NullSource` | an empty seat, a training dummy |
| `ScriptedSource(array \| fn)` | tests, demos, replays |
| `QueueSource` | anything that delivers one frame at a time from outside: network clients, an AI that thinks asynchronously. Queued so a tap shorter than a frame is never lost; repeats the last frame if it runs dry |
| `Keyboard.source(...maps)` (client) | keyboard |
| `TouchPad` (client) | on-screen phone controls: a floating thumb-stick plus action buttons |

**To add a bot or AI later:** implement `InputSource` (or push into a `QueueSource`) and `attach` it. It reads `game.world` and `game.bus` like any other listener. Nothing in the sim changes.

## Hosting the game: `Game`

```ts
const game = new Game();                  // or new Game(sharedBus)
game.router.attach(0, ...); game.router.attach(1, ...);
game.bus.on('HIT', ...);
setInterval(() => game.tick(), FRAME_MS); // 1 tick = 1 F
game.restart();                           // new match, keeps listeners and sources
game.recorder.toReplay();                 // { version: 1, inputs: [[p1, p2], ...] }
```

## Replays

The sim is deterministic, so a replay is just the inputs.

```ts
const { world, events } = runReplay(game.recorder.toReplay());          // re-run from scratch
runReplay(replay, 600);                                                  // ...up to frame 600
```

Use it for regression tests (`tests/sim.test.ts` does), bug reports, and later for training data.

## Pure sim, if you do not want the host

```ts
const world = createWorld();
const events = step(world, [Btn.RIGHT, 0]);     // one frame
```

Queries you may need: `hurtRect(f)`, `hitRects(f, skill)`, `relativeDir(f)`, `sideOf(a, b)`, `skillPhase(f)`, `isInvulnerable(f)`, `isAir(f)`, `opponentOf(world, f)`.

## Sending over the wire

See [networking.md](networking.md): `Transport<Out, In>` is the typed message pipe (`WebSocket` in production, `createLoopbackPair()` in tests), and [`net/protocol.ts`](../src/net/protocol.ts) is the single definition of every message.
