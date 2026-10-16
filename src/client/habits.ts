import { HABITS } from '../content/habits.ts';
import type { ArmSet, Habit, HabitKind } from '../content/habits.ts';
import { SKILLS } from '../content/skills.ts';
import type { Pose } from '../content/types.ts';
import { createRng } from '../core/rng.ts';
import type { Rng } from '../core/rng.ts';
import type { Fighter } from '../core/types.ts';

/** Which kind of moment is this? null = leave the arms to the animation (dash, falling over...). */
function kindOf(f: Fighter): HabitKind | 'attack' | null {
  switch (f.state) {
    case 'idle':
    case 'walk':
    case 'crouch':
    case 'land':
      return 'neutral';
    case 'guard':
      return 'guard';
    case 'jump':
      return 'air';
    case 'hitstun':
    case 'launched':
      return 'stun';
    case 'attack':
      return 'attack';
    default:
      return null;
  }
}

/** Is this arm the one doing the hitting in the skill's active pose? Cached per skill. */
const striking = new Map<string, { front: boolean; back: boolean }>();
function strikingArms(skill: string): { front: boolean; back: boolean } {
  let s = striking.get(skill);
  if (!s) {
    const def = SKILLS[skill];
    const key = def?.anim.find((k) => k.phase === 'active')?.pose;
    const reaches = (upper: number, bend: number): boolean => upper > 55 && upper < 150 && bend < 35;
    s = key
      ? { front: reaches(key.frontArm, key.frontForearm), back: reaches(key.backArm, key.backForearm) }
      : { front: true, back: true };
    striking.set(skill, s);
  }
  return s;
}

const ARM_KEYS: (keyof ArmSet)[] = ['frontArm', 'frontForearm', 'backArm', 'backForearm'];

/**
 * Per-fighter hand habits. Picks a hand position that suits what the fighter is doing, glides
 * to it, and re-rolls every few seconds. During an attack only the hand that is NOT striking
 * follows the habit, so the move itself is never changed.
 */
export class Habits {
  private readonly rng: Rng;
  private kind: HabitKind | 'attack' | null = null;
  private target: Habit = HABITS.neutral[0];
  private cur: ArmSet = { ...HABITS.neutral[0].arms };
  private timer = 0;
  private lastNeutral: Habit = HABITS.neutral[0];

  constructor(seed: number) {
    this.rng = createRng(seed);
    this.target = this.roll('neutral');
    this.cur = { ...this.target.arms };
    this.timer = this.rng.range(90, 240);
  }

  private roll(kind: HabitKind): Habit {
    const list = HABITS[kind] as readonly Habit[];
    for (let i = 0; i < 4; i++) {
      const h = this.rng.weighted(list.map((item) => ({ item, weight: item.weight })));
      if (h !== this.target || list.length === 1) return h;
    }
    return list[0];
  }

  /** Returns `pose` with its arms replaced (or partly replaced) by the current habit. */
  apply(f: Fighter, pose: Pose, dtF: number): Pose {
    const kind = kindOf(f);
    if (kind === null) return pose;

    // new kind of moment? choose a habit that fits it. (attack keeps the neutral habit)
    if (kind !== this.kind) {
      if (kind === 'attack') this.target = this.lastNeutral;
      else {
        this.target = this.roll(kind);
        if (kind === 'neutral') this.lastNeutral = this.target;
        this.timer = this.rng.range(90, 240);
      }
      this.kind = kind;
    } else if (kind === 'neutral' || kind === 'guard') {
      this.timer -= dtF;
      if (this.timer <= 0) {
        this.target = this.roll(kind);
        if (kind === 'neutral') this.lastNeutral = this.target;
        this.timer = this.rng.range(90, 240);
      }
    }

    const k = 1 - Math.pow(0.86, dtF);
    for (const key of ARM_KEYS) this.cur[key] += (this.target.arms[key] - this.cur[key]) * k;

    const out = { ...pose };
    if (kind === 'attack') {
      const s = f.skill ? strikingArms(f.skill) : { front: false, back: false };
      if (!s.front) {
        out.frontArm += (this.cur.frontArm - out.frontArm) * 0.55;
        out.frontForearm += (this.cur.frontForearm - out.frontForearm) * 0.55;
      }
      if (!s.back) {
        out.backArm += (this.cur.backArm - out.backArm) * 0.55;
        out.backForearm += (this.cur.backForearm - out.backForearm) * 0.55;
      }
    } else {
      for (const key of ARM_KEYS) out[key] = this.cur[key];
    }
    return out;
  }
}
