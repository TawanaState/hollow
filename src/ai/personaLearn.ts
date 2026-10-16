import { STYLES } from '../content/ai.ts';
import type { StyleId } from '../content/ai.ts';
import { createRng } from '../core/rng.ts';
import { Dataset } from './dataset.ts';
import { balanceWeights, evaluate, extractHumanSamples, practice, train } from './learn.ts';
import type { HumanMatch, Opponent, PracticeResult } from './learn.ts';
import { now } from './clock.ts';
import type { Mlp } from './nn.ts';
import { NetPolicy, RandomPolicy } from './policy.ts';
import { TEACHERS, TEACHER_FOR, TeacherPolicy } from './teachers.ts';

/**
 * WHAT HAPPENS AFTER YOU PLAY A PERSONA. Everything here is time-boxed so it fits the
 * "Learning effort" setting and never freezes a phone (it also runs in a Web Worker).
 *
 *   1. STUDY YOU       replay your recent matches and turn what you did into examples
 *   2. MODEL YOU       update a "clone": a network that plays the way you do
 *   3. PRACTISE        the persona plays many fast matches against your clone, learns from the
 *                      decisions that worked, and is kept only if it did not get worse
 */
export interface LearnJob {
  /** The persona's current brain. */
  net: Mlp;
  /** Its starting brain: updates are pulled gently back toward it so its personality survives. */
  base: Mlp;
  /** The saved model of the human, if there is one. */
  clone: Mlp | null;
  /** Recent matches, with a few older ones mixed in. */
  matches: HumanMatch[];
  style: StyleId;
  budgetMs: number;
  seed: number;
  onProgress?: (note: string, fraction: number) => void;
}

export interface LearnResult {
  net: Mlp;
  clone: Mlp;
  accepted: boolean;
  humanSamples: number;
  /** Score against the human clone before and after (0..1). */
  before: number;
  after: number;
  practiceSamples: number;
  ms: number;
}

export function learn(job: LearnJob): LearnResult {
  const t0 = now();
  const rng = createRng(job.seed);
  const progress = (note: string, f: number): void => job.onProgress?.(note, f);
  const deadline = t0 + job.budgetMs;

  // 1. study the human's matches
  progress('studying your matches', 0.02);
  const humanDs = new Dataset(40_000);
  for (const m of job.matches) extractHumanSamples(m, humanDs);
  balanceWeights(humanDs);

  // 2. keep a model of how the human plays
  progress('learning how you play', 0.15);
  const clone = (job.clone ?? job.base).clone();
  if (humanDs.size >= 64) {
    train(clone, humanDs, {
      steps: job.clone ? 160 : 320,
      batch: 64,
      lr: job.clone ? 6e-4 : 1.2e-3,
      labelSmoothing: 0.05,
      rng,
      deadline: t0 + job.budgetMs * 0.3,
    });
  }

  // 3. practise against that model
  const cloneOpp: Opponent = { name: 'you', seat: () => ({ policy: new NetPolicy(clone) }) };
  const sparring: Opponent = { name: 'previous', seat: () => ({ policy: new NetPolicy(job.net.clone()) }) };
  const teacherId = TEACHER_FOR[job.style];
  const teacher: Opponent = { name: 'teacher', seat: () => ({ policy: new TeacherPolicy(TEACHERS[teacherId]) }) };
  const random: Opponent = { name: 'random', seat: () => ({ policy: new RandomPolicy() }) };
  const net = job.net.clone();
  const res: PracticeResult = practice({
    net,
    style: STYLES[job.style],
    opponents: [cloneOpp, cloneOpp, teacher, cloneOpp, sparring, random],
    gateOpponents: [cloneOpp, teacher],
    anchorData: humanDs.size >= 64 ? humanDs : undefined,
    anchorFraction: 0.2,
    anchor: { weights: job.base.snapshot(), lambda: 0.01 },
    seed: job.seed,
    matches: 40,
    trainSteps: 160,
    gateMatches: 4,
    deadline,
    onProgress: (note, done, total) => progress(note, 0.3 + 0.6 * (done / Math.max(1, total))),
  });
  progress('done', 1);
  return {
    net: res.accepted ? net : job.net,
    clone,
    accepted: res.accepted,
    humanSamples: humanDs.size,
    before: res.before,
    after: res.after,
    practiceSamples: res.samples,
    ms: now() - t0,
  };
}

/** A quick strength check against the teacher bots, for showing how a persona is doing. */
export function strengthCheck(net: Mlp, style: StyleId, matches = 6, seed = 5): number {
  const teacher: Opponent = { name: 't', seat: () => ({ policy: new TeacherPolicy(TEACHERS[TEACHER_FOR[style]]) }) };
  return evaluate(new NetPolicy(net), [teacher], matches, seed).rate;
}
