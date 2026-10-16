/** Small remembered preferences (kept in localStorage; every read/write is safe if storage is blocked). */
const read = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: just do not remember */
  }
};

/** Health multiplier for matches on this device: 1 = normal, 2 = long (default), 3 = epic, 5 = marathon. */
export const HP_SCALES = [1, 2, 3, 5] as const;

export function savedHpScale(): number {
  const v = Number(read('hollow.hpScale', '2'));
  return (HP_SCALES as readonly number[]).includes(v) ? v : 2;
}
export function saveHpScale(v: number): void {
  write('hollow.hpScale', String(v));
}
