# Stickman Fighter: Project Proposal

## 1. SVG vs Canvas: my verdict

SVG is a good fit here. With two stickmen you have about 30 elements, so it's fast, it stays crisp at any screen size, and each limb can be styled with CSS (colour, glow, classes). Your instinct is right.

The catch is **CSS animations**. They run on the browser's own clock, not your game's clock, so a punch could look like it landed while the game logic says it hasn't. Fighting games need the visuals to follow the simulation exactly. So:

- **Fighters:** JS updates the SVG line positions every frame from the current pose (about 30 `setAttribute` calls, which is cheap).
- **Stage effects:** CSS handles screen shake, flashes, zoom, vignette, and speed-line overlays, using `transform` and `opacity` only so they run on the GPU.
- **Glow:** skip heavy `filter: blur()` on big areas, because phones struggle with it. Draw each limb twice (thick and faint, then thin and bright) for a cheap neon glow.
- **Particles:** if you ever need hundreds, add a Canvas layer on top.

Because rendering will be isolated behind one interface, we can swap SVG for Canvas later without touching the game.

## 2. The architecture: everything is "inputs in, events out"

```
 Keyboard ─┐
 Touch ────┤
 AI agent ─┼─►  InputFrame  ─►  CORE SIMULATION  ─►  state + EVENTS
 Network ──┘   (button bits)    (pure logic, no     (HIT, BLOCK, JUMP,
                                 DOM, 60 ticks/s)    SKILL_CAST, KO…)
                                                          │
                          ┌───────────┬──────────┬────────┴───┬───────────┐
                       Renderer     VFX       Sound       Logger      AI observer
                       (SVG)     (shake,etc) (WebAudio)  (replays)   (reads text log)
```

This gives you the separation of concerns you want:

- **Core sim** is pure logic with no browser code. It runs identically in the browser and on a Node server, which is what makes multiplayer clean.
- **Anything that produces a player is just an input source.** A keyboard, a phone, an AI, and a remote player all produce the same tiny `InputFrame`. The game never knows or cares which is which.
- **Sound, VFX, logs, and AI all subscribe to the event stream**, exactly like your "sound listens to events" idea. Adding a new listener never touches game logic.

## 3. Making it feel like anime fighting

- **Hit-stop:** freeze both fighters for 4 to 8 frames on impact. Nothing else makes hits feel as heavy.
- **Anticipation, impact, follow-through:** each move has startup, active, and recovery phases with their own easing, plus a brief smear or afterimage trail.
- **Skills defined as data:** name, input, cost, cooldown, frame data, hitbox, pose keyframes, movement, and which effects fire. A new skill is one entry, not new code.
- **Effects defined as data too:** "on HIT, shake 6px for 120ms, spawn spark, flash screen". Ultimates can darken the screen and zoom the camera.
- **Fighter state machine:** idle, walk, jump, attack, hitstun, blockstun, knockdown, KO. Cancel and chain rules live in the data.
- **Input buffering** so button presses just before a move ends still register, which is essential for fluid play.

**Pose engine:** poses are joint *angles* (forward kinematics), so bone lengths stay constant and limbs never stretch. Blend between key poses with easing curves. Gameplay hitboxes are authored per move as circles or boxes in the frame data, separate from the drawn limbs. This is how real fighting games do it, and it keeps the sim deterministic.

## 4. Proximity and collisions

Fighters on a stage are essentially a line, so this is cheap:

- Distance is computed every tick, bucketed into **range bands** (grapple, close, mid, far), and emits events like `ENTERED_CLOSE`. Both the AI and the camera (zoom in when close) use this.
- Hitbox vs hurtbox overlap decides hits. A push-box stops fighters walking through each other, and facing flips automatically.
- For more than two players, sort by x-position (sweep and prune). Brute force is fine until dozens of entities.

## 5. Multiplayer

For two phones on the same WiFi:

1. A small Node server on your laptop serves the game page and the WebSocket connection. Phones open `http://<laptop-ip>:3000`.
2. **WebSocket first.** On a local network its latency is a few milliseconds, which is plenty. WebRTC's advantage (UDP-like delivery) only matters over the open internet, and it needs signaling and STUN/TURN servers. We put networking behind a "transport" interface so we can add WebRTC later without a rewrite.
3. Players only send inputs (a few bytes). The server runs the authoritative sim and broadcasts state; clients interpolate for smoothness.
4. **Later upgrade:** rollback netcode (the GGPO style fighting games use), which is feasible because the sim is small and deterministic.

## 6. The AI as a real player

I want to be upfront about one constraint: a local LLM through Ollama takes hundreds of milliseconds to seconds to answer, and a fighting game ticks every 16ms. So it can't choose an action every frame. The fix keeps your "max speed" requirement intact with two layers:

- **Brain (LLM, about 2 to 4 decisions per second):** reads a compact text log of recent events plus current state (no screen, as you wanted), then outputs a short **plan** in constrained JSON, like `approach → jab, jab → heavy → retreat`. Ollama supports structured JSON output, so replies stay parseable.
- **Reflex layer (code, every tick):** executes the current plan frame-perfectly, buffers inputs, and falls back to simple rule-based behaviour if the brain hasn't answered yet, so the AI never stands idle.

The AI connects exactly like a human player and sends `InputFrame`s, running in the Node server process (which avoids browser CORS issues with Ollama). It sees the same information a human would. Difficulty becomes a dial: decision interval, reaction delay, and model size.

**Bigger long-term payoff:** every match is logged as inputs and events. That's a ready-made dataset for training a tiny neural policy that runs at full 60Hz in the browser, a genuine "max speed" AI.

*One thing to confirm:* I'm not sure which model you mean by "Jev". Which one is it? The design works with any Ollama model, but model size affects how fast the brain can think.

## 7. Sound

A sound engine subscribes to events, with a simple table like `HIT_HEAVY → low thud`, `SKILL_CAST → whoosh`. We can synthesize sounds with WebAudio so there are no audio files at all, and swap in samples later.

## 8. Keeping it maintainable

- **TypeScript + Vite**, in a small monorepo: `core/`, `client/`, `server/`, `ai-agent/`, `content/` (moves, skills, effects as data).
- **Fixed-timestep loop** (60 Hz logic, render interpolated), which keeps behaviour identical on slow and fast devices.
- **Replay tests:** since the sim is deterministic, we record inputs, replay them, and assert the final state. This catches regressions automatically and doubles as the replay feature.
- **Data validation** on all content so a typo in a skill file fails loudly.
- **Dev tools early:** a pose-editor sandbox where you tweak a pose and see it live. It makes creating skills far faster.

## 9. Level-by-level roadmap

| Level | Goal |
|---|---|
| 0 | Skeleton and pose sandbox: one stickman, live pose tweaking |
| 1 | Two keyboard players, punch and kick, hit-stop, health bars |
| 2 | Data-driven skills, event bus, VFX, WebAudio sound |
| 3 | Rule-based bot as a "player" (proves the input-source design) |
| 4 | Node server plus WebSocket: two phones on WiFi |
| 5 | Ollama brain driving the AI player |
| 6 | Rollback netcode, 3+ players, WebRTC, trained policy |

## 10. Main risks

- **Phone performance:** avoided by transform/opacity-only effects and cheap glow.
- **Cross-device determinism:** avoided by keeping trig and fancy math out of the sim, so it lives only in the renderer.
- **LLM latency:** handled by the plan plus reflex split.

If you like this direction, I'd suggest we start at **Level 0 to 1**: the pose sandbox and two keyboard fighters with hit-stop. That's the part that decides whether the game *feels* good, and everything else builds on it.