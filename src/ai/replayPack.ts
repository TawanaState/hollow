import type { InputFrame } from '../core/input.ts';

/**
 * Compact storage for recorded matches. A replay is two input bitmasks per frame, but they
 * change rarely, so run-length coding shrinks a 3 minute match from ~43 KB to a few KB.
 * Each 32-bit word is: player 1 input (9 bits) | player 2 input (9 bits) | run length (14 bits).
 */
export function packInputs(inputs: readonly (readonly [InputFrame, InputFrame])[]): ArrayBuffer {
  const words: number[] = [];
  let i = 0;
  while (i < inputs.length) {
    const [a, b] = inputs[i];
    let run = 1;
    while (i + run < inputs.length && run < 16383 && inputs[i + run][0] === a && inputs[i + run][1] === b) run++;
    words.push(((a & 0x1ff) | ((b & 0x1ff) << 9) | (run << 18)) >>> 0);
    i += run;
  }
  return Uint32Array.from(words).buffer as ArrayBuffer;
}

export function unpackInputs(buf: ArrayBuffer): [InputFrame, InputFrame][] {
  const words = new Uint32Array(buf);
  const out: [InputFrame, InputFrame][] = [];
  for (const w of words) {
    const a = w & 0x1ff;
    const b = (w >>> 9) & 0x1ff;
    const run = w >>> 18;
    for (let r = 0; r < run; r++) out.push([a, b]);
  }
  return out;
}
