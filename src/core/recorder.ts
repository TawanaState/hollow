import { createWorld, step } from './sim.ts';
import type { InputFrame } from './input.ts';
import type { GameEvent, World } from './types.ts';

/** A complete, replayable match: the inputs of every frame. The sim is deterministic. */
export interface Replay {
  version: 1;
  inputs: [InputFrame, InputFrame][];
}

/** Records inputs (and optionally events) as the game runs. */
export class Recorder {
  readonly inputs: [InputFrame, InputFrame][] = [];
  readonly events: GameEvent[] = [];
  /** Keep events too (memory grows with the match). Off by default. */
  keepEvents = false;

  record(inputs: readonly [InputFrame, InputFrame], events: readonly GameEvent[]): void {
    this.inputs.push([inputs[0], inputs[1]]);
    if (this.keepEvents) this.events.push(...events);
  }

  clear(): void {
    this.inputs.length = 0;
    this.events.length = 0;
  }

  toReplay(): Replay {
    return { version: 1, inputs: this.inputs.map(([a, b]) => [a, b]) };
  }
}

/** Re-run a replay from scratch. Returns the final world and every event, in order. */
export function runReplay(replay: Replay, until = replay.inputs.length): { world: World; events: GameEvent[] } {
  const world = createWorld();
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.min(until, replay.inputs.length); i++) events.push(...step(world, replay.inputs[i]));
  return { world, events };
}
