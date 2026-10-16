import { unpackInputs } from '../../ai/replayPack.ts';
import { learn } from '../../ai/personaLearn.ts';
import { brainFromBuffer } from '../../ai/brain.ts';
import type { PersonaStore } from './personas.ts';
import type { LearnRequest, LearnResponse } from './messages.ts';

/** How long a persona may spend thinking after a match. */
export type Effort = 'off' | 'quick' | 'normal' | 'deep';
export const EFFORT_MS: Record<Effort, number> = { off: 0, quick: 8_000, normal: 20_000, deep: 60_000 };
const KEY = 'hollow.effort';

export function savedEffort(): Effort {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'off' || v === 'quick' || v === 'normal' || v === 'deep') return v;
  } catch {
    /* ignore */
  }
  return 'normal';
}
export function saveEffort(e: Effort): void {
  try {
    localStorage.setItem(KEY, e);
  } catch {
    /* ignore */
  }
}

export interface LearnReport {
  personaId: string;
  accepted: boolean;
  studied: number;
  before: number;
  after: number;
  ms: number;
}

/** Fewest of your decisions worth studying: a few seconds of play teaches nothing. */
const MIN_STUDY_FRAMES = 300;

/**
 * Runs one learning job at a time for the saved personas, in a Web Worker, and saves the result.
 * Falls back to running on the main thread (in short bursts of work) if workers are unavailable.
 */
export class Learner {
  private readonly store: PersonaStore;
  private worker: Worker | null = null;
  private busy = false;
  private pending = new Set<string>();
  effort: Effort = savedEffort();
  onProgress: (personaId: string, note: string, fraction: number) => void = () => {};
  onDone: (report: LearnReport) => void = () => {};
  onError: (personaId: string, message: string) => void = () => {};

  constructor(store: PersonaStore) {
    this.store = store;
  }

  get working(): boolean {
    return this.busy;
  }

  /** Ask for a persona to study its recent matches. Safe to call after every round: jobs are merged and run one at a time. */
  request(personaId: string): void {
    if (this.effort === 'off') return;
    this.pending.add(personaId);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    const id = this.pending.values().next().value as string | undefined;
    if (!id) return;
    this.pending.delete(id);
    this.busy = true;
    try {
      await this.run(id);
    } catch (e) {
      this.onError(id, e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
      void this.pump();
    }
  }

  private async run(id: string): Promise<void> {
    const row = await this.store.get(id);
    if (!row) return;
    const matches = await this.store.studyMatches(id);
    if (matches.reduce((n, m) => n + m.frames, 0) < MIN_STUDY_FRAMES) return;
    const [net, base, clone] = await Promise.all([this.store.loadBrain(id), this.store.loadStartBrain(id), this.store.loadClone(id)]);
    const budgetMs = EFFORT_MS[this.effort];
    const seed = (Date.now() & 0x7fffffff) ^ row.stats.generation;

    const done = (r: { net: ArrayBuffer; clone: ArrayBuffer; accepted: boolean; humanSamples: number; before: number; after: number; ms: number }): Promise<void> =>
      this.finish(id, r);

    if (typeof Worker === 'undefined') {
      const r = learn({ net, base, clone, matches: matches.map((m) => ({ inputs: unpackInputs(m.data), slot: m.humanSlot })), style: row.style, budgetMs, seed, onProgress: (n, f) => this.onProgress(id, n, f) });
      return done({ net: r.net.toBuffer(), clone: r.clone.toBuffer(), accepted: r.accepted, humanSamples: r.humanSamples, before: r.before, after: r.after, ms: r.ms });
    }

    const worker = (this.worker ??= new Worker(new URL('./trainer.worker.ts', import.meta.url), { type: 'module' }));
    const req: LearnRequest = {
      type: 'learn',
      personaId: id,
      style: row.style,
      net: net.toBuffer(),
      base: base.toBuffer(),
      clone: clone ? clone.toBuffer() : null,
      matches: matches.map((m) => ({ data: m.data.slice(0), slot: m.humanSlot })),
      budgetMs,
      seed,
    };
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<LearnResponse>) => {
        const m = e.data;
        if (m.type === 'progress') this.onProgress(m.personaId, m.note, m.fraction);
        else if (m.type === 'error') reject(new Error(m.message));
        else void done(m).then(resolve, reject);
      };
      worker.onerror = (e) => reject(new Error(e.message || 'The learning worker crashed.'));
      worker.postMessage(req);
    });
  }

  private async finish(id: string, r: { net: ArrayBuffer; clone: ArrayBuffer; accepted: boolean; humanSamples: number; before: number; after: number; ms: number }): Promise<void> {
    await this.store.saveClone(id, brainFromBuffer(r.clone));
    if (r.accepted) {
      await this.store.saveBrain(id, brainFromBuffer(r.net), `learned from ${r.humanSamples} of your decisions`);
      await this.store.noteLearned(id, r.humanSamples);
    }
    await this.store.cleanup().catch(() => undefined); // keep storage tidy as we go
    this.onDone({ personaId: id, accepted: r.accepted, studied: r.humanSamples, before: r.before, after: r.after, ms: r.ms });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
