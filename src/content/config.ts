/**
 * GLOBAL TUNING. Every number the feel of the game depends on.
 *
 * Units: distances are world units (a standing fighter is ~145 tall at the default BODY_SCALE, the stage is
 * ~1520 wide). Speeds are units per F. Durations are F. See docs/time-and-units.md.
 */
/**
 * HOW TALL FIGHTERS ARE. 1 = the reference build (~176 units tall). Skills' hitbox numbers,
 * the HURT shapes and the push-box are all authored for that reference size; this one number
 * scales the skeleton, hurtboxes, hitboxes and push-box together so they always agree.
 * 0.82 is a shorter, stockier fighter (about 145 units).
 */
export const BODY_SCALE = 0.82;

export const STAGE = {
  /** Fighters are kept within +/- this x. */
  halfWidth: 760,
  /** Starting distance from the centre of the stage. */
  startOffset: 200,
} as const;

export const PHYSICS = {
  gravity: 0.9,
  walkSpeed: 4.8,
  walkBackSpeed: 3.6,
  jumpVy: 18.5,
  jumpVx: 5.2,
  /** Per-F multiplier on horizontal speed while in a reaction state on the ground. */
  stunFriction: 0.84,
  /** Per-F multiplier for sliding to a stop in neutral/crouch/guard/land and after attack motion. */
  groundFriction: 0.7,
  dash: {
    /** Cruising speed while dash is held (units/F), reached over `accel` F. */
    speed: 15,
    accel: 4,
    /** Even a tap runs at least this many F before it may brake. */
    minFrames: 8,
    /** A forward dash stops by itself this far (centre to centre) from the opponent. */
    stopDistance: 84,
    /** Per-F speed multiplier while braking to a stop. */
    brake: 0.78,
    /** A back-dash is a fixed hop. */
    backSpeed: 12,
    backFrames: 12,
    /** Invulnerable for this many F at the start. */
    invuln: 5,
    backInvuln: 7,
    cooldown: 18,
    /** Attacks may cancel a dash after this many F (dash-in jab). */
    cancelAfter: 4,
  },
  /** Recovery after touching the ground mid-attack. */
  airAttackLandF: 8,
  /** Fighters closer than this (both grounded) get pushed apart. */
  pushSeparation: 56,
  /** Pushbox only applies if both are lower than this (lets you jump over). */
  pushMaxHeight: 70,
} as const;

export const RULES = {
  maxHp: 1000,
  maxGuard: 100,
  maxEnergy: 100,

  /** A press stays usable for this many F. */
  inputBuffer: 6,

  /** Guard pressed within this many F before the hit = parry. */
  parryWindow: 6,
  parryStun: 30,
  parryHitstop: 12,
  parryEnergy: 15,
  /** After releasing guard you cannot guard again for this many F (stops parry spam). */
  guardLock: 10,

  /** Fraction of damage dealt through a block. Chip cannot kill. */
  chip: 0.08,
  guardRegenDelay: 50,
  guardRegen: 0.4,
  guardBreakStun: 70,
  guardBreakRefill: 35,

  /** Each extra hit in a combo reduces damage by this much, down to comboMinScale. */
  comboScaling: 0.1,
  comboMinScale: 0.4,
  counterDamage: 1.25,
  counterStunBonus: 6,
  /** Hitting someone from behind. Behind-hits cannot be blocked. */
  backHitDamage: 1.1,

  /** Energy the defender gains per point of damage taken. */
  energyOnDamaged: 0.04,
  blockEnergy: 2,

  knockdownF: 34,
  getupF: 22,
  /** Default pop when an airborne fighter is hit without an explicit launch. */
  airHitPop: 7,

  introF: 80,
  koResetF: 300,
} as const;

/** Hurtbox shapes. y is measured up from the fighter's feet. x is centred on the fighter. */
export const HURT = {
  stand: { w: 60, h: 168, dy: 0 },
  crouch: { w: 74, h: 125, dy: 0 },
  air: { w: 60, h: 150, dy: 10 },
  down: { w: 170, h: 28, dy: 0 },
} as const;
