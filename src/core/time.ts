/**
 * THE time metric of the game.
 *
 *   1 F (frame) = 1 simulation tick = FRAME_MS milliseconds.
 *
 * Every duration in the game (startup, hitstop, hitstun, shake, slow-mo,
 * cooldowns, VFX lifetimes...) is written in F. Never in seconds or ms.
 * Change FRAME_MS and the whole game speeds up or slows down coherently.
 */
export const FRAME_MS = 1000 / 60;

/** Convert frames to milliseconds. */
export const fToMs = (f: number): number => f * FRAME_MS;

/** Convert milliseconds to the nearest whole number of frames (min 1). */
export const msToF = (ms: number): number => Math.max(1, Math.round(ms / FRAME_MS));
