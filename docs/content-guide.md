# Content guide: adding things

All gameplay content is data in `src/content/`. After editing, run `npm test`: `validateContent()` checks every skill, pose, animation and effect and tells you exactly what is wrong. The game also runs it at startup, so a typo fails loudly instead of silently.

## Add a skill (one entry)

In [`content/skills.ts`](../src/content/skills.ts):

```ts
uppercut: {
  name: 'Uppercut',
  input: { button: 'heavy', dir: 'forward' },   // forward + heavy, relative to facing
  startup: 6, active: 4, recovery: 22,           // F
  hitbox: { x: 10, y: 60, w: 70, h: 120 },       // authored for the reference body, see BODY_SCALE
  damage: 110, guardDamage: 22, impact: 'heavy',
  hitstun: 26, blockstun: 14, knockback: 4,
  launch: { vx: 3, vy: 16 },                     // pops them into the air
  invulnerable: [0, 8],                          // frames [from, to) the attacker cannot be hit
  cancels: [{ into: ['dash'], on: 'hit', from: 8 }],
  anim: [
    k('startup', 0, X.stand), k('startup', 1, X.crouch),
    k('active', 0, X.jumpRise), k('active', 1, X.jumpRise),
    k('recovery', 1, X.stand, 'inOut'),
  ],
},
```

That is the whole job. It becomes usable from neutral (`forward + heavy`), shows up in the sandbox's animation list, and emits the normal events, so VFX and sound already work.

### Skill fields

| Field | Meaning |
|---|---|
| `input.button` | `light` / `heavy` / `skill` |
| `input.dir` | `forward` `back` `down` `neutral`, or omit for any. The most specific match wins |
| `input.air` | `true` = air move. Ground and air versions of a button never collide |
| `chainOnly` | only reachable through another skill's `cancels` |
| `cost` | energy spent |
| `cooldown` | F before it can be used again |
| `startup / active / recovery` | frame data, whole numbers ≥ 1 |
| `hitbox` | `{x, y, w, h}` or an array. `x` forward from body, `y` up from feet |
| `level` | `low` / `mid` (default) / `high`. See [combat-model.md](combat-model.md#3-direction-facing-sides-and-where-to-hit) |
| `crouch` | hurtbox shrinks while the skill runs (sweeps) |
| `unblockable` | ignores guard |
| `rehit` | hit again every N F during the active frames (multi-hit) |
| `damage`, `guardDamage` | HP and guard removed |
| `impact` | `light` `medium` `heavy` `crush`: hitstop, shake, sound |
| `hitstun`, `blockstun` | F the victim is stuck. `hitstun − (recovery left)` is your frame advantage |
| `knockback`, `blockKnockback` | push speed |
| `launch` | `{vx, vy}` sends the victim airborne |
| `motion` | `[{from, to, vx, vy?}]` overrides the attacker's velocity over a frame range (lunges, dashes) |
| `invulnerable` | `[from, to)` attacker cannot be hit |
| `cancels` | `[{into, on, from, to}]`. `into` = skill ids or `dash`/`jump`. `on` = `hit` / `contact` / `always` |
| `energyGain` | extra energy on top of the tier's |
| `fx.trail` | leave afterimages while it runs |
| `anim` | pose keys placed by *phase and fraction*, so retiming the frame data retimes the animation |

## Change a number everyone shares

[`content/config.ts`](../src/content/config.ts): `BODY_SCALE` (fighter height), `PHYSICS` (speeds, gravity, dash), `RULES` (HP, guard, parry window, combo scaling, buffer, round timings), `HURT` (hurtbox shapes), `STAGE`.

## Add a state

1. Add the id to `StateId` and a row to `STATES` in [`content/states.ts`](../src/content/states.ts) with its `priority`, `actionable`, `air`, `reaction`, `invulnerable`, `hurt`.
2. Teach the sim how it behaves: a `case` in `integrate()` (movement/physics), an entry in `exitState()` if it times out, and wherever it is entered, call `transition(...)` with the right `source`. The TypeScript compiler will point out the switches that no longer cover every state.
3. Give it an animation in `content/anims.ts` and map it in [`client/anim.ts`](../src/client/anim.ts) `pickAnim`.
4. Add a case to `tests/sim.test.ts`.

## Add a pose or animation

* A **pose** is angles only ([rendering-and-theming.md](rendering-and-theming.md#the-skeleton)). In [`content/poses.ts`](../src/content/poses.ts): `const myPose = P(stand, { lean: 20, frontArm: 90 })`, then add it to `POSES`.
* Tune it visually: open **`/sandbox.html`**, click a pose, drag the sliders, press **copy as code**, paste the numbers back.
* An **animation** is a list of `{f, pose, ease}` keys (`content/anims.ts`), looping or one-shot. Ease is `linear`, `in`, `out`, `inOut`, or `hold` (stay on the previous pose until the key).
* Animations crossfade automatically when a fighter switches between them (`blend`, in F).

## Add or change a visual effect

The effect for an event is a recipe in [`content/vfx.ts`](../src/content/vfx.ts):

```ts
hit: [
  { fx: 'shake', amp: 5, dur: 7 },
  { fx: 'spark', n: 9, len: 80, dur: 9 },
  { fx: 'invert', dur: 2, minTier: 'heavy' },   // impact frame, heavy and crush only
],
'hit.crush': [ { fx: 'slowmo', scale: 0.35, dur: 26 } ],   // extra, crush only
```

Available steps: `shake`, `jitter` (the victim trembles through hitstop), `spark`, `ring`, `flash`, `invert` (white difference overlay: an instant colour inversion), `zoom`, `dolly` (camera swings toward the impact while zooming in: `amt`, `pan` 0..1), `tilt` (camera rolls in the direction of the blow, in degrees), `slowmo`, `focus` (manga focus lines), `speed` (speed lines), `dust`, `vignette`, `text`. Amounts scale by the tier's `power`; `dur` is in F; `minTier` gates a step.

**Which keys does an event produce?** That mapping is [`client/director.ts`](../src/client/director.ts) `cueFor`. To react to a new event, add a `case` there, then add a recipe under the same key in `vfx.ts` and/or `sfx.ts`. To add a brand-new effect *type*, add it to the `FxStep` union and a builder in [`client/vfx.ts`](../src/client/vfx.ts).

A skill-specific effect needs no code: `skill.<id>` is always a key (`'skill.rush'` in `vfx.ts` fires when Hollow Rush starts).

## Add or change a sound

Sounds are synthesised, no files. In [`content/sfx.ts`](../src/content/sfx.ts) a key maps to layers of an oscillator and/or filtered noise with a pitch sweep and a decay. Keys follow the same events as VFX, and for tiered events `hit.heavy` is preferred over `hit` if present. To use recorded samples later, only `client/audio.ts` needs to learn to load them; the keys stay.

## Change how fighters hold their hands

[`content/habits.ts`](../src/content/habits.ts) lists hand positions per kind of moment (`neutral`, `guard`, `air`, `stun`) with a `weight` for how common each is. Add a line like `H('chest tuck', 3, 4, 110, 0, 118)` (name, weight, frontArm, frontForearm, backArm, backForearm) and it joins the random rotation. To change the tired stance, edit `tiredA` / `tiredB` in `poses.ts`; to change when fatigue kicks in, edit `fatigueOf` in `client/anim.ts`.

## Change colours and theme

[rendering-and-theming.md](rendering-and-theming.md#theming).
