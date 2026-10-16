import { AI } from '../content/ai.ts';
import type { RewardStyle } from '../content/ai.ts';
import type { InputFrame } from '../core/input.ts';
import { createRng } from '../core/rng.ts';
import type { Rng } from '../core/rng.ts';
import { createWorld, step } from '../core/sim.ts';
import type { FighterId } from '../core/types.ts';
import { N_BUTTONS, N_MOVES, N_OUT, bitsToAction, buttonMask, legalMask, moveMask } from './actions.ts';
import { duel, playMatch } from './arena.ts';
import type { Score, Seat, Trajectory } from './arena.ts';
import { now } from './clock.ts';
import { Dataset } from './dataset.ts';
import { OBS_DIM, Tracker, encode } from './features.ts';
import { Mlp } from './nn.ts';
import { NetPolicy, maskedSoftmax } from './policy.ts';

/**
 * LEARNING. Two ways to improve a brain, both plain supervised-style updates on the small network:
 *
 *   IMITATION (train)   "do what this player did in this situation". Used to learn from the
 *                       human's recorded matches and to copy the teacher bots.
 *   REINFORCEMENT       advantage-weighted regression: play practice matches, work out which
 *                       decisions turned out better than expected, and imitate those more.
 *                       It is stable, needs no replay-buffer tricks, and runs fine on a phone.
 *
 * Both can be anchored: a gentle pull back toward the persona's starting weights, so a few
 * matches cannot drag a persona's whole personality somewhere strange.
 */

export interface TrainOptions {
  steps: number;
  batch: number;
  lr: number;
  weightDecay?: number;
  /** Soft targets: spread this much probability over the other legal actions. */
  labelSmoothing?: number;
  /** Weight of the value-estimate loss (reinforcement only). */
  valueCoef?: number;
  /** Bonus for keeping choices varied (reinforcement only). */
  entropy?: number;
  anchor?: { weights: Float32Array[]; lambda: number };
  /** A second dataset mixed into every batch (e.g. the human's moves while doing reinforcement). */
  aux?: { data: Dataset; fraction: number };
  /** Stop early at this time (ms on the `now()` clock). */
  deadline?: number;
  rng: Rng;
}

export interface TrainStats {
  steps: number;
  loss: number;
  /** How often the network's top choice matched the target (imitation sanity check). */
  moveAcc: number;
  buttonAcc: number;
  ms: number;
}

/** Cross-entropy gradient for one head, with legality mask, label smoothing and a sample weight. */
function headGrad(out: Float32Array, off: number, n: number, mask: number, target: number, weight: number, smooth: number, probs: Float32Array, dOut: Float32Array, dOff: number, scale: number): { loss: number; correct: boolean } {
  maskedSoftmax(out, off, n, mask, 1, probs);
  if (!((mask >> target) & 1)) return { loss: 0, correct: false }; // the target was not even legal: skip it
  let legal = 0;
  for (let k = 0; k < n; k++) if ((mask >> k) & 1) legal++;
  let loss = 0;
  let best = 0;
  for (let k = 0; k < n; k++) {
    if (!((mask >> k) & 1)) continue;
    const t = (1 - smooth) * (k === target ? 1 : 0) + smooth / legal;
    dOut[dOff + k] += weight * (probs[k] - t) * scale;
    if (t > 0) loss -= weight * t * Math.log(Math.max(1e-9, probs[k]));
    if (probs[k] > probs[best]) best = k;
  }
  return { loss, correct: best === target };
}

/** Entropy-bonus gradient: pushes the distribution toward being a little less sure of itself. */
function entropyGrad(probs: Float32Array, n: number, mask: number, coef: number, dOut: Float32Array, dOff: number, scale: number): void {
  let h = 0;
  for (let k = 0; k < n; k++) if (probs[k] > 1e-9) h -= probs[k] * Math.log(probs[k]);
  for (let k = 0; k < n; k++) {
    if (!((mask >> k) & 1) || probs[k] <= 1e-9) continue;
    dOut[dOff + k] += coef * probs[k] * (Math.log(probs[k]) + h) * scale;
  }
}

