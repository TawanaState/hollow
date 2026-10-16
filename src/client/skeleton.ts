import { BODY_SCALE } from '../content/config.ts';
import type { Pose } from '../content/types.ts';

const S = BODY_SCALE;

/**
 * Bone lengths in world units (reference size x BODY_SCALE). Poses are angles only, so these
 * are the only thing that sets how tall a fighter is. The head shrinks less than the body,
 * which gives the shorter build its stocky, cartoon proportions.
 */
export const BODY = {
  spine: 54 * S,
  thigh: 45 * S,
  shin: 45 * S,
  upperArm: 30 * S,
  foreArm: 30 * S,
  headR: 15 * (0.55 + 0.45 * S),
  /** Gap between the top of the spine and the head centre, beyond the head radius. */
  neck: 8 * S,
  /** Where along the spine the shoulders sit (0 = hip, 1 = neck). */
  shoulder: 0.9,
} as const;

export interface Pt {
  x: number;
  y: number;
}

export interface Joints {
  hip: Pt;
  neck: Pt;
  head: Pt;
  shoulder: Pt;
  elbowF: Pt;
  handF: Pt;
  elbowB: Pt;
  handB: Pt;
  kneeF: Pt;
  footF: Pt;
  kneeB: Pt;
  footB: Pt;
}

const RAD = Math.PI / 180;

/**
 * Angle convention: 0 = straight down, positive = swinging toward the front.
 * Returns a unit vector in a y-UP coordinate system.
 */
const dir = (deg: number): Pt => ({ x: Math.sin(deg * RAD), y: -Math.cos(deg * RAD) });
const add = (a: Pt, b: Pt, len: number): Pt => ({ x: a.x + b.x * len, y: a.y + b.y * len });

const KEYS: (keyof Joints)[] = [
  'hip', 'neck', 'head', 'shoulder', 'elbowF', 'handF', 'elbowB', 'handB', 'kneeF', 'footF', 'kneeB', 'footB',
];

/**
 * Forward kinematics: pose angles -> joint positions in WORLD space (y up).
 * The body is rolled about the hip, then dropped so its lowest point rests at `y`
 * (so feet never float or sink whatever the pose), then mirrored by facing.
 */
export function placeJoints(p: Pose, facing: 1 | -1, x: number, y: number): Joints {
  const hip: Pt = { x: 0, y: 0 };
  const spine = { x: Math.sin(p.lean * RAD), y: Math.cos(p.lean * RAD) };
  const neck = add(hip, spine, BODY.spine);
  const headDir = { x: Math.sin((p.lean + p.head) * RAD), y: Math.cos((p.lean + p.head) * RAD) };
  const head = add(neck, headDir, BODY.headR + BODY.neck);
  const shoulder = add(hip, spine, BODY.spine * BODY.shoulder);

  const elbowF = add(shoulder, dir(p.frontArm), BODY.upperArm);
  const handF = add(elbowF, dir(p.frontArm + p.frontForearm), BODY.foreArm);
  const elbowB = add(shoulder, dir(p.backArm), BODY.upperArm);
  const handB = add(elbowB, dir(p.backArm + p.backForearm), BODY.foreArm);
  const kneeF = add(hip, dir(p.frontThigh), BODY.thigh);
  const footF = add(kneeF, dir(p.frontThigh + p.frontShin), BODY.shin);
  const kneeB = add(hip, dir(p.backThigh), BODY.thigh);
  const footB = add(kneeB, dir(p.backThigh + p.backShin), BODY.shin);

  const j: Joints = { hip, neck, head, shoulder, elbowF, handF, elbowB, handB, kneeF, footF, kneeB, footB };

  // roll about the hip (forward positive)
  const cos = Math.cos(p.roll * RAD);
  const sin = Math.sin(p.roll * RAD);
  let minY = Infinity;
  for (const k of KEYS) {
    const q = j[k];
    const rx = q.x * cos + q.y * sin;
    const ry = -q.x * sin + q.y * cos;
    q.x = rx + p.shift * S;
    q.y = ry;
    minY = Math.min(minY, k === 'head' ? q.y - BODY.headR : q.y);
  }
  // ground snap + place + mirror
  for (const k of KEYS) {
    const q = j[k];
    q.x = x + facing * q.x;
    q.y = y + q.y - minY;
  }
  return j;
}
