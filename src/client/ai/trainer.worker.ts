import { brainFromBuffer } from '../../ai/brain.ts';
import { learn } from '../../ai/personaLearn.ts';
import { unpackInputs } from '../../ai/replayPack.ts';
import type { LearnRequest, LearnResponse } from './messages.ts';

/**
 * Runs the learning off the main thread, so the game stays smooth while a persona studies and
 * practises. No DOM here; the same code runs in Node (see scripts/ and the tests).
 */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<LearnRequest>) => void) | null;
  postMessage(message: LearnResponse, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const req = e.data;
  if (req.type !== 'learn') return;
  try {
    const result = learn({
      net: brainFromBuffer(req.net),
      base: brainFromBuffer(req.base),
      clone: req.clone ? brainFromBuffer(req.clone) : null,
      matches: req.matches.map((m) => ({ inputs: unpackInputs(m.data), slot: m.slot })),
      style: req.style,
      budgetMs: req.budgetMs,
      seed: req.seed,
      onProgress: (note, fraction) => ctx.postMessage({ type: 'progress', personaId: req.personaId, note, fraction }),
    });
    const net = result.net.toBuffer();
    const clone = result.clone.toBuffer();
    ctx.postMessage(
      {
        type: 'done',
        personaId: req.personaId,
        net,
        clone,
        accepted: result.accepted,
        humanSamples: result.humanSamples,
        before: result.before,
        after: result.after,
        practiceSamples: result.practiceSamples,
        ms: result.ms,
      },
      [net, clone],
    );
  } catch (err) {
    ctx.postMessage({ type: 'error', personaId: req.personaId, message: err instanceof Error ? err.message : String(err) });
  }
};
