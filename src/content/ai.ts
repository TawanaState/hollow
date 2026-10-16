/**
 * AI TUNING: everything about how the learning opponents think and are kept in check.
 * Durations are in F, like the rest of the game (see docs/time-and-units.md).
 */
export const AI = {
  /** The AI decides this often. 4 F = 15 decisions a second: human-like, and cheap on a phone. */
  decisionFrames: 4,
  /** How many past opponent behaviours the AI remembers (it reads habits from these). */
  historyLen: 12,
  /** Reaction delay range exposed to players (F between something happening and the AI seeing it). */
  reaction: { min: 0, max: 24, default: 8 },
  /** Reward discount per decision. 0.98 per 4 F is roughly a 3 second horizon. */
  gamma: 0.98,
  /** Cap for practice matches (F of actual fighting, not counting the intro). */
  matchFrames: 3600,
  /** A random override lasts this many decisions on average (so random play looks like flailing, not jitter). */
  randomRunLength: 2,
  /** Keep this many past versions of each persona so a bad update can be rolled back. */
  keepVersions: 5,
  /** Recent matches kept for learning, plus a few older ones as a reminder. */
  recentMatches: 24,
  rehearsalMatches: 8,
  /** Match recordings older than this are thrown away by the tidy-up (the newest ones are always kept). */
  replayMaxAgeDays: 90,
} as const;

/**
 * GROUND RULES: actions the AI may not repeat too many times in a row, however much it likes
 * them. After `maxConsecutive` decisions in a row the action is switched off for `cooldown`
 * decisions. The same rules apply in training, so the AI learns to live with them.
 * `names` refer to MOVES / BUTTONS in src/ai/actions.ts.
 */
export interface GuardRule {
  name: string;
  head: 'move' | 'button';
  names: readonly string[];
  maxConsecutive: number;
  cooldown: number;
}

export const GUARDRAILS: readonly GuardRule[] = [
  { name: 'no bunny-hopping', head: 'move', names: ['up', 'upForward', 'upBack'], maxConsecutive: 1, cooldown: 5 },
  { name: 'dash for a bit, not forever', head: 'button', names: ['dash'], maxConsecutive: 16, cooldown: 3 },
  { name: 'no jab spam', head: 'button', names: ['light'], maxConsecutive: 6, cooldown: 2 },
  { name: 'no heavy spam', head: 'button', names: ['heavy'], maxConsecutive: 2, cooldown: 3 },
  { name: 'ultimate is special', head: 'button', names: ['skill'], maxConsecutive: 1, cooldown: 8 },
  { name: 'no endless turtling', head: 'button', names: ['guard'], maxConsecutive: 14, cooldown: 3 },
  { name: 'no endless crouching', head: 'move', names: ['down'], maxConsecutive: 12, cooldown: 3 },
  { name: 'no endless retreating', head: 'move', names: ['back'], maxConsecutive: 12, cooldown: 4 },
  { name: 'no standing still', head: 'move', names: ['neutral'], maxConsecutive: 18, cooldown: 2 },
];

/**
 * REWARD STYLES: what each kind of persona is paid for when it practises against itself.
 * All numbers are per decision, on top of the big terminal reward for winning or losing.
 *   damage     per 1000 HP it deals
 *   taken      per 1000 HP it loses
 *   engage     paid every decision nobody is hurt (negative = discourages stalling)
 *   close      paid for being within striking distance
 *   guardWell  paid for a parry or a block
 */
export interface RewardStyle {
  damage: number;
  taken: number;
  engage: number;
  close: number;
  guardWell: number;
}

export const STYLES = {
  neutral: { damage: 5, taken: 5, engage: -0.002, close: 0, guardWell: 0.02 },
  /** Rushdown: loves pressure, pays less attention to damage taken. */
  ember: { damage: 6, taken: 3.5, engage: -0.004, close: 0.004, guardWell: 0.01 },
  /** Defensive counter-fighter: hates being hit, loves clean blocks and parries. */
  stone: { damage: 4.5, taken: 6.5, engage: -0.001, close: 0, guardWell: 0.06 },
  /** All-rounder. */
  echo: { damage: 5, taken: 5, engage: -0.002, close: 0.001, guardWell: 0.03 },
} as const satisfies Record<string, RewardStyle>;

export type StyleId = keyof typeof STYLES;

/**
 * DIFFICULTY PRESETS: shortcuts for the two dials on a student (see docs/ai.md).
 *
 * REACTION is the main handicap: a student's choices take effect that many frames late. The
 * brains win by reflex (they block a jab as it starts), so every frame of delay costs them a lot.
 * Measured against a decent human stand-in (12 frame reaction, 20% sloppy), a student wins about:
 *   Brutal 100%   Hard ~90%   Normal ~65%   Easy ~20%
 * RANDOMNESS is a light seasoning on top: it makes play less predictable and a little sloppier.
 */
export const DIFFICULTY = {
  easy: { label: 'Easy', randomness: 0.35, reaction: 17 },
  normal: { label: 'Normal', randomness: 0.2, reaction: 12 },
  hard: { label: 'Hard', randomness: 0.1, reaction: 8 },
  brutal: { label: 'Brutal', randomness: 0, reaction: 0 },
} as const;

export type DifficultyId = keyof typeof DIFFICULTY;

/** Which preset do these dial settings match (give or take a notch)? 'custom' if none. */
export function difficultyOf(s: { randomness: number; reaction: number }): DifficultyId | 'custom' {
  for (const [id, d] of Object.entries(DIFFICULTY)) {
    if (Math.abs(d.randomness - s.randomness) <= 0.03 && Math.abs(d.reaction - s.reaction) <= 1) return id as DifficultyId;
  }
  return 'custom';
}
