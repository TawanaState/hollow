# Combat model

Everything here is implemented in [`src/core/sim.ts`](../src/core/sim.ts); the numbers live in [`src/content/`](../src/content). Times are in F ([time-and-units.md](time-and-units.md)).

## 1. Meters: what "health" means

| Meter | Start | Meaning |
|---|---|---|
| **HP** | 1000 × the Health setting (default Long = 2000) | Life. 0 = K.O. Damage numbers are tuned for 1000; the menu's Health setting (Normal 1× / Long 2× / Epic 3× / Marathon 5×) scales it, so fights can be longer without retuning moves. Online matches use the server's default. |
| **Guard** | 100 | Block stamina. Each block drains it by the move's `guardDamage`. At 0 you are **guard broken**: stunned 70 F and wide open. Guard refills 0.4/F, starting 50 F after the last block, and not while blocking. |
| **Energy** | 0 | Fuel for ultimates (`cost`). Attacker gains by tier (light 4, medium 7, heavy 12, crush 20), the victim gains 4% of damage taken, blocks give 2 each way, a parry gives 15. |

**Damage**

```
damage = skill.damage
       × comboScale        1.0 on the first hit, −10% per extra hit in the combo, floor 40%
       × 1.25              if it was a counter-hit
       × 1.10              if it hit from behind
```

* **Counter-hit:** you hit someone during their startup or active frames. Bigger damage, +6 F hitstun, and the impact tier goes up one step.
* **Chip damage:** a blocked hit still does 8% of its damage, but chip can never kill (HP stops at 1).
* **Combos:** a combo is a run of hits while the victim stays in a reaction state. It ends when they return to a normal state (`COMBO_END` event).

**Parry.** Press guard so the hit lands within **6 F of raising guard**. The attacker is stunned 30 F, you take nothing and gain energy, and you are free to punish immediately. Two rules stop parry spam: after you release guard you cannot guard again for 10 F, and guard re-entered from blockstun is never "fresh".

## 2. States, and what overrides what

States live in [`content/states.ts`](../src/content/states.ts):

| State | Priority | Actionable | Air | Reaction | Invulnerable | Hurtbox |
|---|---|---|---|---|---|---|
| idle | 0 | ✓ | | | | stand |
| walk | 1 | ✓ | | | | stand |
| crouch | 1 | ✓ | | | | crouch (a deep squat, ~125 tall at reference size) |
| guard | 2 | ✓ | | | | stand (crouch if DOWN held) |
| jump | 3 | ✓ | ✓ | | | air |
| land | 3 | | | | | stand |
| dash | 5 | | | | first 5 F (7 for a back-dash) | stand |
| attack | 10 | | | | per-skill range | stand (crouch for a `crouch` skill) |
| blockstun | 28 | | | ✓ | | stand |
| hitstun | 30 | | | ✓ | | stand |
| launched | 35 | | ✓ | ✓ | | air |
| knockdown | 40 | | | ✓ | ✓ | down |
| getup | 41 | | | ✓ | ✓ | down |
| ko | 100 | | | ✓ | ✓ | down |

Every state change goes through one function, `transition(world, fighter, to, source)`. The `source` decides the rule:

| Source | Used for | Rule |
|---|---|---|
| `command` | the player pressed something | the caller has already checked that the current state is **actionable**, or that a **cancel rule** allows it |
| `reaction` | a hit, block or guard break | refused if the target is **invulnerable**; refused if it would **downgrade a stronger reaction** (lower priority than the current reaction state). A jab cannot pull you out of `launched` |
| `natural` | a timer ran out, you landed | always allowed |
| `forced` | KO, parry stun | always allowed |

**Priority is used in two places:** (1) the reaction rule above, (2) when several commands are valid in the same frame, the highest-priority one wins: skill (attack 10) > dash (5) > jump (3) > guard (2) > crouch/walk (1) > idle (0). Within skills the order is skill button, then heavy, then light, and a directional skill (e.g. `heavy + down`) beats the plain one on the same button.

**Dash (hold to run).** Press dash and the fighter eases up to a steady run, and **keeps running for as long as dash is held**, all the way to the opponent. It brakes on its own when it gets within striking range (84 units), reaches the wall, or the button is released. A tap still runs at least 8 F. Holding back + dash is a fixed 12 F back-step instead, so you cannot retreat forever. The first 5 F (7 for the back-step) are invulnerable; the rest of the run is not. An attack can **cancel a running dash** after 4 F (a dash-in jab); nothing else can. Tuning is in `PHYSICS.dash`.

