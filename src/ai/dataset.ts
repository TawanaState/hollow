import type { Rng } from '../core/rng.ts';
import { OBS_DIM } from './features.ts';

/**
 * A ring buffer of training examples (struct-of-arrays, so batches are cheap to build). When it
 * is full the oldest examples are overwritten: that is how "only learn from recent data" works.
 */
export class Dataset {
  readonly capacity: number;
  readonly obs: Float32Array;
  readonly move: Uint8Array;
  readonly button: Uint8Array;
  readonly mask: Uint16Array;
  /** How much this example matters (class balancing, advantage weighting). */
  readonly weight: Float32Array;
  /** Discounted return from this decision onward (reinforcement learning only). */
  readonly ret: Float32Array;
  size = 0;
  private head = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.obs = new Float32Array(capacity * OBS_DIM);
    this.move = new Uint8Array(capacity);
    this.button = new Uint8Array(capacity);
    this.mask = new Uint16Array(capacity);
    this.weight = new Float32Array(capacity).fill(1);
    this.ret = new Float32Array(capacity);
  }

  add(obs: Float32Array, move: number, button: number, mask: number, weight = 1, ret = 0): void {
    const i = this.head;
    this.obs.set(obs.subarray(0, OBS_DIM), i * OBS_DIM);
    this.move[i] = move;
    this.button[i] = button;
    this.mask[i] = mask;
    this.weight[i] = weight;
    this.ret[i] = ret;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  clear(): void {
    this.size = 0;
    this.head = 0;
  }

  /** Pick `n` random examples (with replacement). */
  sample(rng: Rng, n: number, out: Int32Array): void {
    for (let i = 0; i < n; i++) out[i] = rng.int(this.size);
  }
}
