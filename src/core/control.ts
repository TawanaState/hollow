import { Btn } from './input.ts';
import type { InputFrame } from './input.ts';
import type { FighterId } from './types.ts';
import type { Unsubscribe } from './events.ts';

/**
 * INPUT API. Anything that can drive a fighter is an InputSource: a keyboard,
 * touch controls, a network player, a bot, a replay. The sim never knows which.
 *
 * poll() is called exactly once per sim frame and returns what is HELD that frame.
 */
export interface InputSource {
  /** Free-form label for debugging ('keyboard', 'remote:ab12', 'bot'...). */
  readonly kind: string;
  poll(frame: number): InputFrame;
  /** Called when the source is detached. Optional cleanup. */
  dispose?(): void;
}

/** Always neutral. Training dummy, or an empty seat. */
export class NullSource implements InputSource {
  readonly kind = 'null';
  poll(): InputFrame {
    return 0;
  }
}

/** Plays back a fixed list of frames (or a function). Used by tests and replays. */
export class ScriptedSource implements InputSource {
  readonly kind = 'scripted';
  private readonly script: InputFrame[] | ((frame: number) => InputFrame);
  constructor(script: InputFrame[] | ((frame: number) => InputFrame)) {
    this.script = script;
  }
  poll(frame: number): InputFrame {
    return typeof this.script === 'function' ? this.script(frame) : (this.script[frame] ?? 0);
  }
}

/**
 * A source fed from outside, one InputFrame per sim frame (network clients, bots that
 * think asynchronously). Frames are queued so a tap shorter than a frame is never lost.
 */
export class QueueSource implements InputSource {
  readonly kind: string;
  private queue: InputFrame[] = [];
  private last: InputFrame = 0;
  private readonly maxDepth: number;

  constructor(kind = 'queue', maxDepth = 4) {
    this.kind = kind;
    this.maxDepth = maxDepth;
  }

  push(frame: InputFrame): void {
    this.queue.push(frame);
    // Over-full means we are behind. Skip ahead but keep every button that was pressed
    // inside the skipped frames, so fast taps still register.
    while (this.queue.length > this.maxDepth) {
      const dropped = this.queue.shift()!;
      this.queue[0] |= dropped & ~(Btn.LEFT | Btn.RIGHT | Btn.DOWN); // keep buttons (and jump), not held directions
    }
  }

  poll(): InputFrame {
    if (this.queue.length) this.last = this.queue.shift()!;
    return this.last;
  }

  get depth(): number {
    return this.queue.length;
  }
}

/** Maps player slots to sources. Sources can be swapped at any time, even mid-fight. */
export class InputRouter {
  private sources: [InputSource, InputSource] = [new NullSource(), new NullSource()];
  private listeners: ((slot: FighterId, source: InputSource) => void)[] = [];

  /** Attach a source to a slot (replacing the previous one). Returns a detach function. */
  attach(slot: FighterId, source: InputSource): Unsubscribe {
    this.sources[slot].dispose?.();
    this.sources[slot] = source;
    for (const fn of this.listeners) fn(slot, source);
    return () => {
      if (this.sources[slot] === source) this.attach(slot, new NullSource());
    };
  }

  sourceOf(slot: FighterId): InputSource {
    return this.sources[slot];
  }

  /** Notified whenever a slot's source changes. */
  onAttach(fn: (slot: FighterId, source: InputSource) => void): Unsubscribe {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  poll(frame: number): [InputFrame, InputFrame] {
    return [this.sources[0].poll(frame), this.sources[1].poll(frame)];
  }
}
