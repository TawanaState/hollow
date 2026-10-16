/**
 * SOUND RECIPES: what plays when something happens.
 *
 * The sound is built from LAYERS, like a real game's audio:
 *   samples   recorded sounds (public/audio, CC0), picked at random from a GROUP of variants,
 *             with a random pitch each time so no two hits sound the same
 *   body      synthesised low end (sub-bass thumps, risers) that makes impacts feel heavy
 *   fallback  a fully synthesised version, used only if the recorded sounds could not load
 *
 * Keys follow the same events as the effects (see client/director.ts). For tiered events
 * 'hit.heavy' is preferred over 'hit' if present. Durations are in F, gains are 0..~1.2.
 * Sample group names come from public/audio/manifest.json (see scripts/fetch-audio.mts).
 */
export type OscType = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** A synthesised layer: an oscillator and/or filtered noise with a pitch sweep and a decay. */
export interface SfxLayer {
  dur: number;
  gain: number;
  /** Start this many F late. */
  delay?: number;
  osc?: { type: OscType; from: number; to: number };
  noise?: { filter: FilterType; from: number; to: number; q?: number };
}

/** A recorded sound from a group of variants. */
export interface SampleLayer {
  sample: string;
  gain: number;
  /** Playback speed range (also changes pitch). Picked at random each time. */
  rate?: readonly [number, number];
  delay?: number;
  /** How much of this layer goes to the reverb (0..1). Overrides the recipe's. */
  reverb?: number;
  /** EQ for this layer only: cut everything above / below these frequencies (Hz). */
  lp?: number;
  hp?: number;
  /** Boost (+) or cut (-) the lows (below ~200 Hz) / highs (above ~3 kHz), in dB. */
  low?: number;
  high?: number;
  /** The pitch slides to this multiple of itself over the sound: under 1 is a falling swoop. */
  bend?: number;
}

export interface SfxRecipe {
  samples?: SampleLayer[];
  body?: SfxLayer[];
  fallback?: SfxLayer[];
  /** Reverb amount for the whole sound (0..1). */
  reverb?: number;
  /** Make everything else quieter for a moment. */
  duck?: { amount: number; dur: number };
  /** Dip the whole mix's top end for a moment (ears ringing). `to` is a frequency in Hz. */
  muffle?: { to: number; dur: number };
  /** Rise in pitch with the combo count (hits only). */
  combo?: boolean;
  /** Minimum F between two plays of this key. */
  limit?: number;
}

const S = (sample: string, gain: number, rate?: readonly [number, number], extra: Partial<SampleLayer> = {}): SampleLayer => ({ sample, gain, rate, ...extra });

