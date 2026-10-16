# Dev guide

## Commands

| | |
|---|---|
| `npm run dev` | Vite + the game WebSocket, hot reload, on your LAN (:5173) |
| `npm run play` | production build served with the WebSocket on :3000 |
| `npm run build` | typecheck, then build to `dist/` |
| `npm run typecheck` | three checks: client, core (no DOM/Node allowed), server |
| `npm test` | vitest: sim rules, events/input API, server rooms |
| `npm run logo` | regenerate the logo, favicon and maskable icon |
| `npm run icons` | render the PNG app icons from them (uses any installed Edge/Chrome) |

Requires Node 22+. The project uses TypeScript's `erasableSyntaxOnly` (no `enum`, no constructor parameter properties) and `verbatimModuleSyntax` (type imports must say `import type`), which is what lets Node run `server/` without a build step.

## URL parameters

| | |
|---|---|
| `?demo` | a scripted fight (`src/dev/demo.ts`), useful for screenshots and docs |
| `?demo&ff=157` | fast-forward N frames first, to land on a specific moment |
| `?autostart=local\|training\|online` (`&room=x`) | skip the menu |
| `?theme=light\|dark` | force a theme |
| `?touch` | show the on-screen touch controls on a desktop |
| `?hp=0.9,0.15` | start with these health ratios (to look at the tired stance) |
| `?server=wss://host` | use this game server for online play (remembered) |
| `?log` | print the readable event log to the console |

In the browser console: `hollow.world`, `hollow.session`, `hollow.bus`, `hollow.vfx`, `hollow.log(true)`, `hollow.onEvent(fn)`.

## Debugging a move

1. Press `` ` `` for hitboxes and the state/frame readout over each fighter.
2. Use **Training dummy** from the menu and repeat the move.
3. Use `/sandbox.html` to check the pose timeline of the skill.
4. Reproduce it in a test: build a world with `fight()` (see `tests/sim.test.ts`), feed inputs with `run`/`tap`, and assert on the events. Keep any bug as a test.

## Tests

* `tests/sim.test.ts`: hits, startup frames, hitstop, combos and cancels, blocking, parry, low vs standing guard, cross-ups, priority rules, invulnerability, K.O. and round reset, determinism and replay.
* `tests/api.test.ts`: `EventBus`, `InputRouter`, sources, `Game`, `describeEvent`, loopback transport, protocol decoding.
* `tests/server.test.ts`: seating, spectators, the authoritative loop producing hits, version rejection, promotion when a player leaves. All in-process.

## What is built, and what is not

Built: the deterministic sim, all content and effects, local 2-player, training dummy, WebSocket server with rooms, browser online client, phone controls, theming, sandbox, tests, docs.

**Not built yet** (by decision or because it needs your input):

* **AI / bot player.** The seam is ready: implement `InputSource` (see [events-and-input-api.md](events-and-input-api.md)) and attach it to a slot. `describeEvent` already produces the text log an LLM would read. Planned design: a slow "brain" (LLM, a few decisions per second, outputs a short plan) over a fast "reflex" layer (code, every frame).
* Client-side prediction / rollback netcode, WebRTC transport, delta snapshots.
* More skills, characters, stages, a proper tutorial. The first-pass move set (jab, cross, spin kick, straight, sweep, air kick, Hollow Rush) exists to prove the engine.
* The touch controls (floating stick plus buttons) are built and look right in landscape, but have not been play-tested on a real phone. Expect to tune stick thresholds and button sizes.
* Pose and VFX tuning. The poses are a first pass; the sandbox is there to refine them.
