import { PHYSICS } from '../content/config.ts';
import { AI } from '../content/ai.ts';
import { SKILLS } from '../content/skills.ts';
import { STATES } from '../content/states.ts';
import { Btn, has } from '../core/input.ts';
import type { InputFrame } from '../core/input.ts';
import type { Facing, Fighter } from '../core/types.ts';

/**
 * THE ACTION SPACE. Every decision (every AI.decisionFrames F) is one MOVE and one BUTTON,
 * chosen independently. 7 x 6 = 42 combinations from just 13 outputs, which is small enough
 * to learn quickly and still covers everything a player can do (a sweep is `down` + `heavy`,
 * a jump-in kick is `upForward` then `light` in the air, a running dash is `forward` + `dash`).
 *
 * "forward" and "back" are relative to which way the fighter faces, so what the AI learns
 * works from either side of the screen.
 */
export const MOVES = ['neutral', 'forward', 'back', 'up', 'upForward', 'upBack', 'down'] as const;
export const BUTTONS = ['none', 'light', 'heavy', 'skill', 'guard', 'dash'] as const;
export const N_MOVES = MOVES.length;
export const N_BUTTONS = BUTTONS.length;
/** Network outputs: move logits, button logits, then one value estimate. */
export const N_OUT = N_MOVES + N_BUTTONS + 1;

export const MOVE = { neutral: 0, forward: 1, back: 2, up: 3, upForward: 4, upBack: 5, down: 6 } as const;
export const BUTTON = { none: 0, light: 1, heavy: 2, skill: 3, guard: 4, dash: 5 } as const;

export interface Action {
  move: number;
  button: number;
}

export const isJumpMove = (m: number): boolean => m === MOVE.up || m === MOVE.upForward || m === MOVE.upBack;

/** Does this action press an attack button? */
export const isAttackButton = (b: number): boolean => b === BUTTON.light || b === BUTTON.heavy || b === BUTTON.skill;

// ───────────────────────────── action -> inputs ─────────────────────────────

/**
 * The buttons to hold on frame `k` (0-based) of a decision window.
 *   - directions, guard and dash are HELD for the whole window (so a dash keeps running if chosen again)
 *   - attack buttons and jump are PULSED on the first two frames, then released, so the next
 *     window's press is a fresh press (that is how a jab-cross-kick string gets its timing)
 */
export function actionToBits(a: Action, facing: Facing, k: number): InputFrame {
  const fwd = facing === 1 ? Btn.RIGHT : Btn.LEFT;
  const back = facing === 1 ? Btn.LEFT : Btn.RIGHT;
  let bits = 0;
  switch (a.move) {
    case MOVE.forward:
      bits |= fwd;
      break;
    case MOVE.back:
      bits |= back;
      break;
    case MOVE.down:
      bits |= Btn.DOWN;
      break;
    case MOVE.up:
      if (k < 2) bits |= Btn.UP;
      break;
    case MOVE.upForward:
      bits |= fwd;
      if (k < 2) bits |= Btn.UP;
      break;
    case MOVE.upBack:
      bits |= back;
      if (k < 2) bits |= Btn.UP;
      break;
  }
  switch (a.button) {
    case BUTTON.light:
      if (k < 2) bits |= Btn.LIGHT;
      break;
    case BUTTON.heavy:
      if (k < 2) bits |= Btn.HEAVY;
      break;
    case BUTTON.skill:
      if (k < 2) bits |= Btn.SKILL;
      break;
    case BUTTON.guard:
      bits |= Btn.GUARD;
      break;
    case BUTTON.dash:
      bits |= Btn.DASH;
      break;
  }
  return bits;
}

/**
 * The reverse: what action does a window of real inputs correspond to? Used to learn from
 * recorded human play. `prev` is the input on the frame before the window (to see fresh presses).
 */
export function bitsToAction(window: readonly InputFrame[], prev: InputFrame, facing: Facing): Action {
  const fwd = facing === 1 ? Btn.RIGHT : Btn.LEFT;
  const back = facing === 1 ? Btn.LEFT : Btn.RIGHT;
  let last = prev;
  let pressed = 0; // buttons newly pressed inside the window
  let held = 0; // buttons held for at least half of it
  const count = new Map<number, number>();
  for (const bits of window) {
    pressed |= bits & ~last;
    last = bits;
    for (const b of [Btn.LEFT, Btn.RIGHT, Btn.DOWN, Btn.GUARD, Btn.DASH]) if (has(bits, b)) count.set(b, (count.get(b) ?? 0) + 1);
  }
  for (const [b, c] of count) if (c * 2 >= window.length) held |= b;

  let move: number = MOVE.neutral;
  const goesFwd = has(held, fwd) && !has(held, back);
  const goesBack = has(held, back) && !has(held, fwd);
  if (has(pressed, Btn.UP)) move = goesFwd ? MOVE.upForward : goesBack ? MOVE.upBack : MOVE.up;
  else if (has(held, Btn.DOWN)) move = MOVE.down;
  else if (goesFwd) move = MOVE.forward;
  else if (goesBack) move = MOVE.back;

  let button: number = BUTTON.none;
  if (has(pressed, Btn.SKILL)) button = BUTTON.skill;
  else if (has(pressed, Btn.HEAVY)) button = BUTTON.heavy;
  else if (has(pressed, Btn.LIGHT)) button = BUTTON.light;
  else if (has(held, Btn.GUARD)) button = BUTTON.guard;
  else if (has(held, Btn.DASH) || has(pressed, Btn.DASH)) button = BUTTON.dash;
  return { move, button };
}

