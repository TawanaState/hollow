import { createRng } from '../core/rng.ts';
import type { Rng } from '../core/rng.ts';

/**
 * A small multi-layer perceptron with its own backprop and AdamW. About 300 lines, no
 * dependencies, no GPU: for a network this size (tens of thousands of weights, one decision
 * every 4 frames) plain typed-array loops beat any library's startup and dispatch overhead,
 * and the same code runs in a phone's browser, a Web Worker, Node and the tests.
 *
 * Layout: weights are row-major per output neuron, `W[l][o * nIn + i]`. Hidden layers use ReLU,
 * the last layer is linear. Batches are stored sample-major.
 */
export interface StepOptions {
  lr: number;
  weightDecay?: number;
  /** Clip the gradient's global L2 norm to this. */
  clip?: number;
  /** Pull the weights toward these (same layout as `Mlp.snapshot()`), with this strength. */
  anchor?: { weights: Float32Array[]; lambda: number };
}

const MAGIC = 0x484e4e31; // 'HNN1'

export class Mlp {
  readonly sizes: readonly number[];
  readonly W: Float32Array[] = [];
  readonly b: Float32Array[] = [];
  private readonly gW: Float32Array[] = [];
  private readonly gb: Float32Array[] = [];
  private readonly mW: Float32Array[] = [];
  private readonly vW: Float32Array[] = [];
  private readonly mb: Float32Array[] = [];
  private readonly vb: Float32Array[] = [];
  private acts: Float32Array[] = [];
  private scratch: Float32Array[] = [];
  private x0: Float32Array = new Float32Array(0);
  private cap = 0;
  private t = 0;

  constructor(sizes: readonly number[], rng: Rng = createRng(1), init: 'he' | 'zero' = 'he') {
    this.sizes = sizes;
    for (let l = 0; l < sizes.length - 1; l++) {
      const nIn = sizes[l];
      const nOut = sizes[l + 1];
      const w = new Float32Array(nIn * nOut);
      if (init === 'he') {
        const std = Math.sqrt(2 / nIn);
        for (let i = 0; i < w.length; i++) w[i] = gaussian(rng) * std;
      }
      this.W.push(w);
      this.b.push(new Float32Array(nOut));
      this.gW.push(new Float32Array(w.length));
      this.gb.push(new Float32Array(nOut));
      this.mW.push(new Float32Array(w.length));
      this.vW.push(new Float32Array(w.length));
      this.mb.push(new Float32Array(nOut));
      this.vb.push(new Float32Array(nOut));
    }
    // the last layer starts small so early decisions are near-uniform, not wild
    const last = this.W[this.W.length - 1];
    for (let i = 0; i < last.length; i++) last[i] *= 0.1;
    this.reserve(1);
  }

  get inputSize(): number {
    return this.sizes[0];
  }
  get outputSize(): number {
    return this.sizes[this.sizes.length - 1];
  }
  get paramCount(): number {
    return this.W.reduce((s, w) => s + w.length, 0) + this.b.reduce((s, b) => s + b.length, 0);
  }

  private reserve(batch: number): void {
    if (batch <= this.cap) return;
    this.cap = batch;
    this.acts = this.sizes.map((n) => new Float32Array(n * batch));
    this.scratch = this.sizes.map((n) => new Float32Array(n * batch));
  }

  /** Run `batch` samples (x is batch * inputSize). Returns batch * outputSize logits. Keeps activations for backward(). */
  forward(x: Float32Array, batch = 1): Float32Array {
    this.reserve(batch);
    this.x0 = x;
    const L = this.W.length;
    for (let l = 0; l < L; l++) {
      const nIn = this.sizes[l];
      const nOut = this.sizes[l + 1];
      const inp = l === 0 ? x : this.acts[l];
      const out = this.acts[l + 1];
      const w = this.W[l];
      const bias = this.b[l];
      const relu = l < L - 1;
      for (let n = 0; n < batch; n++) {
        const io = n * nIn;
        const oo = n * nOut;
        for (let o = 0; o < nOut; o++) {
          let s = bias[o];
          const wo = o * nIn;
          for (let i = 0; i < nIn; i++) s += w[wo + i] * inp[io + i];
          out[oo + o] = relu && s < 0 ? 0 : s;
        }
      }
    }
    return this.acts[L];
  }

  /** Back-propagate d(loss)/d(output) (batch * outputSize) from the last forward(). Accumulates gradients. */
  backward(dOut: Float32Array, batch = 1): void {
    const L = this.W.length;
    let d = dOut;
    for (let l = L - 1; l >= 0; l--) {
      const nIn = this.sizes[l];
      const nOut = this.sizes[l + 1];
      const inp = l === 0 ? this.x0 : this.acts[l];
      const w = this.W[l];
      const gw = this.gW[l];
      const gb = this.gb[l];
      const dIn = l > 0 ? this.scratch[l] : null;
      if (dIn) dIn.fill(0, 0, batch * nIn);
      for (let n = 0; n < batch; n++) {
        const io = n * nIn;
        const oo = n * nOut;
        for (let o = 0; o < nOut; o++) {
          const g = d[oo + o];
          if (g === 0) continue;
          gb[o] += g;
          const wo = o * nIn;
          for (let i = 0; i < nIn; i++) gw[wo + i] += g * inp[io + i];
          if (dIn) for (let i = 0; i < nIn; i++) dIn[io + i] += w[wo + i] * g;
        }
      }
      if (dIn) {
        const a = this.acts[l];
        for (let j = 0; j < batch * nIn; j++) if (a[j] <= 0) dIn[j] = 0;
        d = dIn;
      }
    }
  }

