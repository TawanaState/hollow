# Time and units

## The metric: F

> **1 F (frame) = 1 simulation tick = `FRAME_MS` milliseconds.**

`FRAME_MS` is defined once, in [`src/core/time.ts`](../src/core/time.ts), as `1000 / 60` (16.67 ms).

Every duration in the game is written in F: skill startup/active/recovery, hitstop, hitstun, blockstun, cooldowns, buffers, guard regen delays, and the lifetime of every visual effect and sound. There are no seconds or milliseconds in content.

**To change the game's pace**, change `FRAME_MS`. Everything speeds up or slows down together, so tuning stays coherent. `fToMs(f)` and `msToF(ms)` convert when you need to think in real time.

| F | at 60 F/s | feel |
|---|---|---|
| 1 | 17 ms | one tick |
| 4 | 67 ms | light-hit freeze |
| 6 | 100 ms | input buffer, parry window |
| 11 | 183 ms | heavy-hit freeze |
| 18 | 300 ms | crush-hit freeze |
| 60 | 1 s | |

The client runs the sim on a fixed timestep (`session.update`), independent of the screen's refresh rate. Rendering interpolates between sim steps, so it is smooth on 144 Hz and 30 Hz displays alike while the game logic is identical.

Visual effects use two clocks: a *real* clock (slow-mo itself) and a *scaled* clock (everything else), so slow-mo slows sparks and shake too. Hitstop does not slow effects: the world freezes while the screen shakes, which is what makes hits feel heavy.

## Distance and size units

World units, not pixels. The stage is `halfWidth × 2 = 1520` wide; the camera shows about 1000 to 1900 of it depending on how close the fighters are. Speeds are units per F.

**`BODY_SCALE`** (`content/config.ts`) is how tall fighters are. `1` is a reference build ~176 units tall; the default `0.82` gives ~145. Hitbox and hurtbox numbers are authored for the reference size, and `BODY_SCALE` scales the skeleton, hurtboxes, hitboxes and push-box together so they can never disagree. Change one number to make everyone taller or shorter.

Heights are measured up from the feet (`y = 0` is the ground). Facing is `+1` (right) or `-1` (left); a hitbox's `x` is "forward from the body" and is mirrored automatically.
