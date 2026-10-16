import { BODY_SCALE, HURT } from '../content/config.ts';
import { SKILLS, skillTotal } from '../content/skills.ts';
import { STATES } from '../content/states.ts';
import type { Fighter } from '../core/types.ts';

/** Half the width of a standing opponent's body: how far past a fist the target's centre is. */
export const HALF_BODY = (HURT.stand.w / 2) * BODY_SCALE;

export const SKILL_IDS: readonly string[] = Object.keys(SKILLS);

export interface Reach {
  /** Smallest centre-to-centre distance at which the attack can touch a standing opponent. */
  min: number;
  /** Largest. */
  max: number;
}

/**
 * How far each skill reaches, worked out from its hitboxes, so the AI and the teacher bots stay
 * right when moves are retuned. Distances are between the two fighters' centres.
 */
export const REACH: Record<string, Reach> = Object.fromEntries(
  Object.entries(SKILLS).map(([id, sk]) => {
    const boxes = Array.isArray(sk.hitbox) ? sk.hitbox : [sk.hitbox];
    let min = Infinity;
    let max = 0;
    for (const b of boxes) {
      min = Math.min(min, b.x * BODY_SCALE - HALF_BODY);
      max = Math.max(max, (b.x + b.w) * BODY_SCALE + HALF_BODY);
    }
    return [id, { min: Math.max(0, min), max }];
  }),
);

/** Frames until a fighter's attack becomes active, or null if it is not winding up. */
export function framesToActive(f: Fighter): number | null {
  if (f.state !== 'attack' || !f.skill) return null;
  const sk = SKILLS[f.skill];
  return f.stateF < sk.startup ? sk.startup - f.stateF : null;
}

/** Frames until a fighter can act again (0 if it already can). Open-ended falls count as 30. */
export function framesUntilFree(f: Fighter): number {
  if (f.state === 'attack' && f.skill) return Math.max(0, skillTotal(SKILLS[f.skill]) - f.stateF);
  if (STATES[f.state].actionable) return 0;
  if (!Number.isFinite(f.stateDur)) return 30;
  return Math.max(0, f.stateDur - f.stateF);
}

/** 'startup' | 'active' | 'recovery' for a fighter that is attacking, else null. */
export function attackPhase(f: Fighter): 'startup' | 'active' | 'recovery' | null {
  if (f.state !== 'attack' || !f.skill) return null;
  const sk = SKILLS[f.skill];
  if (f.stateF < sk.startup) return 'startup';
  if (f.stateF < sk.startup + sk.active) return 'active';
  return 'recovery';
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