**Cancels.** A skill lists `cancels: [{ into, on, from, to }]`. While the attack is inside the frame window, and its condition (`hit`, `contact` = hit or blocked, `always`) is met, a buffered press of the target's button starts the new skill instead of waiting for recovery. `into` can name other skills or the specials `dash`/`jump`. A skill marked `chainOnly` can only be reached this way (that is how jab → cross → spin kick works).

**Input buffering.** A press stays usable for 6 F, so pressing slightly early still works. Buffers do not age during hitstop, so presses made while frozen are still alive when time resumes.

## 3. Direction: facing, sides, and where to hit

* **Inputs are screen-relative; the sim makes them fighter-relative.** `LEFT`/`RIGHT` are absolute. `relativeDir(fighter)` turns them into `forward` / `back` / `down` / `neutral` using `fighter.facing`. A skill's `input.dir` uses the relative form, so "forward + heavy" means toward the opponent whichever side you are on.
* **Facing** is `+1` (right) or `−1` (left). Fighters automatically turn to face the opponent while grounded and in a normal state (idle, walk, crouch, guard, blockstun, land, dash). Starting an attack on the ground also turns you toward the opponent, so you cannot whiff backwards by accident. Two exceptions make **cross-ups** real: you do not turn while airborne, and a guarding fighter does not turn if the opponent is in the air.
* **Hitboxes are written facing right** and are mirrored by `facing`. `x` is forward from the body centre, `y` is up from the feet.
* **Side of the hit.** If the attacker is on the defender's front, the hit can be blocked. If the attacker is behind (`HIT.side = 'back'`), it **cannot be blocked** and does +10%. That is what a successful cross-up looks like.
* **Hit level** (`skill.level`, default `mid`) says how it must be guarded:
  * `low`: must be blocked crouching (guard + DOWN). Beats standing guard.
  * `high`: an overhead, must be blocked standing. Beats crouch guard.
  * `mid`: either.
  * Geometry still counts: a hitbox that passes over a crouching hurtbox whiffs, which is how you duck a high punch.
* **Push-box.** Grounded fighters cannot overlap (min separation `56 × BODY_SCALE`). If either is above 70 × scale they can pass, so you can jump over. A fighter pinned against the wall while in a reaction state pushes the opponent back instead (corner pressure).

## 4. Impact: how hard a hit lands

Each skill has one tier ([`content/impacts.ts`](../src/content/impacts.ts)):

| Tier | Hitstop (F) | Power | Energy |
|---|---|---|---|
| light | 4 | 0.6 | 4 |
| medium | 7 | 1.0 | 7 |
| heavy | 11 | 1.6 | 12 |
| crush | 18 | 2.4 | 20 |

* **Hitstop** freezes the whole sim for that many F on connect. Blocked hits freeze for 60% of it; a parry freezes 12; a guard break uses heavy's.
* A counter-hit bumps the tier one step; a K.O. is always `crush`.
* **Power** scales presentation (shake, sparks, zoom) and is applied by the effect recipes, not by the sim. See [rendering-and-theming.md](rendering-and-theming.md).
* On hit, the victim gets **hitstun** (`skill.hitstun`) and knockback away from the attacker, or is **launched** (`skill.launch`, or any hit on an airborne fighter) into `launched`, then `knockdown` (34 F, invulnerable), then `getup` (22 F, invulnerable). Nobody can be hit while down, so there is no "okizeme" abuse built in.

## 5. Frame counting and the order of a frame

Frame numbers in skills are zero-based within the move: the frame you press the button is frame 0. **A skill with `startup: 4` first hits on its 5th frame (index 4).** `active` frames then follow, then `recovery`. A move's total is `startup + active + recovery`.

One call to `step()` does, in order:

1. read inputs, detect presses, fill buffers
2. if frozen by hitstop: count it down and stop
3. (intro phase only: count the intro down, move nothing else, stop)
4. regenerate guard
5. **decide**: for each fighter, start commands or cancels
6. **integrate**: physics, move by state, timers, state exits (landing, stun ends)
7. push fighters apart, keep them on stage, auto-face
8. **resolve hits**: collect every overlap first, then apply them all, so simultaneous hits (trades) are judged on the same snapshot
9. age buffers and cooldowns
10. if the round is over, count toward the reset

## 6. Round flow

`intro` (80 F, no input) → `fight` → on K.O. `ko` (300 F of slow-mo and bodies falling) → a new `intro`. The score persists across rounds. If both fighters die on the same frame the round is a draw and nobody scores.
