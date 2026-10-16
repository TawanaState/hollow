/**
 * SFX RECIPES: sounds are synthesised (WebAudio), so there are no audio files.
 *
 * Keyed by event key (see client/director.ts). For tiered events the engine first
 * looks for '<key>.<tier>' (e.g. 'hit.heavy') then falls back to '<key>'.
 * Replace any entry with a sample later by adding a `sample` loader; the keys stay.
 *
 * dur is in F. gain is 0..1. Every layer runs at once.
 */
export interface SfxLayer {
  dur: number;
  gain: number;
  osc?: { type: OscType; from: number; to: number };
  noise?: { filter: FilterType; from: number; to: number; q?: number };
}
export type OscType = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

export const SFX: Record<string, SfxLayer[]> = {
  'hit.light': [
    { dur: 5, gain: 0.5, noise: { filter: 'bandpass', from: 1800, to: 600, q: 1.2 } },
    { dur: 6, gain: 0.45, osc: { type: 'sine', from: 180, to: 90 } },
  ],
  'hit.medium': [
    { dur: 8, gain: 0.6, noise: { filter: 'lowpass', from: 1400, to: 300 } },
    { dur: 9, gain: 0.55, osc: { type: 'sine', from: 140, to: 60 } },
  ],
  'hit.heavy': [
    { dur: 12, gain: 0.8, noise: { filter: 'lowpass', from: 900, to: 150 } },
    { dur: 15, gain: 0.8, osc: { type: 'sine', from: 100, to: 40 } },
  ],
  'hit.crush': [
    { dur: 24, gain: 1, noise: { filter: 'lowpass', from: 700, to: 80 } },
    { dur: 30, gain: 1, osc: { type: 'sine', from: 70, to: 28 } },
  ],
  counter: [{ dur: 5, gain: 0.18, osc: { type: 'square', from: 900, to: 1500 } }],
  block: [
    { dur: 5, gain: 0.35, noise: { filter: 'highpass', from: 2500, to: 1500 } },
    { dur: 6, gain: 0.3, osc: { type: 'triangle', from: 520, to: 380 } },
  ],
  parry: [
    { dur: 16, gain: 0.35, osc: { type: 'sine', from: 1400, to: 2600 } },
    { dur: 8, gain: 0.3, noise: { filter: 'highpass', from: 6000, to: 4000 } },
  ],
  guardBreak: [
    { dur: 24, gain: 0.7, osc: { type: 'sawtooth', from: 320, to: 60 } },
    { dur: 12, gain: 0.5, noise: { filter: 'bandpass', from: 2000, to: 400 } },
  ],
  skill: [{ dur: 9, gain: 0.22, noise: { filter: 'bandpass', from: 400, to: 2400, q: 0.9 } }],
  'skill.heavy': [{ dur: 14, gain: 0.3, noise: { filter: 'lowpass', from: 300, to: 1800 } }],
  'skill.crush': [
    { dur: 24, gain: 0.45, noise: { filter: 'bandpass', from: 200, to: 3600, q: 0.7 } },
    { dur: 24, gain: 0.35, osc: { type: 'sawtooth', from: 120, to: 480 } },
  ],
  dash: [{ dur: 10, gain: 0.2, noise: { filter: 'bandpass', from: 600, to: 200 } }],
  jump: [{ dur: 5, gain: 0.1, osc: { type: 'sine', from: 220, to: 440 } }],
  land: [{ dur: 6, gain: 0.3, noise: { filter: 'lowpass', from: 400, to: 100 } }],
  knockdown: [
    { dur: 12, gain: 0.6, osc: { type: 'sine', from: 90, to: 45 } },
    { dur: 10, gain: 0.4, noise: { filter: 'lowpass', from: 500, to: 100 } },
  ],
  ko: [
    { dur: 50, gain: 1, osc: { type: 'sine', from: 60, to: 20 } },
    { dur: 40, gain: 0.7, noise: { filter: 'lowpass', from: 600, to: 60 } },
  ],
  roundGo: [{ dur: 18, gain: 0.2, osc: { type: 'sine', from: 880, to: 880 } }],
  roundStart: [{ dur: 14, gain: 0.15, osc: { type: 'sine', from: 440, to: 440 } }],
};
