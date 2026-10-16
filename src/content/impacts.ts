/**
 * IMPACT TIERS: how hard a hit lands.
 *
 * Every attack declares one tier. The tier drives:
 *   - hitstop (sim: both fighters freeze, in F)
 *   - power   (presentation: scales shake/spark/zoom amounts)
 *   - energy  (meter gained by the attacker)
 * Presentation recipes (content/vfx.ts, content/sfx.ts) can also add extra
 * effects from a minimum tier upward.
 */
export const IMPACT_ORDER = ['light', 'medium', 'heavy', 'crush'] as const;
export type ImpactTier = (typeof IMPACT_ORDER)[number];

export interface ImpactDef {
  /** Freeze time on connect, in F. Applies to both fighters. */
  hitstop: number;
  /** Multiplier for presentation effects. */
  power: number;
  /** Energy the attacker gains. */
  energy: number;
}

export const IMPACT: Record<ImpactTier, ImpactDef> = {
  light: { hitstop: 4, power: 0.6, energy: 4 },
  medium: { hitstop: 7, power: 1, energy: 7 },
  heavy: { hitstop: 11, power: 1.6, energy: 12 },
  crush: { hitstop: 18, power: 2.4, energy: 20 },
};

/** Blocked hits freeze for this fraction of the normal hitstop. */
export const BLOCK_HITSTOP_RATIO = 0.6;

export const tierIndex = (t: ImpactTier): number => IMPACT_ORDER.indexOf(t);

/** One tier harder, capped at 'crush'. Used for counter-hits. */
export const bumpTier = (t: ImpactTier): ImpactTier =>
  IMPACT_ORDER[Math.min(tierIndex(t) + 1, IMPACT_ORDER.length - 1)];

/** True when `tier` is at least `min`. */
export const tierAtLeast = (tier: ImpactTier, min: ImpactTier): boolean =>
  tierIndex(tier) >= tierIndex(min);
