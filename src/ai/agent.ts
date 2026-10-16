import { AI } from '../content/ai.ts';
import type { InputFrame, InputSource } from '../core/index.ts';
import { createRng } from '../core/rng.ts';
import type { Rng } from '../core/rng.ts';
import type { Facing, FighterId, World } from '../core/types.ts';
import { actionToBits, legalMask, sanitize } from './actions.ts';
import type { Action } from './actions.ts';
import { OBS_DIM, Tracker, encode } from './features.ts';
import { Guardrails } from './guardrails.ts';
import { sensibleRandom } from './policy.ts';
import type { Policy } from './policy.ts';

/**
 * THE DIFFICULTY DIALS. These are what a player can change on a persona, and they work on any
 * brain, trained or not.
 */
export interface AgentSettings {
  /**
   * 0..1: the share of decisions where the AI's choice is thrown away and a random (but legal and
   * sensible) action is played instead. 0 = full strength, 0.5 = half its decisions are random.
   */
  randomness: number;
  /** F between the AI making a choice and its hands acting on it (its reaction time). */
  reaction: number;
  /** Apply the ground rules (no endless jab spam, etc). */
  guardrails: boolean;
  /** 1 = as trained. Lower = more predictable, higher = more adventurous. */
  temperature: number;
}

export const DEFAULT_SETTINGS: AgentSettings = {
  randomness: 0.1,
  reaction: AI.reaction.default,
  guardrails: true,
  temperature: 1,
};

/** What was decided, for anything that wants to learn from it (self-play recording). */
export interface DecisionRecord {
  obs: Float32Array;
  mask: number;
  action: Action;
  value: number;
  /** True when the Randomness dial overrode the brain (do not learn from these). */
  random: boolean;
}

/**
 * An AI player. It is just an InputSource, so it plugs into the same router as a keyboard, and
 * the game cannot tell the difference. Every AI.decisionFrames frames it:
 *   1. looks at the game as it is right now,
 *   2. works out which actions are legal and allowed by the ground rules,
 *   3. asks its policy, unless the Randomness dial swaps in a random action,
 * then plays the choice out as button presses over the next few frames, `reaction` frames later.
 */
/** An action waiting for its moment. */
interface Queued {
  action: Action;
  /** The tick it takes effect. */
  readyAt: number;
  facing: Facing;
}

const NOTHING: Action = { move: 0, button: 0 };

export class Agent implements InputSource {
  readonly kind = 'ai';
  settings: AgentSettings;
  readonly tracker = new Tracker();
  readonly rails = new Guardrails();
  policy: Policy;
  onDecision: ((r: DecisionRecord) => void) | null = null;
  readonly stats = { decisions: 0, random: 0 };

  private readonly slot: FighterId;
  private readonly getWorld: () => World;
  private readonly rng: Rng;
  private readonly obs = new Float32Array(OBS_DIM);
  /** Frames since the fight began. */
  private tick = 0;
  /** Position inside the current decision window. */
  private k = 0;
  /** Choices made but not yet acted on (reaction time). */
  private pending: Queued[] = [];
  private current: { action: Action; startAt: number; facing: Facing } = { action: NOTHING, startAt: 0, facing: 1 };
  private randomLeft = 0;
  private inFight = false;

  constructor(opts: { slot: FighterId; getWorld: () => World; policy: Policy; settings?: Partial<AgentSettings>; seed?: number }) {
    this.slot = opts.slot;
    this.getWorld = opts.getWorld;
    this.policy = opts.policy;
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    this.rng = createRng(opts.seed ?? Math.floor(Math.random() * 2 ** 32));
  }

  poll(): InputFrame {
    const w = this.getWorld();
    if (w.phase !== 'fight') {
      this.inFight = false;
      this.k = 0;
      return 0;
    }
    const me = w.fighters[this.slot];
    if (!this.inFight) {
      this.inFight = true;
      this.tracker.reset();
      this.rails.reset();
      this.randomLeft = 0;
      this.k = 0;
      this.tick = 0;
      this.pending.length = 0;
      this.current = { action: NOTHING, startAt: 0, facing: me.facing };
    }

    if (this.k === 0) this.decide(w);

    // A choice takes effect `reaction` frames after it was made. The brain always sees the
    // situation as it is NOW; it is the hands that are slow (like a person's), which weakens
    // timing gradually instead of blinding it.
    while (this.pending.length > 0 && this.pending[0].readyAt <= this.tick) {
      const q = this.pending.shift()!;
      this.current = { action: q.action, startAt: q.readyAt, facing: q.facing };
      // "what I did last" is what the hands actually did, so it always agrees with the world the brain sees
      this.tracker.remember(q.action);
    }
    const bits = actionToBits(this.current.action, this.current.facing, this.tick - this.current.startAt);
    this.tick++;
    this.k = (this.k + 1) % AI.decisionFrames;
    return bits;
  }

  private decide(w: World): void {
    const me = w.fighters[this.slot];
    const opp = w.fighters[this.slot === 0 ? 1 : 0];
    this.tracker.observe(opp, me);

    const legal = legalMask(me);
    const mask = this.settings.guardrails ? this.rails.apply(legal) : legal;
    const obs = this.obs;
    encode(me, opp, this.tracker, w.hitstop, obs);

    // the Randomness dial: a random run replaces the brain's choice
    let action: Action;
    let value = 0;
    let random = false;
    const p = this.settings.randomness;
    if (this.randomLeft > 0) {
      this.randomLeft--;
      random = true;
    } else if (p > 0) {
      // start a random run with the chance that makes the long-run share of random decisions equal p
      const L = AI.randomRunLength;
      const start = p >= 1 ? 1 : p / (L - p * (L - 1));
      if (this.rng.chance(start)) {
        this.randomLeft = Math.max(0, Math.round(this.rng.range(1, 2 * L - 1)) - 1);
        random = true;
      }
    }
    if (random) {
      action = sensibleRandom(mask, this.rng);
      this.stats.random++;
    } else {
      const d = this.policy.decide({ world: w, me, opp, obs, mask, rng: this.rng, tracker: this.tracker });
      // a policy is trusted to be good, not to be careful: never play anything the mask forbids
      action = sanitize({ move: d.move, button: d.button }, mask);
      value = d.value;
    }

    const delay = Math.min(AI.reaction.max, Math.max(0, Math.round(this.settings.reaction)));
    this.pending.push({ action, readyAt: this.tick + delay, facing: me.facing });
    this.rails.record(action);
    this.stats.decisions++;
    this.onDecision?.({ obs, mask, action, value, random });
  }
}
