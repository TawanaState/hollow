import type { ImpactTier } from './impacts.ts';

/**
 * A pose is a set of joint ANGLES (degrees), never positions, so limbs keep their
 * length. See docs/rendering.md for the conventions.
 *
 * Angles for arms/thighs are absolute, measured from "straight down",
 * positive = swinging toward the front (the side the fighter faces).
 * Forearm/shin angles are bends RELATIVE to their upper segment.
 * "front" is the limb on the side the fighter faces; "back" the other one.
 */
export interface Pose {
  /** Torso lean forward from upright. */
  lean: number;
  /** Extra head tilt on top of lean. */
  head: number;
  /** Body shift along the facing direction (world units). */
  shift: number;
  /** Rotate the whole body about the hip (forward positive). Used for flips and lying down. */
  roll: number;
  frontArm: number;
  frontForearm: number;
  backArm: number;
  backForearm: number;
  frontThigh: number;
  frontShin: number;
  backThigh: number;
  backShin: number;
}

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'hold';

export interface AnimKey {
  /** Frame within the animation. */
  f: number;
  pose: Pose;
  /** How to travel INTO this key from the previous one. Default 'out'. */
  ease?: Ease;
}

export interface AnimDef {
  loop: boolean;
  /** Length in F. For loops the last key blends back to the first. */
  duration: number;
  keys: AnimKey[];
  /** Crossfade length (F) when switching TO this animation. Default 3. */
  blend?: number;
}

export type Phase = 'startup' | 'active' | 'recovery';

/** A pose key placed by phase and fraction, so retiming frame data retimes the animation. */
export interface SkillAnimKey {
  phase: Phase;
  /** 0..1 inside the phase. */
  t: number;
  pose: Pose;
  ease?: Ease;
}

/** A box relative to the fighter. x is forward from the body centre, y is up from the feet. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the attack lands, which decides how it must be guarded:
 *   low  - must be blocked crouching (hold DOWN + guard)
 *   high - an overhead: must be blocked standing (not holding DOWN)
 *   mid  - blocked either way (default)
 * Geometry still matters too: a hitbox that passes over a crouching hurtbox whiffs.
 */
export type HitLevel = 'high' | 'mid' | 'low';

export type SkillButton = 'light' | 'heavy' | 'skill';

/** Direction held relative to the way the fighter faces. */
export type RelDir = 'neutral' | 'forward' | 'back' | 'down';

export interface CancelRule {
  /** Skill ids, or the special 'dash' / 'jump'. */
  into: string[];
  /** hit = only if it connected, contact = hit or blocked, always = even on whiff. */
  on: 'hit' | 'contact' | 'always';
  /** Frame range inside the skill (inclusive). Defaults: first active frame .. last frame. */
  from?: number;
  to?: number;
}

export interface SkillDef {
  name: string;
  input: {
    button: SkillButton;
    /** Required held direction (relative to facing). Omitted/'any' matches everything. */
    dir?: RelDir | 'any';
    /** True = air move, false/omitted = ground move. */
    air?: boolean;
  };
  /** Only reachable through a cancel rule, never from neutral. */
  chainOnly?: boolean;
  /** Energy spent. */
  cost?: number;
  /** F before this skill can be used again. */
  cooldown?: number;

  /** Frame data, in F. */
  startup: number;
  active: number;
  recovery: number;

  /** One or more hitboxes, all live during the active frames. */
  hitbox: Box | Box[];
  level?: HitLevel;
  /** Hurtbox shrinks to the crouch shape while this skill runs. */
  crouch?: boolean;
  unblockable?: boolean;
  /** If set, can hit again every N F during active frames. */
  rehit?: number;

  damage: number;
  guardDamage: number;
  impact: ImpactTier;
  hitstun: number;
  blockstun: number;
  /** Horizontal speed given to the victim (away from the attacker). */
  knockback: number;
  /** Horizontal speed given on block. Defaults to 70% of knockback. */
  blockKnockback?: number;
  /** Launches the victim into the air. */
  launch?: { vx?: number; vy: number };
  /** Extra energy for the attacker on top of the tier's. */
  energyGain?: number;

  /** Override the attacker's horizontal/vertical velocity over a frame range [from, to). */
  motion?: { from: number; to: number; vx: number; vy?: number }[];
  /** Attacker cannot be hit during this frame range [from, to). */
  invulnerable?: [number, number];

  cancels?: CancelRule[];
  anim: SkillAnimKey[];
  fx?: {
    /** Leave afterimages while this skill runs. */
    trail?: boolean;
  };
}
