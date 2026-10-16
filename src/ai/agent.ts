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
  /** F between something happening on screen and the AI seeing it. */
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
 *   1. looks at the game (a little late, by the reaction setting),
 *   2. works out which actions are legal and allowed by the ground rules,
 *   3. asks its policy, unless the Randomness dial swaps in a random action,
 * then plays the choice out as button presses over the next few frames.
 */
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
  private readonly ring: Float32Array[] = [];
  private ringHead = 0;
  private k = 0;
  private action: Action = { move: 0, button: 0 };
  private facing: Facing = 1;
  private randomLeft = 0;
  private inFight = false;

  constructor(opts: { slot: FighterId; getWorld: () => World; policy: Policy; settings?: Partial<AgentSettings>; seed?: number }) {
    this.slot = opts.slot;
    this.getWorld = opts.getWorld;
    this.policy = opts.policy;
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    this.rng = createRng(opts.seed ?? Math.floor(Math.random() * 2 ** 32));
    for (let i = 0; i <= AI.reaction.max; i++) this.ring.push(new Float32Array(OBS_DIM));
  }

  poll(): InputFrame {
    const w = this.getWorld();
    if (w.phase !== 'fight') {
      this.inFight = false;
      this.k = 0;
      return 0;
    }
    const me = w.fighters[this.slot];
    const opp = w.fighters[this.slot === 0 ? 1 : 0];
    if (!this.inFight) {
      this.inFight = true;
      this.tracker.reset();
      this.rails.reset();
      this.randomLeft = 0;
      this.k = 0;
      for (const r of this.ring) encode(me, opp, this.tracker, w.hitstop, r);
    }

    const delay = Math.min(AI.reaction.max, Math.max(0, Math.round(this.settings.reaction)));
    if (delay > 0) {
      encode(me, opp, this.tracker, w.hitstop, this.ring[this.ringHead]);
      this.ringHead = (this.ringHead + 1) % this.ring.length;
    }

    if (this.k === 0) this.decide(w, delay);
    const bits = actionToBits(this.action, this.facing, this.k);
    this.k = (this.k + 1) % AI.decisionFrames;
    return bits;
  }

  private decide(w: World, delay: number): void {
    const me = w.fighters[this.slot];
    const opp = w.fighters[this.slot === 0 ? 1 : 0];
    this.facing = me.facing;
    this.tracker.observe(opp, me);

    const legal = legalMask(me);
    const mask = this.settings.guardrails ? this.rails.apply(legal) : legal;

    // what it sees: the world as it was `delay` frames ago
    let obs: Float32Array = this.obs;
    if (delay > 0) {
      const idx = (this.ringHead - 1 - delay + this.ring.length * 2) % this.ring.length;
      obs = this.ring[idx];
    } else {
      encode(me, opp, this.tracker, w.hitstop, this.obs);
    }

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

    this.action = action;
    this.rails.record(action);
    this.tracker.remember(action);
    this.stats.decisions++;
    this.onDecision?.({ obs, mask, action, value, random });
  }
}
