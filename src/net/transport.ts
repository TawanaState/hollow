import type { Unsubscribe } from '../core/events.ts';

/**
 * TRANSPORT API. A typed, message-level pipe. The game talks to this, never to a
 * WebSocket directly, so the wire can change (WebSocket now, WebRTC later) without
 * touching the game.
 *
 *   Out = messages this end sends, In = messages this end receives.
 */
export interface Transport<Out, In> {
  readonly isOpen: boolean;
  send(msg: Out): void;
  onMessage(fn: (msg: In) => void): Unsubscribe;
  onClose(fn: () => void): Unsubscribe;
  close(): void;
}

/** Shared listener bookkeeping for transport implementations. */
export class Emitter<T> {
  private fns: ((v: T) => void)[] = [];
  on(fn: (v: T) => void): Unsubscribe {
    this.fns.push(fn);
    return () => {
      this.fns = this.fns.filter((f) => f !== fn);
    };
  }
  emit(v: T): void {
    for (const fn of [...this.fns]) fn(v);
  }
}

class LoopbackEnd<Out, In> implements Transport<Out, In> {
  isOpen = true;
  private readonly messages = new Emitter<In>();
  private readonly closes = new Emitter<void>();
  peer!: LoopbackEnd<In, Out>;

  send(msg: Out): void {
    if (!this.isOpen) return;
    // Round-trip through JSON so loopback behaves like a real wire (no shared references).
    const copy = JSON.parse(JSON.stringify(msg)) as Out;
    void Promise.resolve().then(() => (this.peer as unknown as LoopbackEnd<unknown, Out>).messages.emit(copy));
  }
  onMessage(fn: (msg: In) => void): Unsubscribe {
    return this.messages.on(fn);
  }
  onClose(fn: () => void): Unsubscribe {
    return this.closes.on(fn);
  }
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.closes.emit();
    this.peer.close();
  }
}

/** Two connected in-process transports. For tests and for local play through the same code path. */
export function createLoopbackPair<A, B>(): [Transport<A, B>, Transport<B, A>] {
  const a = new LoopbackEnd<A, B>();
  const b = new LoopbackEnd<B, A>();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
