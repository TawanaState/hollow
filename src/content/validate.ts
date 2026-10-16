import { ANIMS } from './anims.ts';
import { IMPACT, IMPACT_ORDER } from './impacts.ts';
import { POSES } from './poses.ts';
import { SKILLS } from './skills.ts';
import { VFX } from './vfx.ts';
import { SFX } from './sfx.ts';
import type { AnimDef, Pose } from './types.ts';

const POSE_KEYS: (keyof Pose)[] = [
  'lean', 'head', 'shift', 'roll',
  'frontArm', 'frontForearm', 'backArm', 'backForearm',
  'frontThigh', 'frontShin', 'backThigh', 'backShin',
];

function checkPose(where: string, p: Pose, out: string[]): void {
  for (const key of POSE_KEYS) if (!Number.isFinite(p[key])) out.push(`${where}: pose field '${key}' is not a number`);
}

function checkAnim(where: string, a: AnimDef, out: string[]): void {
  if (a.keys.length === 0) return void out.push(`${where}: no keys`);
  if (a.keys[0].f !== 0) out.push(`${where}: first key must be at f=0 (is ${a.keys[0].f})`);
  for (let i = 0; i < a.keys.length; i++) {
    const key = a.keys[i];
    if (i > 0 && key.f < a.keys[i - 1].f) out.push(`${where}: keys out of order at index ${i}`);
    if (key.f > a.duration) out.push(`${where}: key f=${key.f} beyond duration ${a.duration}`);
    checkPose(`${where}[${i}]`, key.pose, out);
  }
}

/** Returns a list of human-readable problems. Empty = content is valid. */
export function validateContent(): string[] {
  const out: string[] = [];
  const ids = new Set(Object.keys(SKILLS));
  const reachable = new Set<string>();

  for (const [id, s] of Object.entries(SKILLS)) {
    const at = `skill '${id}'`;
    for (const key of ['startup', 'active', 'recovery'] as const) {
      if (!Number.isInteger(s[key]) || s[key] < 1) out.push(`${at}: ${key} must be a whole number of F >= 1`);
    }
    if (!(s.impact in IMPACT)) out.push(`${at}: unknown impact tier '${s.impact}' (use ${IMPACT_ORDER.join('/')})`);
    for (const key of ['damage', 'guardDamage', 'hitstun', 'blockstun', 'knockback'] as const) {
      if (!(s[key] >= 0)) out.push(`${at}: ${key} must be >= 0`);
    }
    for (const b of Array.isArray(s.hitbox) ? s.hitbox : [s.hitbox]) {
      if (!(b.w > 0 && b.h > 0)) out.push(`${at}: hitbox needs positive w and h`);
    }
    for (const rule of s.cancels ?? []) {
      for (const target of rule.into) {
        if (target === 'dash' || target === 'jump') continue;
        if (!ids.has(target)) out.push(`${at}: cancel into unknown skill '${target}'`);
        else reachable.add(target);
      }
    }
    if (s.anim.length === 0) out.push(`${at}: needs at least one anim key`);
    else if (s.anim[0].phase !== 'startup' || s.anim[0].t !== 0) out.push(`${at}: first anim key must be startup t=0`);
    for (const [i, key] of s.anim.entries()) {
      if (key.t < 0 || key.t > 1) out.push(`${at}: anim[${i}].t must be 0..1`);
      checkPose(`${at} anim[${i}]`, key.pose, out);
    }
  }

  for (const [id, s] of Object.entries(SKILLS)) {
    if (s.chainOnly && !reachable.has(id)) out.push(`skill '${id}' is chainOnly but no skill cancels into it`);
  }

  // Two neutral-reachable skills with the same input would shadow each other.
  const seen = new Map<string, string>();
  for (const [id, s] of Object.entries(SKILLS)) {
    if (s.chainOnly) continue;
    const sig = `${s.input.button}|${s.input.dir ?? 'any'}|${s.input.air ? 'air' : 'ground'}`;
    const other = seen.get(sig);
    if (other) out.push(`skills '${other}' and '${id}' share the same input (${sig})`);
    seen.set(sig, id);
  }

  for (const [name, p] of Object.entries(POSES)) checkPose(`pose '${name}'`, p, out);
  for (const [name, a] of Object.entries(ANIMS)) checkAnim(`anim '${name}'`, a, out);

  for (const [key, steps] of Object.entries(VFX)) {
    for (const step of steps) {
      if (step.minTier && !(step.minTier in IMPACT)) out.push(`vfx '${key}': unknown minTier '${step.minTier}'`);
    }
  }
  for (const [key, layers] of Object.entries(SFX)) {
    for (const l of layers) if (!(l.dur > 0)) out.push(`sfx '${key}': dur must be > 0`);
  }
  return out;
}

/** Throws with every problem listed. Called at startup so a typo fails loudly. */
export function assertValidContent(): void {
  const problems = validateContent();
  if (problems.length) throw new Error(`Invalid game content:\n - ${problems.join('\n - ')}`);
}
