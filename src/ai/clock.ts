/** Milliseconds from a monotonic clock, in any environment (browser, worker, Node). */
export const now = (): number => {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
};
