import { EventBus } from './events.ts';
import { InputRouter } from './control.ts';
import { Recorder } from './recorder.ts';
import { createWorld, resetRound, step } from './sim.ts';
import type { GameEvent, World } from './types.ts';

/**
 * The host that wires the pure sim to the outside world. The browser (local play)
 * and the Node server (online play) both run exactly this.
 *
 *   game.router.attach(0, keyboard)      who controls slot 0
 *   game.bus.on('HIT', fn)               who listens
 *   game.tick()                          advance 1 F: poll inputs, step, publish events
 */
export class Game {
  world: World = createWorld();
  readonly bus: EventBus;
  readonly router = new InputRouter();
  readonly recorder = new Recorder();
  /** Record every match into `recorder`. */
  recording = true;

  /** Pass a shared bus to publish into (so systems subscribe once, whatever the session). */
  constructor(bus: EventBus = new EventBus()) {
    this.bus = bus;
  }

  /** Advance exactly one frame. Returns the events (already published on the bus). */
  tick(): GameEvent[] {
    const inputs = this.router.poll(this.world.frame);
    const events = step(this.world, inputs);
    if (this.recording) this.recorder.record(inputs, events);
    this.bus.emitAll(events);
    return events;
  }

  /** Start over: new world, new recording. Listeners and input sources stay attached. */
  restart(): void {
    this.world = createWorld();
    this.recorder.clear();
  }

  /** Start the next round, keeping the score. */
  nextRound(): void {
    resetRound(this.world);
  }
}
