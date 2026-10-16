/**
 * Input model. Everything that can control a fighter (keyboard, touch, network,
 * a bot, a replay) produces the same thing: one InputFrame per tick, a bitmask
 * of what is HELD right now. The sim derives presses (edges) itself.
 *
 * LEFT / RIGHT are absolute (screen) directions. Whether that means "forward"
 * or "back" depends on which way the fighter faces, and the sim resolves it.
 */
export const Btn = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  LIGHT: 16,
  HEAVY: 32,
  SKILL: 64,
  GUARD: 128,
  DASH: 256,
} as const;

/** A bitmask of Btn values held during one tick. */
export type InputFrame = number;

/** Presses (rising edges) that the sim buffers. */
export type Action = 'light' | 'heavy' | 'skill' | 'guard' | 'dash' | 'jump';

export const ACTION_BITS: Record<Action, number> = {
  light: Btn.LIGHT,
  heavy: Btn.HEAVY,
  skill: Btn.SKILL,
  guard: Btn.GUARD,
  dash: Btn.DASH,
  jump: Btn.UP,
};

export const ACTIONS = Object.keys(ACTION_BITS) as Action[];

export const has = (input: InputFrame, bit: number): boolean => (input & bit) !== 0;

/** Human-readable list of held buttons, e.g. "RIGHT+LIGHT". Used by logs. */
export function describeInput(input: InputFrame): string {
  const names = Object.entries(Btn)
    .filter(([, bit]) => has(input, bit))
    .map(([name]) => name);
  return names.length ? names.join('+') : 'NEUTRAL';
}
