/**
 * HAND HABITS: small variations in how a fighter holds their hands, picked at random so two
 * fighters never look like clones and the same fighter does not look frozen.
 *
 * Each list holds arm positions that make sense for that kind of moment (a cover that works
 * while standing would look wrong mid-air). The client rolls one at random per fighter and
 * re-rolls it now and then; see client/habits.ts. Purely cosmetic, never affects the sim.
 *
 * Angles follow content/types.ts: 0 = down, positive = toward the front; forearms are bends.
 * `weight` makes some habits more common.
 */
export interface ArmSet {
  frontArm: number;
  frontForearm: number;
  backArm: number;
  backForearm: number;
}

export interface Habit {
  name: string;
  weight: number;
  arms: ArmSet;
}

const H = (name: string, weight: number, fa: number, ff: number, ba: number, bf: number): Habit => ({
  name,
  weight,
  arms: { frontArm: fa, frontForearm: ff, backArm: ba, backForearm: bf },
});

export const HABITS = {
  /** Standing, walking, crouching: ready, tucked in, a little different each time. */
  neutral: [
    H('chin guard', 5, 20, 125, 8, 135),
    H('high cover', 3, 30, 140, 18, 140),
    H('chest tuck', 3, 4, 110, 0, 118),
    H('low lead', 3, 40, 70, 8, 138),
    H('probing lead', 2, 58, 55, 10, 132),
    H('rear hand down', 2, 24, 128, 2, 40),
    H('loose', 1, 14, 70, 6, 80),
  ],
  /** Guarding: always covered, but how the cover sits changes. */
  guard: [
    H('wall', 4, 62, 118, 48, 128),
    H('high wall', 3, 72, 126, 56, 136),
    H('crossed', 2, 40, 150, 30, 150),
    H('forearms out', 2, 78, 100, 40, 140),
  ],
  /** In the air. */
  air: [
    H('tuck', 4, 100, 30, 80, 40),
    H('spread', 3, 70, 20, -40, 20),
    H('reach up', 3, 130, 20, 110, 30),
    H('lead out', 2, 95, 15, 20, 90),
  ],
  /** Reeling from a hit. */
  stun: [
    H('hands up', 4, 118, 30, -36, 40),
    H('clutch', 3, 10, 100, 4, 105),
    H('flung wide', 3, 70, 10, -60, 10),
    H('one arm shields', 2, 100, 60, -20, 20),
  ],
} as const satisfies Record<string, readonly Habit[]>;

export type HabitKind = keyof typeof HABITS;