export const SFX: Record<string, SfxRecipe> = {
  // ───────── hits: the heavier the tier, the more layers and the lower the bottom ─────────
  'hit.light': {
    samples: [S('hit-light', 0.81, [0.88, 1.05], { low: 5, lp: 6000 }), S('body-soft', 0.33, [1.0, 1.2], { low: 4 })],
    body: [{ dur: 5, gain: 0.24, osc: { type: 'sine', from: 170, to: 90 } }],
    fallback: [
      { dur: 5, gain: 0.5, noise: { filter: 'bandpass', from: 1800, to: 600, q: 1.2 } },
      { dur: 6, gain: 0.45, osc: { type: 'sine', from: 180, to: 90 } },
    ],
    reverb: 0.03,
    combo: true,
  },
  'hit.medium': {
    samples: [S('hit-medium', 0.5, [0.86, 1], { low: 6, lp: 6000 }), S('body-soft', 0.35, [0.8, 0.95], { low: 5 }), S('crack-medium', 0.09, [0.9, 1.05], { lp: 3200 })],
    body: [{ dur: 9, gain: 0.25, osc: { type: 'sine', from: 130, to: 55 } }],
    fallback: [
      { dur: 8, gain: 0.6, noise: { filter: 'lowpass', from: 1400, to: 300 } },
      { dur: 9, gain: 0.55, osc: { type: 'sine', from: 140, to: 60 } },
    ],
    reverb: 0.08,
    combo: true,
  },
  'hit.heavy': {
    samples: [S('hit-heavy', 0.61, [0.8, 0.95], { low: 7, lp: 6500 }), S('body-heavy', 0.52, [0.75, 0.9], { low: 5 }), S('crack-heavy', 0.17, [0.85, 1], { lp: 3600 })],
    body: [
      { dur: 16, gain: 0.44, osc: { type: 'sine', from: 85, to: 34 } },
      { dur: 10, gain: 0.17, noise: { filter: 'lowpass', from: 900, to: 150 } },
    ],
    fallback: [
      { dur: 12, gain: 0.8, noise: { filter: 'lowpass', from: 900, to: 150 } },
      { dur: 15, gain: 0.8, osc: { type: 'sine', from: 100, to: 40 } },
    ],
    reverb: 0.18,
    combo: true,
  },
  'hit.crush': {
    samples: [
      S('hit-heavy', 0.6, [0.65, 0.75], { low: 8, lp: 5000 }),
      S('body-heavy', 0.45, [0.6, 0.7], { low: 6 }),
      S('crack-heavy', 0.17, [0.7, 0.85], { lp: 2600 }),
      S('clank-heavy', 0.06, [0.55, 0.65], { lp: 1400 }),
      S('boom', 0.5, [0.85, 0.95], { low: 4 }),
      S('glass-heavy', 0.03, [0.7, 0.9], { delay: 2, lp: 2500 }),
    ],
    body: [
      { dur: 34, gain: 0.5, osc: { type: 'sine', from: 62, to: 24 } },
      { dur: 26, gain: 0.23, noise: { filter: 'lowpass', from: 700, to: 70 } },
    ],
    fallback: [
      { dur: 24, gain: 1, noise: { filter: 'lowpass', from: 700, to: 80 } },
      { dur: 30, gain: 1, osc: { type: 'sine', from: 70, to: 28 } },
    ],
    reverb: 0.45,
    duck: { amount: 0.5, dur: 22 },
  },
  counter: {
    samples: [S('bell', 0.3, [1.5, 1.7]), S('ui-confirm', 0.35, [1.3, 1.4])],
    fallback: [{ dur: 5, gain: 0.18, osc: { type: 'square', from: 900, to: 1500 } }],
    reverb: 0.2,
  },

  // ───────── defence ─────────
  'block.light': {
    samples: [S('body-soft', 0.54, [0.9, 1.05], { low: 6, lp: 4500 }), S('wood-heavy', 0.27, [1.1, 1.3], { lp: 3500 }), S('clank-light', 0.18, [0.7, 0.85], { lp: 1800, hp: 200 })],
    body: [{ dur: 6, gain: 0.21, osc: { type: 'sine', from: 160, to: 80 } }],
    fallback: [{ dur: 5, gain: 0.4, noise: { filter: 'lowpass', from: 1600, to: 400 } }, { dur: 6, gain: 0.4, osc: { type: 'sine', from: 180, to: 90 } }],
    reverb: 0.06,
  },
  'block.medium': {
    samples: [S('hit-medium', 0.44, [0.8, 0.95], { low: 7, lp: 4000 }), S('wood-heavy', 0.33, [0.9, 1.05], { lp: 3200 }), S('clank-medium', 0.14, [0.6, 0.75], { lp: 1600, hp: 150 })],
    body: [{ dur: 10, gain: 0.3, osc: { type: 'sine', from: 125, to: 55 } }],
    fallback: [{ dur: 8, gain: 0.5, noise: { filter: 'lowpass', from: 1500, to: 300 } }, { dur: 9, gain: 0.5, osc: { type: 'sine', from: 140, to: 60 } }],
    reverb: 0.1,
  },
  'block.heavy': {
    samples: [S('hit-heavy', 0.47, [0.7, 0.85], { low: 8, lp: 3500 }), S('body-heavy', 0.44, [0.75, 0.9], { low: 5 }), S('clank-heavy', 0.11, [0.55, 0.7], { lp: 1500, hp: 120 })],
    body: [{ dur: 16, gain: 0.41, osc: { type: 'sine', from: 95, to: 40 } }],
    fallback: [{ dur: 12, gain: 0.6, noise: { filter: 'lowpass', from: 1200, to: 200 } }, { dur: 15, gain: 0.7, osc: { type: 'sine', from: 100, to: 42 } }],
    reverb: 0.16,
  },
  'block.crush': {
    samples: [S('hit-heavy', 0.47, [0.6, 0.72], { low: 9, lp: 3000 }), S('boom', 0.35, [1, 1.15], { low: 4 }), S('body-heavy', 0.4, [0.6, 0.7]), S('clank-heavy', 0.07, [0.5, 0.6], { lp: 1200 })],
    body: [{ dur: 26, gain: 0.45, osc: { type: 'sine', from: 78, to: 28 } }],
    fallback: [{ dur: 14, gain: 0.6, noise: { filter: 'lowpass', from: 1000, to: 100 } }, { dur: 20, gain: 0.7, osc: { type: 'sine', from: 90, to: 30 } }],
    reverb: 0.32,
  },
  parry: {
    samples: [S('hit-medium', 0.52, [1.1, 1.25], { lp: 5000, low: 3 }), S('field', 0.3, [0.7, 0.85], { low: 6, lp: 3500 }), S('bell', 0.21, [0.7, 0.85], { lp: 3000, low: 3 }), S('boom', 0.34, [1.5, 1.7], { low: 3 })],
    body: [{ dur: 14, gain: 0.34, osc: { type: 'sine', from: 140, to: 60 } }],
    fallback: [
      { dur: 14, gain: 0.3, osc: { type: 'sine', from: 900, to: 1800 } },
      { dur: 12, gain: 0.45, osc: { type: 'sine', from: 140, to: 60 } },
    ],
    reverb: 0.4,
    duck: { amount: 0.55, dur: 16 },
  },
  guardBreak: {
    samples: [S('hit-heavy', 0.55, [0.6, 0.72], { low: 8, lp: 4500 }), S('boom', 0.5, [1, 1.15], { delay: 1, low: 4 }), S('glass-heavy', 0.15, [0.55, 0.7], { lp: 2600 }), S('clank-heavy', 0.11, [0.5, 0.6], { lp: 1400 })],
    body: [{ dur: 30, gain: 0.52, osc: { type: 'sine', from: 90, to: 30 } }],
    fallback: [
      { dur: 24, gain: 0.7, osc: { type: 'sawtooth', from: 320, to: 60 } },
      { dur: 12, gain: 0.5, noise: { filter: 'bandpass', from: 2000, to: 400 } },
    ],
    reverb: 0.4,
    duck: { amount: 0.5, dur: 20 },
  },

  // ───────── movement: whooshes get lower and longer as the move gets bigger ─────────
  'skill.light': {
    samples: [S('swish', 0.7, [0.65, 0.8], { lp: 1500, low: 10, bend: 0.75 }), S('cloth', 0.15, [0.7, 0.9], { lp: 1500, low: 6 })],
    body: [{ dur: 8, gain: 0.45, osc: { type: 'sine', from: 130, to: 62 } }, { dur: 10, gain: 0.3, noise: { filter: 'lowpass', from: 250, to: 1100 } }],
    fallback: [{ dur: 9, gain: 0.22, noise: { filter: 'bandpass', from: 400, to: 2400, q: 0.9 } }],
    reverb: 0.05,
    limit: 3,
  },
  'skill.medium': {
    samples: [S('swish', 0.85, [0.55, 0.7], { lp: 1400, low: 11, bend: 0.7 }), S('cloth', 0.3, [0.6, 0.75], { lp: 1400, low: 6 })],
    body: [{ dur: 11, gain: 0.55, osc: { type: 'sine', from: 115, to: 50 } }, { dur: 13, gain: 0.34, noise: { filter: 'lowpass', from: 220, to: 1100 } }],
    fallback: [{ dur: 9, gain: 0.22, noise: { filter: 'bandpass', from: 400, to: 2400, q: 0.9 } }],
    reverb: 0.07,
    limit: 3,
  },
  'skill.heavy': {
    samples: [S('swish', 0.85, [0.45, 0.6], { lp: 1300, low: 12, bend: 0.65 }), S('cloth', 0.3, [0.5, 0.65], { lp: 1300, low: 6 }), S('chop', 0.2, [0.45, 0.55], { delay: 2, lp: 1600, low: 8 })],
    body: [{ dur: 16, gain: 0.65, osc: { type: 'sine', from: 100, to: 40 } }, { dur: 16, gain: 0.36, noise: { filter: 'lowpass', from: 200, to: 1200 } }],
    fallback: [{ dur: 14, gain: 0.3, noise: { filter: 'lowpass', from: 300, to: 1800 } }],
    reverb: 0.1,
    limit: 3,
  },
  'skill.crush': {
    samples: [S('swish', 0.45, [0.45, 0.55], { lp: 2200, low: 9, bend: 0.65 }), S('zap', 0.17, [0.45, 0.6], { lp: 2500, low: 6 }), S('field', 0.23, [0.55, 0.7], { lp: 2600, low: 8 }), S('boom', 0.25, [1.4, 1.6], { delay: 4, low: 4 })],
    body: [
      { dur: 30, gain: 0.3, osc: { type: 'sine', from: 80, to: 36 } },
      { dur: 26, gain: 0.15, noise: { filter: 'lowpass', from: 200, to: 2200, q: 0.7 } },
    ],
    fallback: [
      { dur: 24, gain: 0.45, noise: { filter: 'bandpass', from: 200, to: 3600, q: 0.7 } },
      { dur: 24, gain: 0.35, osc: { type: 'sawtooth', from: 120, to: 480 } },
    ],
    reverb: 0.3,
  },
  dash: {
    samples: [S('cloth', 0.6, [0.75, 0.95], { lp: 2600, low: 5 }), S('swish', 0.4, [0.9, 1.1], { lp: 2200, low: 6, bend: 0.8 })],
    body: [{ dur: 12, gain: 0.18, noise: { filter: 'bandpass', from: 500, to: 180 } }, { dur: 8, gain: 0.2, osc: { type: 'sine', from: 100, to: 55 } }],
    fallback: [{ dur: 10, gain: 0.2, noise: { filter: 'bandpass', from: 600, to: 200 } }],
    limit: 6,
  },
  jump: {
    samples: [S('cloth', 0.5, [1.1, 1.4]), S('step', 0.6, [1.1, 1.3])],
    fallback: [{ dur: 5, gain: 0.1, osc: { type: 'sine', from: 220, to: 440 } }],
    limit: 6,
  },
  'land.light': {
    samples: [S('step', 1.1, [0.85, 1.05])],
    fallback: [{ dur: 6, gain: 0.3, noise: { filter: 'lowpass', from: 400, to: 100 } }],
    limit: 6,
  },
  'land.medium': {
    samples: [S('step', 1.1, [0.7, 0.85]), S('body-soft', 0.5, [0.8, 1])],
    body: [{ dur: 8, gain: 0.35, osc: { type: 'sine', from: 90, to: 45 } }],
    fallback: [{ dur: 6, gain: 0.3, noise: { filter: 'lowpass', from: 400, to: 100 } }],
    limit: 6,
  },
  knockdown: {
    samples: [S('body-heavy', 0.9, [0.8, 0.95]), S('wood-heavy', 0.7, [0.85, 1]), S('step', 0.4, [0.6, 0.75])],
    body: [{ dur: 14, gain: 0.7, osc: { type: 'sine', from: 90, to: 38 } }],
    fallback: [{ dur: 12, gain: 0.6, osc: { type: 'sine', from: 90, to: 45 } }, { dur: 10, gain: 0.4, noise: { filter: 'lowpass', from: 500, to: 100 } }],
    reverb: 0.15,
  },

  // ───────── the big moments ─────────
  ko: {
    samples: [
      S('boom', 0.55, [0.65, 0.75], { low: 6 }),
      S('hit-heavy', 0.45, [0.55, 0.65], { low: 8, lp: 4000 }),
      S('body-heavy', 0.45, [0.55, 0.65], { low: 6 }),
      S('crunch', 0.28, [0.6, 0.7], { lp: 3000, low: 4 }),
      S('clank-heavy', 0.06, [0.45, 0.55], { lp: 1200 }),
      S('glass-heavy', 0.03, [0.6, 0.7], { delay: 3, lp: 2200 }),
    ],
    body: [
      { dur: 70, gain: 0.5, osc: { type: 'sine', from: 56, to: 18 } },
      { dur: 44, gain: 0.25, noise: { filter: 'lowpass', from: 600, to: 60 } },
      // the swoop: the world dropping away
      { dur: 56, gain: 0.17, noise: { filter: 'lowpass', from: 2600, to: 90, q: 0.9 } },
      { dur: 50, gain: 0.2, osc: { type: 'sine', from: 240, to: 34 } },
      // the ringing in your ears
      { dur: 110, gain: 0.03, delay: 6, osc: { type: 'sine', from: 3100, to: 2900 } },
    ],
    fallback: [
      { dur: 50, gain: 1, osc: { type: 'sine', from: 60, to: 20 } },
      { dur: 40, gain: 0.7, noise: { filter: 'lowpass', from: 600, to: 60 } },
    ],
    reverb: 0.6,
    muffle: { to: 500, dur: 95 },
    duck: { amount: 0.4, dur: 60 },
  },
  roundStart: {
    samples: [S('crack-heavy', 0.7, [0.5, 0.6]), S('boom', 0.45, [1.2, 1.4])],
    body: [{ dur: 70, gain: 0.2, delay: 4, noise: { filter: 'bandpass', from: 200, to: 3000, q: 0.8 } }],
    fallback: [{ dur: 14, gain: 0.15, osc: { type: 'sine', from: 440, to: 440 } }],
    reverb: 0.25,
  },
  roundGo: {
    samples: [S('hit-heavy', 0.5, [0.7, 0.8], { low: 8, lp: 4500 }), S('boom', 0.39, [1.2, 1.4], { low: 4 }), S('bell', 0.1, [0.6, 0.7], { lp: 2500 })],
    body: [{ dur: 20, gain: 0.39, osc: { type: 'sine', from: 100, to: 40 } }],
    fallback: [{ dur: 18, gain: 0.2, osc: { type: 'sine', from: 880, to: 880 } }],
    reverb: 0.3,
  },

  // ───────── little details ─────────
  step: { samples: [S('step', 0.75, [0.95, 1.25])], fallback: [{ dur: 3, gain: 0.08, noise: { filter: 'lowpass', from: 500, to: 150 } }], limit: 4 },
  energyReady: {
    samples: [S('ui-confirm', 0.5, [1.25, 1.35]), S('bell', 0.18, [1.8, 2])],
    fallback: [{ dur: 14, gain: 0.15, osc: { type: 'sine', from: 660, to: 990 } }],
    reverb: 0.2,
  },
  heartbeat: {
    body: [
      { dur: 7, gain: 0.8, osc: { type: 'sine', from: 70, to: 40 } },
      { dur: 7, gain: 0.55, delay: 9, osc: { type: 'sine', from: 62, to: 38 } },
    ],
    limit: 20,
  },

  // ───────── interface ─────────
  'ui.click': { samples: [S('ui-click', 1.4, [0.95, 1.1])], limit: 2 },
  'ui.select': { samples: [S('ui-select', 1.3, [0.95, 1.05])], limit: 2 },
  'ui.confirm': { samples: [S('ui-confirm', 0.6)], reverb: 0.1 },
  'ui.back': { samples: [S('ui-back', 1.2)] },
  'ui.open': { samples: [S('ui-open', 0.5)] },
  'ui.close': { samples: [S('ui-close', 0.9)] },
  'ui.tick': { samples: [S('ui-tick', 1, [0.9, 1.15])], limit: 3 },
  'ui.toggle': { samples: [S('ui-toggle', 0.8)] },
  'ui.error': { samples: [S('ui-error', 0.7)] },
};

/** The announcer. Played as voice (it ducks everything else a little). Lines are groups named 'say-<line>'. */
export const ANNOUNCER_LINES = [
  'fight',
  'round-1',
  'round-2',
  'round-3',
  'round-4',
  'round-5',
  'final-round',
  'combo',
  'flawless',
  'winner',
  'you-win',
  'you-lose',
  'tie',
] as const;
export type AnnouncerLine = (typeof ANNOUNCER_LINES)[number];
