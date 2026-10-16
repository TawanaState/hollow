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
    samples: [S('hit-light', 1.35, [0.92, 1.14]), S('body-soft', 0.4, [1.15, 1.35])],
    body: [{ dur: 5, gain: 0.4, osc: { type: 'sine', from: 170, to: 90 } }],
    fallback: [
      { dur: 5, gain: 0.5, noise: { filter: 'bandpass', from: 1800, to: 600, q: 1.2 } },
      { dur: 6, gain: 0.45, osc: { type: 'sine', from: 180, to: 90 } },
    ],
    reverb: 0.03,
    combo: true,
  },
  'hit.medium': {
    samples: [S('hit-medium', 1, [0.92, 1.08]), S('body-soft', 0.6, [0.85, 1]), S('crack-medium', 0.3, [1, 1.2])],
    body: [{ dur: 9, gain: 0.5, osc: { type: 'sine', from: 130, to: 55 } }],
    fallback: [
      { dur: 8, gain: 0.6, noise: { filter: 'lowpass', from: 1400, to: 300 } },
      { dur: 9, gain: 0.55, osc: { type: 'sine', from: 140, to: 60 } },
    ],
    reverb: 0.08,
    combo: true,
  },
  'hit.heavy': {
    samples: [S('hit-heavy', 1.1, [0.86, 1]), S('body-heavy', 0.8, [0.8, 0.95]), S('crack-heavy', 0.42, [0.95, 1.1])],
    body: [
      { dur: 16, gain: 0.8, osc: { type: 'sine', from: 85, to: 34 } },
      { dur: 10, gain: 0.3, noise: { filter: 'lowpass', from: 900, to: 150 } },
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
      S('hit-heavy', 1.2, [0.7, 0.8]),
      S('crack-heavy', 0.7, [0.78, 0.9]),
      S('clank-heavy', 0.4, [0.7, 0.8]),
      S('boom', 0.85, [0.9, 1]),
      S('glass-heavy', 0.22, [0.9, 1.1], { delay: 2 }),
    ],
    body: [
      { dur: 34, gain: 1, osc: { type: 'sine', from: 62, to: 24 } },
      { dur: 26, gain: 0.45, noise: { filter: 'lowpass', from: 700, to: 70 } },
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
    samples: [S('clank-light', 1.3, [0.95, 1.12]), S('body-soft', 0.25, [1.2, 1.4])],
    fallback: [{ dur: 5, gain: 0.35, noise: { filter: 'highpass', from: 2500, to: 1500 } }, { dur: 6, gain: 0.3, osc: { type: 'triangle', from: 520, to: 380 } }],
    reverb: 0.05,
  },
  'block.medium': {
    samples: [S('clank-medium', 1.3, [0.92, 1.08]), S('crack-medium', 0.3, [1.1, 1.3])],
    body: [{ dur: 8, gain: 0.3, osc: { type: 'sine', from: 140, to: 70 } }],
    fallback: [{ dur: 5, gain: 0.35, noise: { filter: 'highpass', from: 2500, to: 1500 } }, { dur: 6, gain: 0.3, osc: { type: 'triangle', from: 520, to: 380 } }],
    reverb: 0.1,
  },
  'block.heavy': {
    samples: [S('clank-heavy', 1.05, [0.88, 1]), S('crack-heavy', 0.3, [1, 1.15])],
    body: [{ dur: 12, gain: 0.5, osc: { type: 'sine', from: 100, to: 45 } }],
    fallback: [{ dur: 5, gain: 0.35, noise: { filter: 'highpass', from: 2500, to: 1500 } }, { dur: 6, gain: 0.3, osc: { type: 'triangle', from: 520, to: 380 } }],
    reverb: 0.16,
  },
  'block.crush': {
    samples: [S('clank-heavy', 1.1, [0.7, 0.8]), S('boom', 0.5, [1.1, 1.3]), S('crack-heavy', 0.5, [0.8, 0.9])],
    body: [{ dur: 20, gain: 0.7, osc: { type: 'sine', from: 80, to: 30 } }],
    fallback: [{ dur: 8, gain: 0.5, noise: { filter: 'highpass', from: 2500, to: 1000 } }, { dur: 12, gain: 0.5, osc: { type: 'triangle', from: 400, to: 200 } }],
    reverb: 0.3,
  },
  parry: {
    samples: [S('bell', 0.75, [1.15, 1.3]), S('field', 0.55, [1.1, 1.25]), S('clank-light', 0.55, [1.4, 1.6]), S('glass-heavy', 0.2, [1.4, 1.6])],
    body: [{ dur: 18, gain: 0.18, osc: { type: 'sine', from: 1400, to: 2600 } }],
    fallback: [
      { dur: 16, gain: 0.35, osc: { type: 'sine', from: 1400, to: 2600 } },
      { dur: 8, gain: 0.3, noise: { filter: 'highpass', from: 6000, to: 4000 } },
    ],
    reverb: 0.4,
    duck: { amount: 0.55, dur: 16 },
  },
  guardBreak: {
    samples: [S('glass-heavy', 0.95, [0.85, 1]), S('clank-heavy', 0.8, [0.75, 0.9]), S('boom', 0.6, [1.2, 1.4], { delay: 1 })],
    body: [{ dur: 24, gain: 0.7, osc: { type: 'sine', from: 90, to: 32 } }],
    fallback: [
      { dur: 24, gain: 0.7, osc: { type: 'sawtooth', from: 320, to: 60 } },
      { dur: 12, gain: 0.5, noise: { filter: 'bandpass', from: 2000, to: 400 } },
    ],
    reverb: 0.4,
    duck: { amount: 0.5, dur: 20 },
  },

  // ───────── movement: whooshes get lower and longer as the move gets bigger ─────────
  'skill.light': {
    samples: [S('swish', 0.6, [1.05, 1.35]), S('cloth', 0.15, [1.2, 1.5])],
    fallback: [{ dur: 9, gain: 0.22, noise: { filter: 'bandpass', from: 400, to: 2400, q: 0.9 } }],
    limit: 3,
  },
  'skill.medium': {
    samples: [S('swish', 0.95, [0.9, 1.1]), S('cloth', 0.3, [0.9, 1.1])],
    fallback: [{ dur: 9, gain: 0.22, noise: { filter: 'bandpass', from: 400, to: 2400, q: 0.9 } }],
    limit: 3,
  },
  'skill.heavy': {
    samples: [S('swish', 0.78, [0.7, 0.85]), S('cloth', 0.3, [0.7, 0.85]), S('chop', 0.14, [0.6, 0.7], { delay: 2 })],
    body: [{ dur: 14, gain: 0.18, noise: { filter: 'lowpass', from: 300, to: 1800 } }],
    fallback: [{ dur: 14, gain: 0.3, noise: { filter: 'lowpass', from: 300, to: 1800 } }],
    limit: 3,
  },
  'skill.crush': {
    samples: [S('zap', 0.7, [0.6, 0.8]), S('swish', 0.7, [0.55, 0.65]), S('field', 0.3, [0.7, 0.85])],
    body: [
      { dur: 26, gain: 0.3, osc: { type: 'sawtooth', from: 90, to: 520 } },
      { dur: 22, gain: 0.25, noise: { filter: 'bandpass', from: 200, to: 3600, q: 0.7 } },
    ],
    fallback: [
      { dur: 24, gain: 0.45, noise: { filter: 'bandpass', from: 200, to: 3600, q: 0.7 } },
      { dur: 24, gain: 0.35, osc: { type: 'sawtooth', from: 120, to: 480 } },
    ],
    reverb: 0.25,
  },
  dash: {
    samples: [S('cloth', 0.6, [0.9, 1.2]), S('swish', 0.4, [1.3, 1.5])],
    body: [{ dur: 12, gain: 0.12, noise: { filter: 'bandpass', from: 600, to: 200 } }],
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
    samples: [S('boom', 1, [0.75, 0.85]), S('crunch', 0.7, [0.7, 0.8]), S('clank-heavy', 0.6, [0.55, 0.65]), S('glass-heavy', 0.3, [0.7, 0.8], { delay: 3 })],
    body: [
      { dur: 70, gain: 1, osc: { type: 'sine', from: 56, to: 18 } },
      { dur: 44, gain: 0.5, noise: { filter: 'lowpass', from: 600, to: 60 } },
      // the ringing in your ears
      { dur: 110, gain: 0.05, delay: 6, osc: { type: 'sine', from: 3100, to: 2900 } },
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
    samples: [S('clank-heavy', 0.8, [0.85, 0.95]), S('bell', 0.5, [0.75, 0.85]), S('boom', 0.5, [1.4, 1.6])],
    body: [{ dur: 20, gain: 0.7, osc: { type: 'sine', from: 100, to: 40 } }],
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
