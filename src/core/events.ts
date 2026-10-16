import type { EventOf, GameEvent, GameEventType } from './types.ts';

export type Unsubscribe = () => void;
export type Handler<E> = (event: E) => void;

export interface ListenOptions {
  /** Higher runs first. Default 0. */
  order?: number;
}

interface Entry {
  fn: Handler<GameEvent>;
  order: number;
}

/**
 * Typed event bus. The sim returns events; the host publishes them here and every
 * system (VFX, audio, HUD, logger, recorder, network, AI observer) subscribes.
 *
 *   const off = bus.on('HIT', (e) => ...e.damage...);   // e is narrowed to the HIT event
 *   bus.onAny((e) => log(e));
 *   bus.once('KO', ...);
 *   off();                                              // unsubscribe
 *
 * A listener that throws is reported to `onError` and never breaks the others
 * or the game loop.
 */
export class EventBus {
  private byType = new Map<GameEventType, Entry[]>();
  private any: Entry[] = [];
  /**
   * Called when a listener throws. The default surfaces it as an unhandled rejection
   * (visible in the browser console / Node) without interrupting the game.
   */
  onError: (error: unknown, event: GameEvent) => void = (error) => {
    void Promise.reject(error);
  };

  on<T extends GameEventType>(type: T, fn: Handler<EventOf<T>>, opts: ListenOptions = {}): Unsubscribe {
    const list = this.byType.get(type) ?? [];
    this.byType.set(type, list);
    return this.add(list, fn as Handler<GameEvent>, opts);
  }

  onAny(fn: Handler<GameEvent>, opts: ListenOptions = {}): Unsubscribe {
    return this.add(this.any, fn, opts);
  }

  once<T extends GameEventType>(type: T, fn: Handler<EventOf<T>>, opts: ListenOptions = {}): Unsubscribe {
    const off = this.on(
      type,
      (e) => {
        off();
        fn(e);
      },
      opts,
    );
    return off;
  }

  emit(event: GameEvent): void {
    const typed = this.byType.get(event.t);
    const merged = typed ? (this.any.length ? [...typed, ...this.any] : [...typed]) : [...this.any];
    if (typed && this.any.length) merged.sort((a, b) => b.order - a.order);
    for (const entry of merged) {
      try {
        entry.fn(event);
      } catch (error) {
        this.onError(error, event);
      }
    }
  }

  emitAll(events: readonly GameEvent[]): void {
    for (const e of events) this.emit(e);
  }

  /** Remove every listener. */
  clear(): void {
    this.byType.clear();
    this.any = [];
  }

  private add(list: Entry[], fn: Handler<GameEvent>, opts: ListenOptions): Unsubscribe {
    const entry: Entry = { fn, order: opts.order ?? 0 };
    list.push(entry);
    list.sort((a, b) => b.order - a.order);
    return () => {
      const i = list.indexOf(entry);
      if (i >= 0) list.splice(i, 1);
    };
  }
}
