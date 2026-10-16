import { createRng } from '../core/rng.ts';
import { N_OUT } from './actions.ts';
import { OBS_DIM, schemaHash } from './features.ts';
import { Mlp } from './nn.ts';

/**
 * THE BRAIN'S SHAPE. Every persona uses the same network layout, which is what makes saved brains
 * interchangeable (any persona can be cloned, exported, or used as a sparring partner).
 *
 * ~20,000 weights: small enough to run in microseconds and train in seconds on a phone, big
 * enough to read distance, timing and habits.
 */
export const HIDDEN: readonly number[] = [96, 64];
export const NET_SIZES: readonly number[] = [OBS_DIM, ...HIDDEN, N_OUT];

/** Changes whenever what a brain means changes (inputs, outputs, layout). Saved brains carry it. */
export const SCHEMA: string = schemaHash(NET_SIZES);

export const newBrain = (seed = 1): Mlp => new Mlp(NET_SIZES, createRng(seed));

/** Load a saved brain, refusing one built for a different layout. */
export function brainFromBuffer(buf: ArrayBuffer): Mlp {
  const net = Mlp.fromBuffer(buf);
  if (net.sizes.length !== NET_SIZES.length || net.sizes.some((s, i) => s !== NET_SIZES[i])) {
    throw new Error('This brain was made for a different version of the game and cannot be used.');
  }
  return net;
}