/** Train `net` on `ds` (plus optional aux data). Works for both imitation and weighted reinforcement targets. */
export function train(net: Mlp, ds: Dataset, o: TrainOptions): TrainStats {
  const t0 = now();
  if (ds.size === 0 && !(o.aux && o.aux.data.size > 0)) return { steps: 0, loss: 0, moveAcc: 0, buttonAcc: 0, ms: 0 };
  const B = o.batch;
  const X = new Float32Array(B * OBS_DIM);
  const dOut = new Float32Array(B * N_OUT);
  const pm = new Float32Array(N_MOVES);
  const pb = new Float32Array(N_BUTTONS);
  const idx = new Int32Array(B);
  const smooth = o.labelSmoothing ?? 0;
  const nAux = o.aux && o.aux.data.size > 0 ? Math.round(B * o.aux.fraction) : 0;
  const nMain = ds.size > 0 ? B - nAux : 0;
  const nAuxReal = nMain === 0 ? B : nAux;
  const scale = 1 / B;
  let lossSum = 0;
  let mHit = 0;
  let bHit = 0;
  let counted = 0;
  let done = 0;

  for (let step = 0; step < o.steps; step++) {
    if (o.deadline !== undefined && step % 8 === 0 && now() > o.deadline) break;
    if (nMain > 0) ds.sample(o.rng, nMain, idx);
    if (nAuxReal > 0 && o.aux) {
      const tmp = new Int32Array(nAuxReal);
      o.aux.data.sample(o.rng, nAuxReal, tmp);
      idx.set(tmp, nMain);
    }
    for (let s = 0; s < B; s++) {
      const src = s < nMain ? ds : o.aux!.data;
      X.set(src.obs.subarray(idx[s] * OBS_DIM, (idx[s] + 1) * OBS_DIM), s * OBS_DIM);
    }
    const out = net.forward(X, B);
    dOut.fill(0);
    for (let s = 0; s < B; s++) {
      const fromMain = s < nMain;
      const src = fromMain ? ds : o.aux!.data;
      const i = idx[s];
      const w = src.weight[i];
      const mask = src.mask[i];
      const base = s * N_OUT;
      const m = headGrad(out, base, N_MOVES, moveMask(mask), src.move[i], w, smooth, pm, dOut, base, scale);
      const b = headGrad(out, base + N_MOVES, N_BUTTONS, buttonMask(mask), src.button[i], w, smooth, pb, dOut, base + N_MOVES, scale);
      lossSum += m.loss + b.loss;
      if (m.correct) mHit++;
      if (b.correct) bHit++;
      counted++;
      if (fromMain && o.entropy) {
        maskedSoftmax(out, base, N_MOVES, moveMask(mask), 1, pm);
        entropyGrad(pm, N_MOVES, moveMask(mask), o.entropy, dOut, base, scale);
        maskedSoftmax(out, base + N_MOVES, N_BUTTONS, buttonMask(mask), 1, pb);
        entropyGrad(pb, N_BUTTONS, buttonMask(mask), o.entropy, dOut, base + N_MOVES, scale);
      }
      if (fromMain && o.valueCoef) {
        const diff = Math.max(-3, Math.min(3, out[base + N_MOVES + N_BUTTONS] - src.ret[i]));
        dOut[base + N_MOVES + N_BUTTONS] = o.valueCoef * diff * scale;
      }
    }
    net.backward(dOut, B);
    net.step({ lr: o.lr, weightDecay: o.weightDecay ?? 1e-4, clip: 1, anchor: o.anchor });
    done++;
  }
  return { steps: done, loss: lossSum / Math.max(1, counted), moveAcc: mHit / Math.max(1, counted), buttonAcc: bHit / Math.max(1, counted), ms: now() - t0 };
}

// ───────────────────────────── reinforcement ─────────────────────────────

/** Discounted return from every decision to the end of the match. */
export function computeReturns(t: Trajectory, gamma: number): Float32Array {
  const out = new Float32Array(t.n);
  let g = 0;
  for (let i = t.n - 1; i >= 0; i--) {
    g = t.reward[i] + gamma * g;
    out[i] = g;
  }
  return out;
}

/** Add a recorded match to a dataset, leaving out decisions the Randomness dial made. Returns how many were added. */
export function addTrajectory(ds: Dataset, t: Trajectory, gamma = AI.gamma): number {
  const ret = computeReturns(t, gamma);
  let added = 0;
  for (let i = 0; i < t.n; i++) {
    if (t.random[i]) continue;
    ds.add(t.obs.subarray(i * OBS_DIM, (i + 1) * OBS_DIM), t.move[i], t.button[i], t.mask[i], 1, ret[i]);
    added++;
  }
  return added;
}

