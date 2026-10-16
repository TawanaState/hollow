import { AI, STYLES } from '../content/ai.ts';
import type { RewardStyle } from '../content/ai.ts';
import { createRng } from '../core/rng.ts';
import { createWorld, step } from '../core/sim.ts';
import type { FighterId, GameEvent, World } from '../core/types.ts';
import { Agent } from './agent.ts';
import type { AgentSettings } from './agent.ts';
import { OBS_DIM } from './features.ts';
import type { Policy } from './policy.ts';
import { REACH } from './tactics.ts';

/** One side of a practice match. */
export interface Seat {
  policy: Policy;
  /** Difficulty dials. Practice defaults to full strength: no randomness, no reaction delay. */
  settings?: Partial<AgentSettings>;
  /** Keep every decision and its reward (for learning). */
  record?: boolean;
  /** For imitation: also note what this policy WOULD do in every state the match visits. */
  labeler?: Policy;
  /** What this seat is paid for. */
  style?: RewardStyle;
}

/** Everything one seat did in a match, one row per decision. */
export interface Trajectory {
  n: number;
  obs: Float32Array;
  move: Uint8Array;
  button: Uint8Array;
  mask: Uint16Array;
  value: Float32Array;
  reward: Float32Array;
  /** 1 where the randomness dial overrode the brain. */
  random: Uint8Array;
  labelMove: Uint8Array;
  labelButton: Uint8Array;
}

export interface MatchResult {
  /** 0 or 1, or -1 for a draw. */
  winner: FighterId | -1;
  /** Frames of actual fighting. */
  frames: number;
  hp: [number, number];
  traj: [Trajectory | null, Trajectory | null];
  /** Every frame's inputs from the very start (only when asked for), so the match can be replayed exactly. */
  inputs: [number, number][] | null;
}

function newTrajectory(capacity: number): Trajectory {
  return {
    n: 0,
    obs: new Float32Array(capacity * OBS_DIM),
    move: new Uint8Array(capacity),
    button: new Uint8Array(capacity),
    mask: new Uint16Array(capacity),
    value: new Float32Array(capacity),
    reward: new Float32Array(capacity),
    random: new Uint8Array(capacity),
    labelMove: new Uint8Array(capacity),
    labelButton: new Uint8Array(capacity),
  };
}

const FULL_STRENGTH: Partial<AgentSettings> = { randomness: 0, reaction: 0, guardrails: true, temperature: 1 };

/** A match is over when someone is K.O.'d or the practice time cap runs out (then more HP wins). */
function judge(w: World): FighterId | -1 {
  if (w.phase === 'ko') return w.winner ?? -1;
  const [a, b] = w.fighters;
  const diff = a.hp / a.maxHp - b.hp / b.maxHp;
  return Math.abs(diff) < 0.05 ? -1 : diff > 0 ? 0 : 1;
}

/**
 * Play one full round, headless, as fast as the CPU allows (a few ms). The same Agent class that
 * plays on screen plays here, so what is learned here is exactly what is used there.
 */
