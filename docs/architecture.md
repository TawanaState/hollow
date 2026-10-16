# Architecture

The one idea: **inputs in, events out.**

```
 Keyboard ─┐
 Touch ────┤                                   ┌─► Renderer (SVG)
 Remote ───┼─► InputSource ─► InputRouter ─►   │   VFX  (shake, sparks, invert...)
 Replay ───┤        (one InputFrame per F)     │   Audio (WebAudio synth)
 Bot* ─────┘                   │               ├─► HUD
                               ▼               │   Logger / Recorder
                        ┌─────────────┐        │   Network (server → clients)
                        │  step(world)│ ──► GameEvent[] ──► EventBus ─┘
                        │  pure sim   │                    AI observer*
                        └─────────────┘
 * not built yet; the interfaces are ready
```

## Layers and what may import what

```
src/content/   data only: config, impacts, states, skills, poses, anims, vfx, sfx, validate
src/core/      the sim and its API. No DOM, no clocks, no randomness, no trig
               (core/rng.ts is a seeded RNG for cosmetics, bots and tests; the sim never calls it)
src/net/       wire protocol + Transport interface. Runs anywhere
src/client/    browser only: skeleton/FK, renderer, camera, vfx, audio, hud, keyboard, touch, session, main
src/dev/       sandbox page, demo script
server/        Node: rooms, WebSocket adapter, static file server
tests/
```

* `core`, `content` and `net` are compiled with `tsconfig.core.json`, which has **no DOM and no Node types**. If someone reaches for `window` there, `npm run typecheck` fails. That is what keeps the same sim running in the browser and on the server.
* `client` and `server` may import `core`/`content`/`net`. Never the other way.
* `core` imports `content` for data. `content` never imports `core` logic.

## The pieces

| Piece | File | Job |
|---|---|---|
| `step(world, [in0, in1])` | `core/sim.ts` | advance 1 F, return the events |
| `Game` | `core/game.ts` | world + `EventBus` + `InputRouter` + `Recorder`; `tick()` = poll, step, publish |
| `EventBus` | `core/events.ts` | typed pub/sub for every `GameEvent` |
| `InputSource`, `InputRouter` | `core/control.ts` | anything that can drive a fighter, mapped to slots |
| `Session` | `client/session.ts` | where the client's world comes from: `LocalSession` (simulate here) or `OnlineSession` (server snapshots) |
| `Room`, `RoomManager` | `server/room.ts` | one authoritative `Game` per match, two seats plus spectators |
| `cueFor(event)` | `client/director.ts` | the only mapping from game event to effect/sound keys |

## Why it is shaped this way

* **Deterministic sim.** Only `+ − × ÷` on numbers (no `Math.sin`, `pow`, `random`), so the same inputs always give the same world on any machine. That gives replays and regression tests for free (`tests/sim.test.ts` replays 1500 frames and compares), and leaves room for rollback netcode later.
* **The sim never knows the screen.** Poses, animation, camera and effects read the world; they never change it. You can delete the whole `client/` folder and the game still runs on the server.
* **Everything is data.** Skills, states, impact tiers, effects and sounds are tables in `src/content/`. Adding a move is adding an entry; `validateContent()` runs at startup and in tests so a typo fails loudly.
* **One time unit.** See [time-and-units.md](time-and-units.md).
