import type { ImpactTier } from './impacts.ts';

/**
 * VFX RECIPES: what the screen does when something happens.
 *
 * A recipe is a list of steps, keyed by an EVENT KEY (see client/director.ts for
 * which keys each game event produces). For a hit the keys are 'hit', and extra
 * recipes 'hit.<tier>' are layered on top, so 'hit.crush' only fires on crush hits.
 *
 * Amounts (amp, len, r, amt) are multiplied by the impact tier's `power`.
 * Durations (`dur`) are in F. A step with `minTier` only fires at that tier or harder.
 */
export type FxStep = { minTier?: ImpactTier } & (
  | { fx: 'shake'; amp: number; dur: number }
  | { fx: 'jitter'; amp: number }
  | { fx: 'spark'; n: number; len: number; dur: number }
  | { fx: 'ring'; r: number; dur: number }
  | { fx: 'flash'; alpha: number; dur: number }
  | { fx: 'invert'; dur: number }
  | { fx: 'zoom'; amt: number; dur: number }
  /** Camera swings toward the impact (pan 0..1) while zooming in (amt, scaled by power). */
  | { fx: 'dolly'; amt: number; pan: number; dur: number }
  /** Camera rolls (degrees, scaled by power) in the direction of the blow, then settles. */
  | { fx: 'tilt'; deg: number; dur: number }
  | { fx: 'slowmo'; scale: number; dur: number }
  | { fx: 'focus'; dur: number }
  | { fx: 'speed'; dur: number }
  | { fx: 'dust'; n: number; dur: number }
  | { fx: 'vignette'; alpha: number; dur: number }
  | { fx: 'text'; text: string; size: number; dur: number }
);

export const VFX: Record<string, FxStep[]> = {
  hit: [
    { fx: 'jitter', amp: 3 },
    { fx: 'shake', amp: 5, dur: 7 },
    { fx: 'spark', n: 9, len: 80, dur: 9 },
    { fx: 'flash', alpha: 0.22, dur: 2, minTier: 'medium' },
    { fx: 'ring', r: 90, dur: 10, minTier: 'medium' },
    { fx: 'dolly', amt: 0.05, pan: 0.3, dur: 12, minTier: 'medium' },
    { fx: 'tilt', deg: 0.7, dur: 16, minTier: 'heavy' },
    { fx: 'invert', dur: 2, minTier: 'heavy' },
    { fx: 'focus', dur: 8, minTier: 'heavy' },
  ],
  'hit.crush': [
    { fx: 'slowmo', scale: 0.35, dur: 26 },
    { fx: 'dolly', amt: 0.07, pan: 0.5, dur: 34 },
    { fx: 'tilt', deg: 0.9, dur: 30 },
    { fx: 'vignette', alpha: 0.6, dur: 30 },
    { fx: 'invert', dur: 3 },
  ],
  counter: [
    { fx: 'text', text: 'COUNTER', size: 44, dur: 40 },
    { fx: 'ring', r: 120, dur: 12 },
  ],
  backhit: [{ fx: 'text', text: 'BEHIND', size: 40, dur: 40 }],
  block: [
    { fx: 'jitter', amp: 1.5 },
    { fx: 'shake', amp: 2.5, dur: 5 },
    { fx: 'spark', n: 6, len: 55, dur: 7 },
  ],
  parry: [
    { fx: 'text', text: 'PARRY', size: 50, dur: 44 },
    { fx: 'invert', dur: 2 },
    { fx: 'ring', r: 150, dur: 14 },
    { fx: 'spark', n: 12, len: 110, dur: 10 },
    { fx: 'slowmo', scale: 0.4, dur: 16 },
    { fx: 'dolly', amt: 0.1, pan: 0.45, dur: 18 },
  ],
  guardBreak: [
    { fx: 'text', text: 'GUARD BREAK', size: 44, dur: 50 },
    { fx: 'shake', amp: 10, dur: 14 },
    { fx: 'dolly', amt: 0.08, pan: 0.4, dur: 18 },
    { fx: 'invert', dur: 3 },
    { fx: 'ring', r: 140, dur: 14 },
  ],
  ko: [
    { fx: 'invert', dur: 5 },
    { fx: 'slowmo', scale: 0.2, dur: 60 },
    { fx: 'dolly', amt: 0.16, pan: 0.85, dur: 100 },
    { fx: 'tilt', deg: 1.1, dur: 70 },
    { fx: 'focus', dur: 20 },
    { fx: 'vignette', alpha: 0.8, dur: 80 },
    { fx: 'shake', amp: 14, dur: 20 },
  ],
  jump: [{ fx: 'dust', n: 4, dur: 14 }],
  land: [{ fx: 'dust', n: 5, dur: 16 }],
  dash: [
    { fx: 'dust', n: 4, dur: 14 },
    { fx: 'speed', dur: 22 },
  ],
  knockdown: [
    { fx: 'dust', n: 8, dur: 20 },
    { fx: 'shake', amp: 6, dur: 8 },
  ],
  'skill.rush': [
    { fx: 'speed', dur: 24 },
    { fx: 'flash', alpha: 0.3, dur: 3 },
    { fx: 'tilt', deg: 0.8, dur: 22 },
    { fx: 'zoom', amt: 0.08, dur: 16 },
  ],
  // Round banners ("READY", "FIGHT", "K.O.") are drawn by the HUD, not here.
  roundStart: [],
  roundGo: [{ fx: 'flash', alpha: 0.4, dur: 4 }],
};
