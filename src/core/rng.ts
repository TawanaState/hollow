/**
 * Small seeded random number generator (mulberry32).
 *
 * The SIMULATION never uses randomness (that is what keeps it deterministic, replayable and
 * identical on server and client). This is for everything around it: cosmetic variation
 * (hand habits, effect jitter), bots and AI, tests. Same seed = same sequence.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** A random element. */
  pick<T>(items: readonly T[]): T;
  /** An element chosen by weight. */
  weighted<T>(items: readonly { item: T; weight: number }[]): T;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (items) => {
      let total = 0;
      for (const i of items) total += i.weight;
      let r = next() * total;
      for (const i of items) {
        r -= i.weight;
        if (r <= 0) return i.item;
      }
      return items[items.length - 1].item;
    },
  };
}
