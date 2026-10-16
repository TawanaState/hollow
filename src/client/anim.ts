import { ANIMS } from '../content/anims.ts';
import { SKILL_ANIMS } from '../content/skills.ts';
import type { AnimDef, Ease, Pose } from '../content/types.ts';
import type { Fighter } from '../core/types.ts';

const EASE: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  hold: () => 0,
};

const POSE_KEYS = [
  'lean', 'head', 'shift', 'roll',
  'frontArm', 'frontForearm', 'backArm', 'backForearm',
  'frontThigh', 'frontShin', 'backThigh', 'backShin',
] as const satisfies readonly (keyof Pose)[];

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = {} as Pose;
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** The pose of an animation at time t (F). Loops wrap; one-shots hold their last key. */
export function samplePose(a: AnimDef, t: number): Pose {
  const keys = a.keys;
  if (keys.length === 1) return keys[0].pose;
  if (a.loop) t = ((t % a.duration) + a.duration) % a.duration;
  else if (t >= keys[keys.length - 1].f) return keys[keys.length - 1].pose;
  else if (t <= 0) return keys[0].pose;

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].f <= t) i++;
  const from = keys[i];
  const wrapped = i === keys.length - 1;
  const to = wrapped ? keys[0] : keys[i + 1];
  const toF = wrapped ? a.duration : to.f;
  const span = toF - from.f;
  if (span <= 0) return to.pose;
  const p = Math.min(1, Math.max(0, (t - from.f) / span));
  return lerpPose(from.pose, to.pose, EASE[to.ease ?? 'out'](p));
}

export interface AnimChoice {
  /** Changes when the fighter should crossfade to a different animation. */
  id: string;
  anim: AnimDef;
  /** Time into the animation, in F. */
  t: number;
}

/** Which animation a fighter plays right now, from sim state alone. */
export function pickAnim(f: Fighter, alpha: number): AnimChoice {
  const t = f.stateF + alpha;
  const named = (id: string): AnimChoice => ({ id, anim: ANIMS[id], t });
  switch (f.state) {
    case 'idle':
      return named('idle');
    case 'walk':
      return named(f.vx * f.facing >= 0 ? 'walk' : 'walkBack');
    case 'crouch':
      return named('crouch');
    case 'guard':
      return named('guard');
    case 'jump':
      return named(f.vy > 4 ? 'jumpRise' : f.vy < -4 ? 'jumpFall' : 'jumpPeak');
    case 'land':
      return named('land');
    case 'dash':
      if (f.dashDir !== f.facing) return named('backDash');
      // braking: a skid, timed from when it started so it plays through
      return f.dashEnding ? { id: 'dashSkid', anim: ANIMS.dashSkid, t: Math.max(0, t - 8) } : named('dash');
    case 'attack':
      return f.skill && SKILL_ANIMS[f.skill]
        ? { id: `skill:${f.skill}`, anim: SKILL_ANIMS[f.skill], t }
        : named('idle');
    case 'blockstun':
      return named('blockHit');
    case 'hitstun':
      return named('hit');
    case 'launched':
      return named('launched');
    case 'knockdown':
      return named('knockdown');
    case 'getup':
      return named('getup');
    case 'ko':
      return f.y > 0 || f.vy > 0 ? named('launched') : named('knockdown');
  }
}

// ── fatigue: how worn out a fighter looks ──

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** 0 = fresh and strong, 1 = exhausted. From HP (mostly) and guard. Purely visual. */
export function fatigueOf(hp: number, guard: number): number {
  const byHp = smooth((0.55 - hp) / 0.4); // starts below 55% HP, full at 15%
  const byGuard = smooth((30 - guard) / 30) * 0.6;
  return Math.max(byHp, byGuard);
}

const UPPER: (keyof Pose)[] = ['lean', 'head', 'frontArm', 'frontForearm', 'backArm', 'backForearm'];

/**
 * Show tiredness on the neutral animations. Idle swaps toward the slumped idle; walking keeps
 * its stride but the upper body slumps and the hands drop. Fighting poses are left alone, so a
 * tired fighter still raises their guard and attacks properly.
 */
export function applyFatigue(id: string, pose: Pose, t: number, fatigue: number): Pose {
  if (fatigue < 0.01) return pose;
  if (id === 'idle') return lerpPose(pose, samplePose(ANIMS.idleTired, t), fatigue);
  if (id === 'walk' || id === 'walkBack') {
    const tired = samplePose(ANIMS.idleTired, t);
    const out = { ...pose };
    for (const key of UPPER) out[key] = pose[key] + (tired[key] - pose[key]) * fatigue * 0.9;
    return out;
  }
  return pose;
}