/** Add a match for IMITATION of a teacher: the labels are what the teacher would have done there. */
export function addLabelled(ds: Dataset, t: Trajectory): number {
  for (let i = 0; i < t.n; i++) ds.add(t.obs.subarray(i * OBS_DIM, (i + 1) * OBS_DIM), t.labelMove[i], t.labelButton[i], t.mask[i], 1, 0);
  return t.n;
}

/**
 * Advantage weights (the "A" in AWR): how much better than expected did each decision turn out?
 * Decisions that beat the network's own value estimate get imitated more, worse ones less.
 */
export function weightByAdvantage(net: Mlp, ds: Dataset, beta = 1, maxWeight = 8): { meanAdv: number } {
  const n = ds.size;
  if (n === 0) return { meanAdv: 0 };
  const adv = new Float32Array(n);
  const chunk = 128;
  const X = new Float32Array(chunk * OBS_DIM);
  let sum = 0;
  for (let at = 0; at < n; at += chunk) {
    const m = Math.min(chunk, n - at);
    X.set(ds.obs.subarray(at * OBS_DIM, (at + m) * OBS_DIM));
    const out = net.forward(X, m);
    for (let k = 0; k < m; k++) {
      adv[at + k] = ds.ret[at + k] - out[k * N_OUT + N_MOVES + N_BUTTONS];
      sum += adv[at + k];
    }
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (adv[i] - mean) ** 2;
  const std = Math.sqrt(varSum / n) + 1e-6;
  for (let i = 0; i < n; i++) ds.weight[i] = Math.min(maxWeight, Math.exp((adv[i] - mean) / std / beta));
  return { meanAdv: mean };
}

// ───────────────────────────── learning from a human's recorded matches ─────────────────────────────

/** A recorded match plus which seat the human was in. */
export interface HumanMatch {
  inputs: readonly (readonly [InputFrame, InputFrame])[];
  slot: FighterId;
}

/**
 * Re-run a recorded match and turn the human's play into training examples: at every decision
 * point, what the human could see, what they could legally do, and what they actually did.
 * Because the sim is deterministic, this reproduces exactly what the human saw.
 */
export function extractHumanSamples(match: HumanMatch, ds: Dataset): number {
  const w = createWorld();
  const me = match.slot;
  const tracker = new Tracker();
  const obs = new Float32Array(OBS_DIM);
  let fightFrame = 0;
  let inFight = false;
  let added = 0;
  const F = AI.decisionFrames;

  for (let f = 0; f < match.inputs.length; f++) {
    if (w.phase === 'fight') {
      if (!inFight) {
        inFight = true;
        fightFrame = 0;
        tracker.reset();
      }
      if (fightFrame % F === 0) {
        const fighter = w.fighters[me];
        const opp = w.fighters[me === 0 ? 1 : 0];
        tracker.observe(opp, fighter);
        const mask = legalMask(fighter);
        const window: InputFrame[] = [];
        for (let k = 0; k < F && f + k < match.inputs.length; k++) window.push(match.inputs[f + k][me]);
        const prev = f > 0 ? match.inputs[f - 1][me] : 0;
        const action = bitsToAction(window, prev, fighter.facing);
        const helpless = moveMask(mask) === 1 && buttonMask(mask) === 1;
        if (!helpless && window.length === F) {
          encode(fighter, opp, tracker, w.hitstop, obs);
          ds.add(obs, action.move, action.button, mask, 1, 0);
          added++;
        }
        tracker.remember(action);
      }
      fightFrame++;
    } else {
      inFight = false;
    }
    step(w, match.inputs[f]);
  }
  return added;
}

/**
 * Even out the weights so a human who stands still 60% of the time does not teach the AI to stand
 * still: each distinct (move, button) pair is weighted by one over the square root of how common it is.
 */
export function balanceWeights(ds: Dataset): void {
  const counts = new Map<number, number>();
  for (let i = 0; i < ds.size; i++) {
    const key = ds.move[i] * 16 + ds.button[i];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let total = 0;
  for (let i = 0; i < ds.size; i++) {
    const w = 1 / Math.sqrt(counts.get(ds.move[i] * 16 + ds.button[i])!);
    ds.weight[i] = w;
    total += w;
  }
  const norm = ds.size / Math.max(total, 1e-9);
  for (let i = 0; i < ds.size; i++) ds.weight[i] *= norm;
}

// ───────────────────────────── practice and the promotion gate ─────────────────────────────

export interface Opponent {
  name: string;
  seat: () => Seat;
}

/** Average result of a policy against a set of opponents (sides swapped, same seeds). */
export function evaluate(policy: Seat['policy'], opponents: readonly Opponent[], matchesEach: number, seed: number): Score {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let matches = 0;
  for (const opp of opponents) {
    const s = duel({ policy }, opp.seat(), matchesEach, seed);
    wins += s.wins;
    losses += s.losses;
    draws += s.draws;
    matches += s.matches;
  }
  return { wins, losses, draws, matches, rate: (wins + draws / 2) / Math.max(1, matches) };
}

export interface PracticeOptions {
  /** The brain being improved. It is updated in place only if it passes the gate. */
  net: Mlp;
  style: RewardStyle;
  opponents: readonly Opponent[];
  /** The (smaller) set used to check the new version against the old. Defaults to all opponents. */
  gateOpponents?: readonly Opponent[];
  /** Imitation data from the human to keep mixing in (keeps the persona's personality). */
  anchorData?: Dataset;
  anchorFraction?: number;
  /** Weights to pull toward (the persona's base). */
  anchor?: { weights: Float32Array[]; lambda: number };
  seed: number;
  /** Practice matches to play and learn from. */
  matches: number;
  trainSteps: number;
  lr?: number;
  /** Matches per opponent when checking the new version against the old. */
  gateMatches?: number;
  /** How much worse than the old version the new one may score and still be kept. */
  gateTolerance?: number;
  deadline?: number;
  onProgress?: (note: string, done: number, total: number) => void;
}

export interface PracticeResult {
  accepted: boolean;
  before: number;
  after: number;
  samples: number;
  train: TrainStats;
  ms: number;
}

/**
 * One generation of getting better: play practice matches, learn from the decisions that worked,
 * then check the candidate against the previous version and only keep it if it did not get worse.
 */
export function practice(o: PracticeOptions): PracticeResult {
  const t0 = now();
  const rng = createRng(o.seed);
  const cap = Math.max(4000, o.matches * (AI.matchFrames / AI.decisionFrames));
  const ds = new Dataset(cap);
  const learner = o.net.clone();
  // a time budget is split: about half practising, then learning, with the rest for the check
  const span = o.deadline !== undefined ? o.deadline - t0 : Infinity;
  const matchDeadline = t0 + span * 0.5;
  const trainDeadline = t0 + span * 0.8;
  let played = 0;
  for (; played < o.matches; played++) {
    if (now() > matchDeadline) break;
    const opp = o.opponents[played % o.opponents.length];
    // the learner plays one side (alternating) while its decisions and rewards are recorded
    const seed = o.seed + played * 104729;
    const swap = played % 2 === 1;
    const mine: Seat = { policy: new NetPolicy(learner), record: true, style: o.style };
    const result = playMatch(swap ? [opp.seat(), mine] : [mine, opp.seat()], { seed });
    const traj = result.traj[swap ? 1 : 0];
    if (traj) addTrajectory(ds, traj);
    o.onProgress?.('practising', played + 1, o.matches);
  }
  weightByAdvantage(learner, ds);
  const stats = train(learner, ds, {
    steps: o.trainSteps,
    batch: 64,
    lr: o.lr ?? 3e-4,
    labelSmoothing: 0.02,
    valueCoef: 0.5,
    entropy: 0.01,
    anchor: o.anchor,
    aux: o.anchorData && o.anchorData.size > 0 ? { data: o.anchorData, fraction: o.anchorFraction ?? 0.25 } : undefined,
    deadline: Number.isFinite(trainDeadline) ? trainDeadline : undefined,
    rng,
  });
  o.onProgress?.('checking', 0, 1);
  const gateN = o.gateMatches ?? 6;
  const gate = o.gateOpponents ?? o.opponents;
  const before = evaluate(new NetPolicy(o.net), gate, gateN, o.seed + 77);
  const after = evaluate(new NetPolicy(learner), gate, gateN, o.seed + 77);
  const accepted = after.rate + (o.gateTolerance ?? 0.02) >= before.rate;
  if (accepted) o.net.copyFrom(learner);
  return { accepted, before: before.rate, after: after.rate, samples: ds.size, train: stats, ms: now() - t0 };
}
