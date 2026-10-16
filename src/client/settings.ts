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

/** Sound on this device: 'full', 'quiet' (no announcer) or 'off'. */
export type SoundMode = 'full' | 'quiet' | 'off';

export function savedSoundMode(): SoundMode {
  const v = read('hollow.sound', 'full');
  return v === 'quiet' || v === 'off' ? v : 'full';
}
export function saveSoundMode(v: SoundMode): void {
  write('hollow.sound', v);
}

export function savedVolume(): number {
  const v = Number(read('hollow.volume', '85'));
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 85;
}
export function saveVolume(v: number): void {
  write('hollow.volume', String(Math.round(v)));
}

/** The student last viewed on the Students screen. */
export function savedStudent(): string {
  return read('hollow.student', '');
}
export function saveStudent(id: string): void {
  write('hollow.student', id);
}