// ───────────────────────────── legality ─────────────────────────────

/**
 * Which actions can actually do something right now. A mask is one number: the low 7 bits are
 * the legal moves, the next 6 are the legal buttons. Illegal choices are removed before the AI
 * picks (and ignored when it learns), so it never wastes decisions on things the game would
 * ignore, like attacking while knocked down.
 */
export const ALL_MOVES = (1 << N_MOVES) - 1;
export const ALL_BUTTONS = (1 << N_BUTTONS) - 1;
export const FULL_MASK = ALL_MOVES | (ALL_BUTTONS << N_MOVES);

export const moveMask = (mask: number): number => mask & ALL_MOVES;
export const buttonMask = (mask: number): number => (mask >> N_MOVES) & ALL_BUTTONS;
export const makeMask = (moves: number, buttons: number): number => (moves & ALL_MOVES) | ((buttons & ALL_BUTTONS) << N_MOVES);

const JUMPS = (1 << MOVE.up) | (1 << MOVE.upForward) | (1 << MOVE.upBack);

/** Can this attack button start or continue something right now? */
function attackLegal(f: Fighter, button: 'light' | 'heavy' | 'skill'): boolean {
  const air = f.y > 0;
  if (f.state === 'attack' && f.skill) {
    // only through a cancel rule that is open: after a hit/block, or an always-rule
    const sk = SKILLS[f.skill];
    return (sk.cancels ?? []).some((rule) => {
      const open = rule.on === 'always' || f.skillHit || (rule.on === 'contact' && f.skillBlocked);
      return open && rule.into.some((id) => SKILLS[id]?.input.button === button);
    });
  }
  for (const sk of Object.values(SKILLS)) {
    if (sk.input.button !== button || sk.chainOnly || !!sk.input.air !== air) continue;
    if ((sk.cost ?? 0) <= f.energy) return true;
  }
  return false;
}

export function legalMask(f: Fighter): number {
  const st = STATES[f.state];
  const grounded = !st.air && f.y <= 0;

  // helpless: reeling, knocked down, landing
  if (!st.actionable && f.state !== 'attack' && f.state !== 'dash' && f.state !== 'blockstun') {
    return makeMask(1 << MOVE.neutral, 1 << BUTTON.none);
  }

  let moves = ALL_MOVES;
  if (!(st.actionable && grounded)) moves &= ~JUMPS;

  let buttons = 1 << BUTTON.none;
  if (f.state === 'blockstun') {
    // keep holding guard through the block so you are still guarding when it ends
    if ((f.cooldown.guard ?? 0) <= 0) buttons |= 1 << BUTTON.guard;
    return makeMask(moves & ~JUMPS, buttons);
  }
  if (f.state === 'dash') {
    buttons |= 1 << BUTTON.dash;
    if (f.stateF >= PHYSICS.dash.cancelAfter) {
      if (attackLegal({ ...f, state: 'idle' }, 'light')) buttons |= 1 << BUTTON.light;
      if (attackLegal({ ...f, state: 'idle' }, 'heavy')) buttons |= 1 << BUTTON.heavy;
      if (attackLegal({ ...f, state: 'idle' }, 'skill')) buttons |= 1 << BUTTON.skill;
    }
    return makeMask(moves & ~JUMPS, buttons);
  }
  if (attackLegal(f, 'light')) buttons |= 1 << BUTTON.light;
  if (attackLegal(f, 'heavy')) buttons |= 1 << BUTTON.heavy;
  if (attackLegal(f, 'skill')) buttons |= 1 << BUTTON.skill;
  if (f.state === 'attack') {
    // a dash cancel, if one is open
    const sk = f.skill ? SKILLS[f.skill] : null;
    const open = sk?.cancels?.some((r) => r.into.includes('dash') && (r.on === 'always' || f.skillHit || f.skillBlocked));
    if (open && grounded && (f.cooldown.dash ?? 0) <= 0) buttons |= 1 << BUTTON.dash;
    return makeMask(moves & ~JUMPS, buttons);
  }
  if (grounded && st.actionable) {
    if ((f.cooldown.guard ?? 0) <= 0) buttons |= 1 << BUTTON.guard;
    if ((f.cooldown.dash ?? 0) <= 0) buttons |= 1 << BUTTON.dash;
  }
  return makeMask(moves, buttons);
}

/** Replace any illegal part of an action with the neutral choice. */
export function sanitize(a: Action, mask: number): Action {
  return {
    move: (moveMask(mask) >> a.move) & 1 ? a.move : MOVE.neutral,
    button: (buttonMask(mask) >> a.button) & 1 ? a.button : BUTTON.none,
  };
}

/** How many decisions fit in a number of frames (for timing maths). */
export const decisions = (frames: number): number => Math.ceil(frames / AI.decisionFrames);
