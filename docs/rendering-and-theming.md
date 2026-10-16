# Rendering, effects and theming

## Why SVG

A fight is two stickmen: about a dozen `<polyline>`s and two circles. SVG is crisp at any size, styles with CSS, and the browser handles it easily. The renderer sits behind the `Session`/world interface, so a Canvas or WebGL renderer could replace it without touching the game.

**CSS animation is deliberately not used for gameplay motion**, because it runs on the browser's clock, not the game's, so a punch could look landed before the sim agrees. Fighters are redrawn every frame from the simulation; CSS only does things that are purely cosmetic (the HUD, text pops, banner).

## The skeleton

Poses are **joint angles in degrees**, never positions, so limbs keep their length ([`content/types.ts`](../src/content/types.ts) `Pose`).

* `0` = pointing straight down, positive = swinging toward the fighter's **front** (the side it faces); `90` = horizontal forward, `180` = straight up.
* Arms and thighs are absolute angles. `frontForearm` / `frontShin` (and the `back` ones) are **bends relative to the upper segment**; a knee normally bends negative.
* `lean` tilts the torso forward, `head` tilts the head, `shift` slides the body along the facing direction, `roll` rotates the whole body about the hip (flips, lying down).
* "Front" is the limb on the side the fighter faces, so one set of poses works in both directions: the renderer mirrors by `facing`.

[`client/skeleton.ts`](../src/client/skeleton.ts) `placeJoints(pose, facing, x, y)` does forward kinematics, applies `roll`, then **drops the body so its lowest point rests on the ground**. Feet never float or sink, whatever the pose, and `y` is the height of that lowest point. Bone lengths come from `BODY`, scaled by `BODY_SCALE`.

**Animation.** `samplePose(anim, t)` interpolates keyframes with easing; looping animations wrap. `pickAnim(fighter)` ([`client/anim.ts`](../src/client/anim.ts)) chooses the animation from sim state (walk vs walk-back by velocity, jump rise/peak/fall by vertical speed, the skill's own animation during an attack). When the choice changes, `PoseBlender` crossfades from the last drawn pose over the new animation's `blend` frames, so there are no pops.

## How fighters look and move on top of the animations

Three cosmetic layers sit between an animation and the screen. None of them touch the simulation, so they are not sent over the network and cannot affect fairness.

1. **Hand habits** ([`content/habits.ts`](../src/content/habits.ts), `client/habits.ts`). Each fighter rolls a random hand position that suits the moment: tucked or chin-high while standing or walking, a cover that fits while guarding, different poses in the air, flailing when hit. It glides between choices and re-rolls every few seconds, so fighters never look identical or frozen. During an attack only the hand that is *not* striking follows the habit (the striking arm is detected from the move's active pose). Uses the seeded `createRng` from [`core/rng.ts`](../src/core/rng.ts).
2. **Fatigue** (`fatigueOf` and `applyFatigue` in [`client/anim.ts`](../src/client/anim.ts)). The default stance is low and wide with the hands tucked: strong and grounded. As HP drops below about half, or guard runs low, a fighter gradually slumps: head hangs, hands drop, knees soften, breathing gets heavier. Neutral animations (idle, walking) show it; guarding and attacking still look sharp, so a tired fighter still fights properly.
3. **Line warp** (`client/figure.ts`). Limbs are drawn as gently bowed curves, not ruler-straight lines: a hint of quad on the thigh, calf on the shin, bicep, a curve in the lower back. Each is only about 2 units on a 40-unit bone, with a tiny per-fighter variation. The bulge stays on the right anatomical side when a fighter turns.

## Frame pipeline

```
session.update(dt)            sim steps 0..n times, events → bus → director → vfx/audio/hud
renderer.render(world, α)     interpolate positions by α, sample poses, draw SVG, camera, afterimages
vfx.update, hud.update        advance effects and bars
```

* **Interpolation:** positions blend between the previous and current sim step by `α`; animation time is `stateF + α`. During hitstop `α` is forced to 0 so the picture is genuinely frozen, and the victim trembles (`jitter`).
* **Camera** ([`client/camera.ts`](../src/client/camera.ts)) is a moving camera, not a fixed side view:
  * it closes in as the fighters get near (up to 2.1×) and pulls back as they separate, adapting to the screen's real width so a 4:3 tablet or a very wide phone still keeps both in frame;
  * it rises to follow jumps and launches, and looks slightly higher at faces when they are very close;
  * effects drive it: **dolly** (swing toward the impact while zooming in), **tilt** (roll a degree or two in the direction of the blow), zoom punch and shake. Heavy hits, parries, guard breaks and the K.O. use them (see `content/vfx.ts`);
  * the floor and sky are inside the camera, so the horizon tilts and moves with it, and the big background ring drifts at a different speed for depth;
  * with on-screen controls showing, the scene is raised a little so thumbs do not cover the feet.
* **Reflection:** the fighters group is reused with `<use>`, flipped and faded. No second set of elements.
* **Afterimages:** a ring of ghost figures copies the drawn pose every second frame while dashing or using a `fx.trail` skill, then fades.
* **Debug view** (`` ` ``): hurtboxes (blue), hitboxes (solid red when active, dashed otherwise), walls, and each fighter's state and frame.

## Effects pipeline

```
GameEvent ─► director.cueFor ─► { keys, ctx } ─► Vfx.fire(keys)  → recipes in content/vfx.ts
                                              └► Audio.playCue   → recipes in content/sfx.ts
```

Authoring is in [content-guide.md](content-guide.md#add-or-change-a-visual-effect). Performance notes for phones: effects use only `transform` and `opacity`; screen-wide effects are single overlay `<div>`s; the impact-frame inversion is a white overlay with `mix-blend-mode: difference` (GPU, no filter); there are no blur filters on large areas; sparks are plain polygons, capped at 80 live effects.

## Theming

Every colour is a CSS variable in [`src/style.css`](../src/style.css), defined twice: `:root[data-theme='light']` and `:root[data-theme='dark']`. Nothing in JS or SVG hard-codes a colour.

```css
--sky-top  --sky-bottom  --floor  --floor-line      /* stage */
--p1  --p2                                          /* fighters */
--ink  --text  --text-dim  --panel  --panel-line    /* UI */
--hp  --hp-ghost  --guard  --guard-low  --energy    /* meters */
--spark  --spark-core  --dust  --pop  --pop-outline /* effects */
--logo-ink  --logo-paper                            /* logo */
```

* Switch with the ◐ button or **T**; the choice is saved. First visit follows the OS setting. `?theme=light|dark` forces one (handy for screenshots). The theme is applied by an inline script before first paint, so there is no flash.
* To restyle, edit those variables. To add a third theme, add a `:root[data-theme='x']` block and extend `Theme` in [`client/theme.ts`](../src/client/theme.ts).

## The logo

A ring drawn in dark pencil: several overlapping, wobbly strokes plus loose hatching, roughened with an SVG displacement filter. It is generated, so it can be tweaked:

```bash
npm run logo     # node scripts/make-logo.mjs → src/assets/logo.svg + public/favicon.svg
```

It is deterministic (seeded). `src/assets/logo.svg` uses `--logo-ink`/`--logo-paper`, so it follows the theme when inlined by the menu; `favicon.svg` has fixed colours on a light tile.

## The sandbox

`/sandbox.html` (run `npm run dev`): every pose in a grid, a joint-slider editor with **copy as code**, and a player that scrubs or plays any animation, including every skill's. Use it before touching `poses.ts`.
