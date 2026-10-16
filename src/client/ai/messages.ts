import type { StyleId } from '../../content/ai.ts';

/** Messages between the game and the learning worker. Everything is plain data or ArrayBuffers. */
export interface LearnRequest {
  type: 'learn';
  personaId: string;
  style: StyleId;
  /** Current brain, starting brain, and the saved model of the human (null the first time). */
  net: ArrayBuffer;
  base: ArrayBuffer;
  clone: ArrayBuffer | null;
  /** Recorded matches, run-length packed. */
  matches: { data: ArrayBuffer; slot: 0 | 1 }[];
  budgetMs: number;
  seed: number;
}

export type LearnResponse =
  | { type: 'progress'; personaId: string; note: string; fraction: number }
  | {
      type: 'done';
      personaId: string;
      net: ArrayBuffer;
      clone: ArrayBuffer;
      accepted: boolean;
      humanSamples: number;
      before: number;
      after: number;
      practiceSamples: number;
      ms: number;
    }
  | { type: 'error'; personaId: string; message: string };
