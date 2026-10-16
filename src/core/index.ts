/**
 * Public API of the game core. Import from here (or from the individual files).
 *
 *   Sim            createWorld, step, resetRound, queries (hurtRect, sideOf, relativeDir...)
 *   Events         GameEvent (types.ts), EventBus (events.ts), describeEvent (log.ts)
 *   Input          Btn, InputFrame, InputSource, InputRouter, QueueSource, ScriptedSource
 *   Host           Game: world + bus + router + recorder, tick() to advance 1 F
 *   Replay         Recorder, runReplay
 *   Time           FRAME_MS, fToMs, msToF
 *   Random         createRng (seeded; for cosmetics, bots, tests. The sim itself uses none)
 */
export * from './types.ts';
export * from './input.ts';
export * from './events.ts';
export * from './control.ts';
export * from './sim.ts';
export * from './game.ts';
export * from './recorder.ts';
export * from './time.ts';
export * from './log.ts';
export * from './rng.ts';
