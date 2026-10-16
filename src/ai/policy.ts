import type { Rng } from '../core/rng.ts';
import type { Fighter, World } from '../core/types.ts';
import { BUTTON, MOVE, N_BUTTONS, N_MOVES, buttonMask, moveMask } from './actions.ts';
import type { Action } from './actions.ts';
import type { Tracker } from './features.ts';
import type { Mlp } from './nn.ts';

/** Everything a policy may look at to make one decision. */
export interface DecisionContext {
  world: World;
  me: Fighter;
  opp: Fighter;
  /** The observation (see features.ts). */
  obs: Float32Array;
  /** Legal actions right now (already narrowed by the ground rules). */
  mask: number;
  rng: Rng;
  tracker: Tracker;
}

export interface Decision extends Action {
  /** The network's estimate of how good this situation is (0 for policies without one). */
  value: number;
}

/** Anything that can pick an action: a network, a scripted teacher, a mixture, random. */
export interface Policy {
  decide(ctx: DecisionContext): Decision;
}

// ───────────────────────────── sampling helpers ─────────────────────────────

/** Softmax over `n` logits at `offset`, with illegal entries (bit 0 in `mask`) forced to 0 probability. */
export function maskedSoftmax(logits: Float32Array, offset: number, n: number, mask: number, temperature: number, out: Float32Array): void {
  let max = -Infinity;
  for (let i = 0; i < n; i++) if ((mask >> i) & 1) max = Math.max(max, logits[offset + i]);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const e = (mask >> i) & 1 ? Math.exp((logits[offset + i] - max) / temperature) : 0;
    out[i] = e;
    sum += e;
  }
  if (sum <= 0) {
    // nothing legal: fall back to index 0 (neutral / none are always legal in practice)
    out.fill(0, 0, n);
    out[0] = 1;
    return;
  }
  for (let i = 0; i < n; i++) out[i] /= sum;
}

export function sample(probs: Float32Array, n: number, rng: Rng): number {
  let r = rng.next();
  for (let i = 0; i < n; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  for (let i = n - 1; i >= 0; i--) if (probs[i] > 0) return i;
  return 0;
}

export function argmax(probs: Float32Array, n: number): number {
  let best = 0;
  for (let i = 1; i < n; i++) if (probs[i] > probs[best]) best = i;
  return best;
}

// ───────────────────────────── policies ─────────────────────────────

/** Plays by a trained network. */
export class NetPolicy implements Policy {
  readonly net: Mlp;
  /** 1 = sample as trained; lower = more predictable; higher = more adventurous. */
  temperature: number;
  /** Always take the single most likely action (for tests and evaluation). */
  greedy: boolean;
  private readonly pm = new Float32Array(N_MOVES);
  private readonly pb = new Float32Array(N_BUTTONS);

  constructor(net: Mlp, opts: { temperature?: number; greedy?: boolean } = {}) {
    this.net = net;
    this.temperature = opts.temperature ?? 1;
    this.greedy = opts.greedy ?? false;
  }

  decide(ctx: DecisionContext): Decision {
    const out = this.net.forward(ctx.obs, 1);
    maskedSoftmax(out, 0, N_MOVES, moveMask(ctx.mask), this.temperature, this.pm);
    maskedSoftmax(out, N_MOVES, N_BUTTONS, buttonMask(ctx.mask), this.temperature, this.pb);
    return {
      move: this.greedy ? argmax(this.pm, N_MOVES) : sample(this.pm, N_MOVES, ctx.rng),
      button: this.greedy ? argmax(this.pb, N_BUTTONS) : sample(this.pb, N_BUTTONS, ctx.rng),
      value: out[N_MOVES + N_BUTTONS],
    };
  }
}

/** Uses `primary` with probability `p`, otherwise `fallback`. Used when mixing a learner with its teacher. */
export class MixPolicy implements Policy {
  p: number;
  private readonly primary: Policy;
  private readonly fallback: Policy;
  constructor(primary: Policy, fallback: Policy, p: number) {
    this.primary = primary;
    this.fallback = fallback;
    this.p = p;
  }
  decide(ctx: DecisionContext): Decision {
    return ctx.rng.chance(this.p) ? this.primary.decide(ctx) : this.fallback.decide(ctx);
  }
}

const MOVE_WEIGHTS = [1, 2.2, 1, 0.5, 0.6, 0.25, 0.5];
const BUTTON_WEIGHTS = [3, 2, 1, 0.3, 1, 0.7];

/**
 * A random but SENSIBLE action: only legal choices, weighted toward the everyday ones (mostly
 * walking and jabbing, rarely the ultimate). This is what replaces the AI's own choice when the
 * Randomness slider says so.
 */
export function sensibleRandom(mask: number, rng: Rng): Action {
  const pick = (weights: number[], m: number): number => {
    let total = 0;
    for (let i = 0; i < weights.length; i++) if ((m >> i) & 1) total += weights[i];
    if (total <= 0) return 0;
    let r = rng.next() * total;
    for (let i = 0; i < weights.length; i++) {
      if (!((m >> i) & 1)) continue;
      r -= weights[i];
      if (r <= 0) return i;
    }
    return 0;
  };
  return { move: pick(MOVE_WEIGHTS, moveMask(mask)), button: pick(BUTTON_WEIGHTS, buttonMask(mask)) };
}

/** Pure random play. The weakest opponent there is, and a baseline to beat. */
export class RandomPolicy implements Policy {
  decide(ctx: DecisionContext): Decision {
    return { ...sensibleRandom(ctx.mask, ctx.rng), value: 0 };
  }
}

/** Does nothing. A punching bag, for tests. */
export class IdlePolicy implements Policy {
  decide(): Decision {
    return { move: MOVE.neutral, button: BUTTON.none, value: 0 };
  }
}