  zeroGrad(): void {
    for (const g of this.gW) g.fill(0);
    for (const g of this.gb) g.fill(0);
  }

  /** One AdamW update from the accumulated gradients, then clears them. */
  step(o: StepOptions): void {
    this.t++;
    const b1 = 0.9;
    const b2 = 0.999;
    const eps = 1e-8;
    const wd = o.weightDecay ?? 0;
    let scale = 1;
    if (o.clip) {
      let sq = 0;
      for (const g of this.gW) for (let i = 0; i < g.length; i++) sq += g[i] * g[i];
      for (const g of this.gb) for (let i = 0; i < g.length; i++) sq += g[i] * g[i];
      const norm = Math.sqrt(sq);
      if (norm > o.clip) scale = o.clip / (norm + 1e-12);
    }
    const c1 = 1 - Math.pow(b1, this.t);
    const c2 = 1 - Math.pow(b2, this.t);
    const apply = (p: Float32Array, g: Float32Array, m: Float32Array, v: Float32Array, anchor: Float32Array | undefined, decay: number): void => {
      for (let i = 0; i < p.length; i++) {
        let gi = g[i] * scale;
        if (anchor) gi += o.anchor!.lambda * (p[i] - anchor[i]);
        m[i] = b1 * m[i] + (1 - b1) * gi;
        v[i] = b2 * v[i] + (1 - b2) * gi * gi;
        p[i] -= o.lr * ((m[i] / c1) / (Math.sqrt(v[i] / c2) + eps) + decay * p[i]);
      }
    };
    const nW = this.W.length;
    for (let l = 0; l < nW; l++) {
      apply(this.W[l], this.gW[l], this.mW[l], this.vW[l], o.anchor?.weights[l], wd);
      apply(this.b[l], this.gb[l], this.mb[l], this.vb[l], o.anchor?.weights[nW + l], 0);
    }
    this.zeroGrad();
  }

  /** A copy of all parameters (weights then biases), for anchoring or comparing. */
  snapshot(): Float32Array[] {
    return [...this.W.map((w) => w.slice()), ...this.b.map((b) => b.slice())];
  }

  clone(): Mlp {
    const m = new Mlp(this.sizes, createRng(1), 'zero');
    m.copyFrom(this);
    return m;
  }

  copyFrom(other: Mlp): void {
    for (let l = 0; l < this.W.length; l++) {
      this.W[l].set(other.W[l]);
      this.b[l].set(other.b[l]);
    }
  }

  /** Mix another network into this one: this = (1 - t) * this + t * other. */
  lerpToward(other: Mlp, t: number): void {
    for (let l = 0; l < this.W.length; l++) {
      for (let i = 0; i < this.W[l].length; i++) this.W[l][i] += (other.W[l][i] - this.W[l][i]) * t;
      for (let i = 0; i < this.b[l].length; i++) this.b[l][i] += (other.b[l][i] - this.b[l][i]) * t;
    }
  }

  // ── saving ──

  /** Compact binary form (header + float32 weights). This is what is stored on the device. */
  toBuffer(): ArrayBuffer {
    const header = 2 + this.sizes.length;
    const total = header * 4 + this.paramCount * 4;
    const buf = new ArrayBuffer(total);
    const u32 = new Uint32Array(buf, 0, header);
    u32[0] = MAGIC;
    u32[1] = this.sizes.length;
    this.sizes.forEach((s, i) => (u32[2 + i] = s));
    const f32 = new Float32Array(buf, header * 4);
    let at = 0;
    for (let l = 0; l < this.W.length; l++) {
      f32.set(this.W[l], at);
      at += this.W[l].length;
      f32.set(this.b[l], at);
      at += this.b[l].length;
    }
    return buf;
  }

  static fromBuffer(buf: ArrayBuffer): Mlp {
    const head = new Uint32Array(buf, 0, 2);
    if (head[0] !== MAGIC) throw new Error('Not a hollow network file');
    const n = head[1];
    const sizes = Array.from(new Uint32Array(buf, 8, n));
    const m = new Mlp(sizes, createRng(1), 'zero');
    const f32 = new Float32Array(buf, (2 + n) * 4);
    let at = 0;
    for (let l = 0; l < m.W.length; l++) {
      m.W[l].set(f32.subarray(at, at + m.W[l].length));
      at += m.W[l].length;
      m.b[l].set(f32.subarray(at, at + m.b[l].length));
      at += m.b[l].length;
    }
    return m;
  }
}

/** Standard normal from two uniforms (Box-Muller). */
function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}
