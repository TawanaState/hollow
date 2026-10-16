import type { Pose } from './types.ts';

/**
 * POSE LIBRARY. Joint angles only (see types.ts for the conventions).
 * Build a new pose by tweaking a base:  P(POSES.stand, { lean: 20 }).
 * Tune them visually in the sandbox: /sandbox.html
 */
export const P = (base: Pose, over: Partial<Pose>): Pose => ({ ...base, ...over });

/**
 * THE STRONG STANCE: low and grounded, legs wide with the front knee bent and the back leg
 * driving, hands tucked in close to the chest. Every other pose derives from this.
 */
const stand: Pose = {
  lean: 14, head: 0, shift: 0, roll: 0,
  frontArm: 20, frontForearm: 125, backArm: 8, backForearm: 135,
  frontThigh: 44, frontShin: -62, backThigh: -34, backShin: 1,
};

const standB = P(stand, {
  lean: 16, frontArm: 22, backArm: 10,
  frontThigh: 46, frontShin: -64, backThigh: -35,
});

/**
 * THE TIRED STANCE (low HP or guard): upright and slumped, head hanging, arms dropped by the
 * sides, knees soft and legs close together. Blended in by fatigue, see client/anim.ts.
 */
const tiredA: Pose = {
  lean: 26, head: 20, shift: -4, roll: 0,
  frontArm: 10, frontForearm: 10, backArm: 2, backForearm: 14,
  frontThigh: 12, frontShin: -14, backThigh: -8, backShin: -10,
};
const tiredB = P(tiredA, {
  lean: 31, head: 25, frontArm: 14, backArm: 5,
  frontThigh: 17, frontShin: -21, backThigh: -10, backShin: -13,
});

// ---- locomotion ----
const walkContactF = P(stand, { frontThigh: 52, frontShin: -28, backThigh: -34, backShin: -30 });
const walkPassA = P(stand, { frontThigh: 14, frontShin: -46, backThigh: -6, backShin: -4, lean: 12 });
const walkContactB = P(stand, { frontThigh: -24, frontShin: -36, backThigh: 46, backShin: -20 });
const walkPassB = P(stand, { frontThigh: 4, frontShin: -4, backThigh: 12, backShin: -48, lean: 12 });

const crouch = P(stand, {
  lean: 38, head: -6, frontArm: 36, frontForearm: 112, backArm: 22, backForearm: 120,
  frontThigh: 80, frontShin: -84, backThigh: 62, backShin: -107,
});

const jumpRise = P(stand, {
  lean: 4, frontArm: 120, frontForearm: 30, backArm: 100, backForearm: 40,
  frontThigh: 48, frontShin: -85, backThigh: 22, backShin: -75,
});
const jumpPeak = P(stand, {
  lean: 6, frontArm: 75, frontForearm: 60, backArm: 55, backForearm: 70,
  frontThigh: 40, frontShin: -60, backThigh: -15, backShin: -50,
});
const jumpFall = P(stand, {
  lean: 2, frontArm: 140, frontForearm: 10, backArm: 120, backForearm: 20,
  frontThigh: 16, frontShin: -16, backThigh: -14, backShin: -24,
});
const land = P(crouch, { lean: 30 });

// Dash: a sprint cycle (A and B alternate), a braking skid, and a back-step.
const dashRunA = P(stand, {
  lean: 36, head: -4, shift: 10, frontArm: -55, frontForearm: 40, backArm: 60, backForearm: 80,
  frontThigh: 62, frontShin: -50, backThigh: -52, backShin: -62,
});
const dashRunB = P(dashRunA, {
  frontArm: 60, frontForearm: 80, backArm: -55, backForearm: 40,
  frontThigh: -48, frontShin: -62, backThigh: 66, backShin: -48,
});
const dashSkid = P(stand, {
  lean: -6, shift: -6, frontArm: 50, frontForearm: 100, backArm: 30, backForearm: 110,
  frontThigh: 58, frontShin: -56, backThigh: -28, backShin: -20,
});
const backDash = P(stand, {
  lean: -14, shift: -10, frontArm: 50, frontForearm: 90, backArm: 34, backForearm: 100,
  frontThigh: 18, frontShin: -50, backThigh: -34, backShin: -12,
});

