import { GUARDRAILS } from '../content/ai.ts';
import type { GuardRule } from '../content/ai.ts';
import { ALL_MOVES, BUTTONS, MOVES, buttonMask, makeMask, moveMask } from './actions.ts';
import type { Action } from './actions.ts';

interface Live {
  rule: GuardRule;
  /** Indices (into MOVES or BUTTONS) this rule covers. */
  idx: number[];
  streak: number;
  cooldown: number;
}

/**
 * The ground rules (content/ai.ts GUARDRAILS). Tracks how many decisions in a row each kind of
 * action has been used and switches it off for a while once it hits its limit. It only ever
 * removes options: if a rule would leave no legal move at all, it stands down for that decision.
 */
export class Guardrails {
  private readonly live: Live[];

  constructor(rules: readonly GuardRule[] = GUARDRAILS) {
    this.live = rules.map((rule) => ({
      rule,
      idx: rule.names.map((n) => (rule.head === 'move' ? (MOVES as readonly string[]).indexOf(n) : (BUTTONS as readonly string[]).indexOf(n))).filter((i) => i >= 0),
      streak: 0,
      cooldown: 0,
    }));
  }

  reset(): void {
    for (const l of this.live) {
      l.streak = 0;
      l.cooldown = 0;
    }
  }

  /** Remove whatever is currently switched off from `mask`. */
  apply(mask: number): number {
    let moves = moveMask(mask);
    let buttons = buttonMask(mask);
    for (const l of this.live) {
      if (l.cooldown <= 0 && l.streak < l.rule.maxConsecutive) continue;
      for (const i of l.idx) {
        if (l.rule.head === 'move') moves &= ~(1 << i);
        else buttons &= ~(1 << i);
      }
    }
    // never leave the AI with nothing to do
    if (moves === 0) moves = moveMask(mask) & ALL_MOVES;
    return makeMask(moves, buttons);
  }

  /** Note the action actually taken, so streaks and cooldowns advance. */
  record(a: Action): void {
    for (const l of this.live) {
      if (l.cooldown > 0) l.cooldown--;
      const used = l.rule.head === 'move' ? l.idx.includes(a.move) : l.idx.includes(a.button);
      l.streak = used ? l.streak + 1 : 0;
      if (l.streak >= l.rule.maxConsecutive) l.cooldown = l.rule.cooldown + 1;
    }
  }
}
