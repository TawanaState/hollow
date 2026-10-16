import { Btn } from '../core/input.ts';
import type { InputFrame } from '../core/input.ts';

/**
 * A scripted fight for screenshots, docs and smoke tests (open the game with ?demo).
 * Frame numbers are world frames; the intro lasts 80F.
 *   P1 walks in, lands jab-cross-spin kick, throws a heavy into P2's guard, then dashes.
 */
export function demoInputs(frame: number): [InputFrame, InputFrame] {
  let p1 = 0;
  let p2 = 0;
  const f = frame - 80;
  if (f > 0 && f < 66) p1 |= Btn.RIGHT;
  const tap = (at: number, btn: number): void => {
    if (f >= at && f < at + 2) p1 |= btn;
  };
  tap(70, Btn.LIGHT);
  tap(78, Btn.LIGHT);
  tap(90, Btn.LIGHT);
  tap(150, Btn.HEAVY);
  if (f >= 150 && f < 190) p2 |= Btn.GUARD;
  tap(250, Btn.DASH);
  return [p1, p2];
}