// ---- defence & reactions ----
const guard = P(stand, {
  lean: 2, frontArm: 62, frontForearm: 118, backArm: 48, backForearm: 128,
  frontThigh: 32, frontShin: -36, backThigh: -25, backShin: -8,
});
const blockHit = P(guard, {
  lean: -12, shift: -14, frontArm: 70, backArm: 56,
  frontThigh: 36, frontShin: -42, backThigh: -34,
});
const hitA = P(stand, {
  lean: -22, head: -22, shift: -10, frontArm: 118, frontForearm: 30, backArm: -36, backForearm: 40,
  frontThigh: 12, frontShin: -12, backThigh: -32, backShin: -10,
});
const hitB = P(hitA, {
  lean: -34, head: -30, shift: -20, frontArm: 138, backArm: -52,
  frontThigh: 4, backThigh: -38,
});
const launchedA = P(stand, {
  lean: -20, head: -20, roll: -25, frontArm: 140, frontForearm: 20, backArm: -50, backForearm: 30,
  frontThigh: 40, frontShin: -50, backThigh: -34, backShin: -30,
});
const launchedB = P(launchedA, { roll: -150, frontArm: 120, backArm: -30, frontThigh: 60, backThigh: -50 });
const lying = P(stand, {
  lean: 0, head: 0, roll: -90, frontArm: 20, frontForearm: 0, backArm: -30, backForearm: 0,
  frontThigh: 0, frontShin: 0, backThigh: -4, backShin: 0,
});
const sitUp = P(crouch, { lean: -10, roll: -30 });

// ---- attacks ----
const jabWind = P(stand, { lean: 2, shift: -6, frontArm: 18, frontForearm: 130 });
const jabHit = P(stand, {
  lean: 14, shift: 8, frontArm: 88, frontForearm: 0,
  frontThigh: 36, frontShin: -38, backThigh: -26,
});
const crossWind = P(stand, { lean: -2, shift: -8, backArm: 12, backForearm: 135, frontArm: 50, frontForearm: 80 });
const crossHit = P(stand, {
  lean: 26, shift: 20, backArm: 92, backForearm: -2, frontArm: -20, frontForearm: 90,
  frontThigh: 42, frontShin: -44, backThigh: -34, backShin: -14,
});
const spinWind = P(stand, { lean: 22, shift: -4, frontArm: -20, frontForearm: 60, backArm: 70, backForearm: 20, frontThigh: 10, frontShin: -10, backThigh: -10, backShin: -60 });
const spinHit = P(stand, {
  lean: -22, shift: 0, frontArm: -50, frontForearm: 30, backArm: 80, backForearm: 20,
  frontThigh: -4, frontShin: 0, backThigh: 94, backShin: -4,
});
const strWind = P(stand, {
  lean: -16, shift: -22, backArm: -34, backForearm: 120, frontArm: 62, frontForearm: 92,
  frontThigh: 40, frontShin: -42, backThigh: -42, backShin: -22,
});
const strHit = P(stand, {
  lean: 36, shift: 42, backArm: 96, backForearm: -4, frontArm: -34, frontForearm: 76,
  frontThigh: 62, frontShin: -62, backThigh: -50, backShin: 0,
});
const sweepWind = P(crouch, { lean: 34, shift: -8, frontArm: -10, backArm: -30 });
const sweepHit = P(crouch, {
  lean: 38, shift: 10, frontArm: -40, frontForearm: 30, backArm: 70, backForearm: 20,
  frontThigh: 58, frontShin: -112, backThigh: 82, backShin: -2,
});
const airWind = P(jumpRise, { lean: 6 });
const airHit = P(jumpPeak, {
  lean: 14, frontArm: -30, frontForearm: 40, backArm: 80, backForearm: 20,
  frontThigh: 62, frontShin: -6, backThigh: -10, backShin: -84,
});
const rushWind = P(stand, {
  lean: -14, shift: -26, frontArm: 20, frontForearm: 120, backArm: 100, backForearm: -10,
  frontThigh: 34, frontShin: -38, backThigh: -38, backShin: -14,
});
const rushHit = P(stand, {
  lean: 56, shift: 44, frontArm: 104, frontForearm: -4, backArm: -64, backForearm: 6,
  frontThigh: 72, frontShin: -74, backThigh: -62, backShin: 0,
});

export const POSES = {
  stand, standB, tiredA, tiredB,
  walkContactF, walkPassA, walkContactB, walkPassB,
  crouch, land,
  jumpRise, jumpPeak, jumpFall,
  dashRunA, dashRunB, dashSkid, backDash,
  guard, blockHit,
  hitA, hitB, launchedA, launchedB, lying, sitUp,
  jabWind, jabHit, crossWind, crossHit, spinWind, spinHit,
  strWind, strHit, sweepWind, sweepHit, airWind, airHit,
  rushWind, rushHit,
} satisfies Record<string, Pose>;

export type PoseName = keyof typeof POSES;
