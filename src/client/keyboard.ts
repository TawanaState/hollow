import { Btn } from '../core/input.ts';
import type { InputFrame, InputSource } from '../core/index.ts';

/** KeyboardEvent.code -> button. */
type KeyMap = Record<string, number>;

export const P1_KEYS: KeyMap = {
  KeyA: Btn.LEFT, KeyD: Btn.RIGHT, KeyW: Btn.UP, KeyS: Btn.DOWN,
  KeyJ: Btn.LIGHT, KeyK: Btn.HEAVY, KeyL: Btn.SKILL, KeyU: Btn.GUARD, KeyI: Btn.DASH,
};

export const P2_KEYS: KeyMap = {
  ArrowLeft: Btn.LEFT, ArrowRight: Btn.RIGHT, ArrowUp: Btn.UP, ArrowDown: Btn.DOWN,
  Comma: Btn.LIGHT, Period: Btn.HEAVY, Slash: Btn.SKILL, Semicolon: Btn.GUARD, Quote: Btn.DASH,
  Numpad1: Btn.LIGHT, Numpad2: Btn.HEAVY, Numpad3: Btn.SKILL, Numpad0: Btn.GUARD, NumpadDecimal: Btn.DASH,
};

/** Reads held keys. Several of these can share one `Keyboard` listener. */
export class Keyboard {
  private readonly held = new Set<string>();
  private readonly onDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.held.add(e.code);
    if (this.isGameKey(e.code)) e.preventDefault();
  };
  private readonly onUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };
  private readonly onBlur = (): void => this.held.clear();
  private readonly gameKeys = new Set([...Object.keys(P1_KEYS), ...Object.keys(P2_KEYS)]);

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  private isGameKey(code: string): boolean {
    return this.gameKeys.has(code);
  }

  /** An InputSource reading the given key map(s). */
  source(...maps: KeyMap[]): InputSource {
    return {
      kind: 'keyboard',
      poll: (): InputFrame => {
        let bits = 0;
        for (const map of maps) for (const [code, bit] of Object.entries(map)) if (this.held.has(code)) bits |= bit;
        return bits;
      },
    };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