export function playMatch(seats: readonly [Seat, Seat], opts: { seed: number; maxFrames?: number; keepInputs?: boolean; hpScale?: number }): MatchResult {
  const w = createWorld({ hpScale: opts.hpScale });
  const inputs: [number, number][] | null = opts.keepInputs ? [] : null;
  while (w.phase !== 'fight') {
    step(w, [0, 0]);
    inputs?.push([0, 0]);
  }
  const rng = createRng(opts.seed);
  const maxFrames = opts.maxFrames ?? AI.matchFrames;
  const capacity = Math.ceil(maxFrames / AI.decisionFrames) + 8;

  const trajs: [Trajectory | null, Trajectory | null] = [seats[0].record || seats[0].labeler ? newTrajectory(capacity) : null, seats[1].record || seats[1].labeler ? newTrajectory(capacity) : null];
  const styles = [seats[0].style ?? STYLES.neutral, seats[1].style ?? STYLES.neutral];
  const agents = seats.map((seat, i) => {
    const agent = new Agent({
      slot: i as FighterId,
      getWorld: () => w,
      policy: seat.policy,
      settings: { ...FULL_STRENGTH, ...seat.settings },
      seed: rng.int(2 ** 31),
    });
    const t = trajs[i];
    if (t) {
      agent.onDecision = (r) => {
        if (t.n >= capacity) return;
        const at = t.n++;
        t.obs.set(r.obs.subarray(0, OBS_DIM), at * OBS_DIM);
        t.move[at] = r.action.move;
        t.button[at] = r.action.button;
        t.mask[at] = r.mask;
        t.value[at] = r.value;
        t.random[at] = r.random ? 1 : 0;
        const labeler = seat.labeler;
        if (labeler) {
          const me = w.fighters[i];
          const d = labeler.decide({ world: w, me, opp: w.fighters[i === 0 ? 1 : 0], obs: r.obs, mask: r.mask, rng, tracker: agent.tracker });
          t.labelMove[at] = d.move;
          t.labelButton[at] = d.button;
        }
      };
    }
    return agent;
  });

  let fightFrame = 0;
  const hp0: [number, number] = [0, 0];
  let parries: [number, number] = [0, 0]; // good defence in this window, per seat
  let slips: [number, number] = [0, 0]; // got parried / guard broken
  let close = false;

  const closeWindow = (): void => {
    for (let i = 0; i < 2; i++) {
      const t = trajs[i];
      if (!t || t.n === 0) continue;
      const me = w.fighters[i];
      const opp = w.fighters[i === 0 ? 1 : 0];
      const lost = (hp0[i] - me.hp) / me.maxHp;
      const dealt = (hp0[i === 0 ? 1 : 0] - opp.hp) / opp.maxHp;
      const s = styles[i];
      let r = s.damage * dealt - s.taken * lost;
      if (dealt === 0 && lost === 0) r += s.engage;
      if (close) r += s.close;
      r += s.guardWell * parries[i] - s.guardWell * slips[i];
      t.reward[t.n - 1] += r;
    }
    parries = [0, 0];
    slips = [0, 0];
  };

  const note = (e: GameEvent): void => {
    if (e.t === 'PARRY') {
      parries[e.def] += 1;
      slips[e.atk] += 1;
    } else if (e.t === 'BLOCK') parries[e.def] += 0.4;
    else if (e.t === 'GUARD_BREAK') slips[e.id] += 1;
  };

  while (w.phase === 'fight' && fightFrame < maxFrames) {
    const phase = fightFrame % AI.decisionFrames;
    if (phase === 0) {
      hp0[0] = w.fighters[0].hp;
      hp0[1] = w.fighters[1].hp;
      close = Math.abs(w.fighters[0].x - w.fighters[1].x) < REACH.jab.max + 30;
    }
    const bits: [number, number] = [agents[0].poll(), agents[1].poll()];
    inputs?.push(bits);
    const events = step(w, bits);
    for (const e of events) note(e);
    fightFrame++;
    if (phase === AI.decisionFrames - 1 || w.phase !== 'fight') closeWindow();
  }

  const winner = judge(w);
  // the ending: a big reward for winning (or losing), proportional if the clock ran out
  for (let i = 0; i < 2; i++) {
    const t = trajs[i];
    if (!t || t.n === 0) continue;
    const timedOut = (w.phase as string) !== 'ko';
    const sign = winner === -1 ? 0 : winner === i ? 1 : -1;
    t.reward[t.n - 1] += sign * (timedOut ? 1.2 : 3);
  }
  return { winner, frames: fightFrame, hp: [w.fighters[0].hp, w.fighters[1].hp], traj: trajs, inputs };
}

/** How good is `a` against `b`? Plays several matches (swapping sides) and reports the results. */
export interface Score {
  wins: number;
  losses: number;
  draws: number;
  /** 0..1, counting a draw as half. */
  rate: number;
  matches: number;
}

export function duel(a: Seat, b: Seat, matches: number, seed: number): Score {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (let m = 0; m < matches; m++) {
    const swap = m % 2 === 1;
    const r = playMatch(swap ? [b, a] : [a, b], { seed: seed + m * 7919 });
    const mine: FighterId = swap ? 1 : 0;
    if (r.winner === -1) draws++;
    else if (r.winner === mine) wins++;
    else losses++;
  }
  return { wins, losses, draws, rate: (wins + draws / 2) / Math.max(1, matches), matches };
}
