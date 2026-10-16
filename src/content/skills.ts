import { POSES as X } from './poses.ts';
import type { AnimDef, AnimKey, Ease, Phase, Pose, SkillAnimKey, SkillDef } from './types.ts';

/**
 * SKILLS: every move in the game is one entry here. To add a move, add an entry.
 * No other code needs to change (run `npm test` to validate it).
 *
 * All times in F (frames). Hitbox x is forward from the body, y is up from the feet.
 * See docs/content-guide.md for every field.
 */
const k = (phase: Phase, t: number, pose: Pose, ease: Ease = 'out'): SkillAnimKey => ({ phase, t, pose, ease });

export const SKILLS: Record<string, SkillDef> = {
  // ---- the light string: jab -> cross -> spinKick ----
  jab: {
    name: 'Jab',
    input: { button: 'light' },
    startup: 4, active: 3, recovery: 8,
    hitbox: { x: 20, y: 112, w: 92, h: 34 },
    damage: 35, guardDamage: 8, impact: 'light',
    hitstun: 16, blockstun: 11, knockback: 3,
    motion: [{ from: 0, to: 4, vx: 1.5 }],
    cancels: [{ into: ['cross', 'straight', 'dash'], on: 'contact', from: 4 }],
    anim: [
      k('startup', 0, X.stand), k('startup', 1, X.jabWind),
      k('active', 0, X.jabHit), k('active', 1, X.jabHit),
      k('recovery', 1, X.stand, 'inOut'),
    ],
  },
  cross: {
    name: 'Cross',
    input: { button: 'light' },
    chainOnly: true,
    startup: 6, active: 3, recovery: 12,
    hitbox: { x: 20, y: 108, w: 104, h: 38 },
    damage: 45, guardDamage: 10, impact: 'light',
    hitstun: 20, blockstun: 12, knockback: 5,
    motion: [{ from: 3, to: 9, vx: 4 }],
    cancels: [{ into: ['spinKick', 'straight', 'dash'], on: 'contact', from: 6 }],
    anim: [
      k('startup', 0, X.stand), k('startup', 1, X.crossWind),
      k('active', 0, X.crossHit), k('active', 1, X.crossHit),
      k('recovery', 1, X.stand, 'inOut'),
    ],
  },
  spinKick: {
    name: 'Spin Kick',
    input: { button: 'light' },
    chainOnly: true,
    startup: 9, active: 4, recovery: 20,
    hitbox: { x: 10, y: 90, w: 130, h: 44 },
    damage: 70, guardDamage: 16, impact: 'medium',
    hitstun: 28, blockstun: 14, knockback: 8,
    launch: { vx: 8, vy: 13 },
    motion: [{ from: 6, to: 13, vx: 5 }],
    anim: [
      k('startup', 0, X.stand), k('startup', 0.6, X.spinWind), k('startup', 1, X.spinWind),
      k('active', 0, X.spinHit), k('active', 1, X.spinHit),
      k('recovery', 1, X.stand, 'inOut'),
    ],
  },

  // ---- heavy ----
  straight: {
    name: 'Straight',
    input: { button: 'heavy' },
    startup: 14, active: 4, recovery: 20,
    hitbox: { x: 20, y: 104, w: 130, h: 46 },
    damage: 140, guardDamage: 28, impact: 'heavy',
    hitstun: 28, blockstun: 16, knockback: 11,
    motion: [{ from: 10, to: 18, vx: 8 }],
    anim: [
      k('startup', 0, X.stand), k('startup', 0.7, X.strWind, 'inOut'), k('startup', 1, X.strWind),
      k('active', 0, X.strHit), k('active', 1, X.strHit),
      k('recovery', 1, X.stand, 'inOut'),
    ],
  },
  sweep: {
    name: 'Sweep',
    input: { button: 'heavy', dir: 'down' },
    startup: 9, active: 4, recovery: 18,
    hitbox: { x: 10, y: 0, w: 140, h: 36 },
    level: 'low', crouch: true,
    damage: 80, guardDamage: 18, impact: 'medium',
    hitstun: 24, blockstun: 12, knockback: 5,
    launch: { vx: 4, vy: 9 },
    motion: [{ from: 6, to: 11, vx: 6 }],
    anim: [
      k('startup', 0, X.crouch), k('startup', 1, X.sweepWind),
      k('active', 0, X.sweepHit), k('active', 1, X.sweepHit),
      k('recovery', 1, X.crouch, 'inOut'),
    ],
  },

  // ---- air ----
  airKick: {
    name: 'Air Kick',
    input: { button: 'light', air: true },
    startup: 5, active: 14, recovery: 8,
    hitbox: { x: 10, y: -30, w: 96, h: 100 },
    damage: 70, guardDamage: 14, impact: 'medium',
    hitstun: 20, blockstun: 12, knockback: 7,
    anim: [
      k('startup', 0, X.jumpPeak), k('startup', 1, X.airWind),
      k('active', 0, X.airHit), k('active', 1, X.airHit),
      k('recovery', 1, X.jumpFall, 'inOut'),
    ],
  },

  // ---- ultimate ----
  rush: {
    name: 'Hollow Rush',
    input: { button: 'skill' },
    cost: 50,
    startup: 12, active: 8, recovery: 22,
    hitbox: { x: 0, y: 50, w: 160, h: 120 },
    damage: 220, guardDamage: 45, impact: 'crush',
    hitstun: 40, blockstun: 20, knockback: 14,
    launch: { vx: 14, vy: 15 },
    motion: [{ from: 10, to: 18, vx: 36 }],
    invulnerable: [8, 18],
    fx: { trail: true },
    anim: [
      k('startup', 0, X.stand), k('startup', 0.8, X.rushWind, 'inOut'), k('startup', 1, X.rushWind),
      k('active', 0, X.rushHit), k('active', 1, X.rushHit),
      k('recovery', 1, X.stand, 'inOut'),
    ],
  },
};

export const skillTotal = (s: SkillDef): number => s.startup + s.active + s.recovery;

/** Skill ids that can be started with each button (built once). */
export const BUTTON_INDEX: Record<'light' | 'heavy' | 'skill', string[]> = { light: [], heavy: [], skill: [] };
for (const [id, s] of Object.entries(SKILLS)) BUTTON_INDEX[s.input.button].push(id);

/** Resolve a skill's phase-relative pose keys into an absolute-frame animation. */
export function resolveSkillAnim(s: SkillDef): AnimDef {
  const start: Record<Phase, number> = {
    startup: 0,
    active: s.startup,
    recovery: s.startup + s.active,
  };
  const len: Record<Phase, number> = { startup: s.startup, active: s.active, recovery: s.recovery };
  const keys: AnimKey[] = s.anim
    .map((key) => ({ f: start[key.phase] + key.t * len[key.phase], pose: key.pose, ease: key.ease }))
    .sort((a, b) => a.f - b.f);
  return { loop: false, duration: skillTotal(s), keys, blend: 2 };
}

export const SKILL_ANIMS: Record<string, AnimDef> = Object.fromEntries(
  Object.entries(SKILLS).map(([id, s]) => [id, resolveSkillAnim(s)]),
);
