import { POSES as X } from './poses.ts';
import type { AnimDef, AnimKey, Ease, Pose } from './types.ts';

const k = (f: number, pose: Pose, ease: Ease = 'out'): AnimKey => ({ f, pose, ease });

/** Time-reversed copy of a looping animation (walking backwards). */
export function reverseAnim(a: AnimDef): AnimDef {
  const keys = a.keys
    .map((key) => ({ ...key, f: a.duration - key.f }))
    .map((key) => (key.f === a.duration ? { ...key, f: 0 } : key))
    .sort((p, q) => p.f - q.f);
  return { ...a, keys };
}

const walk: AnimDef = {
  loop: true,
  duration: 24,
  blend: 3,
  keys: [
    k(0, X.walkContactF, 'inOut'),
    k(6, X.walkPassA, 'inOut'),
    k(12, X.walkContactB, 'inOut'),
    k(18, X.walkPassB, 'inOut'),
  ],
};

/**
 * Animations for states that are not attacks. Keyed by name; client/anim.ts decides
 * which one a fighter plays (idle, walk or walkBack by velocity, etc).
 * Attack animations live on the skill itself (content/skills.ts).
 */
export const ANIMS: Record<string, AnimDef> = {
  idle: {
    loop: true, duration: 60, blend: 4,
    keys: [k(0, X.stand, 'inOut'), k(30, X.standB, 'inOut')],
  },
  /** Played instead of `idle` as fatigue rises (blended by client/anim.ts). */
  idleTired: {
    loop: true, duration: 48, blend: 6,
    keys: [k(0, X.tiredA, 'inOut'), k(24, X.tiredB, 'inOut')],
  },
  walk,
  walkBack: reverseAnim(walk),
  crouch: { loop: false, duration: 6, blend: 3, keys: [k(0, X.stand), k(6, X.crouch)] },
  jumpRise: { loop: false, duration: 8, blend: 2, keys: [k(0, X.crouch), k(8, X.jumpRise)] },
  jumpPeak: { loop: false, duration: 10, blend: 4, keys: [k(0, X.jumpRise), k(10, X.jumpPeak, 'inOut')] },
  jumpFall: { loop: false, duration: 10, blend: 4, keys: [k(0, X.jumpPeak), k(10, X.jumpFall, 'inOut')] },
  land: { loop: false, duration: 7, blend: 1, keys: [k(0, X.land), k(7, X.stand, 'inOut')] },
  dash: { loop: true, duration: 10, blend: 2, keys: [k(0, X.dashRunA, 'inOut'), k(5, X.dashRunB, 'inOut')] },
  dashSkid: { loop: false, duration: 10, blend: 2, keys: [k(0, X.dashRunA), k(4, X.dashSkid, 'out'), k(10, X.stand, 'inOut')] },
  backDash: { loop: false, duration: 14, blend: 1, keys: [k(0, X.backDash), k(14, X.backDash)] },
  guard: { loop: false, duration: 5, blend: 2, keys: [k(0, X.stand), k(5, X.guard)] },
  blockHit: { loop: false, duration: 6, blend: 1, keys: [k(0, X.blockHit), k(6, X.guard, 'inOut')] },
  hit: { loop: false, duration: 12, blend: 1, keys: [k(0, X.hitA), k(5, X.hitB), k(12, X.hitA, 'inOut')] },
  launched: { loop: false, duration: 26, blend: 2, keys: [k(0, X.launchedA), k(26, X.launchedB)] },
  knockdown: { loop: false, duration: 8, blend: 2, keys: [k(0, X.launchedB), k(8, X.lying)] },
  getup: {
    loop: false, duration: 22, blend: 2,
    keys: [k(0, X.lying), k(11, X.sitUp, 'inOut'), k(22, X.stand, 'inOut')],
  },
};
