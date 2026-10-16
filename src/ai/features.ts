import { AI } from '../content/ai.ts';
import { PHYSICS, RULES, STAGE } from '../content/config.ts';
import { SKILLS, skillTotal } from '../content/skills.ts';
import { STATES } from '../content/states.ts';
import type { StateId } from '../content/states.ts';
import { createWorld } from '../core/sim.ts';
import type { Fighter, World } from '../core/types.ts';
import { BUTTONS, MOVES, N_BUTTONS, N_MOVES } from './actions.ts';
import type { Action } from './actions.ts';
import { REACH, SKILL_IDS, attackPhase, clamp, framesToActive, framesUntilFree } from './tactics.ts';

/**
 * WHAT THE AI SEES. A fixed-size list of numbers describing the fight from one fighter's point
 * of view. It holds only what a player could see on screen (no peeking at the opponent's buttons).
 *
 * Everything is RELATIVE TO FACING: "in front" and "behind" never depend on which side of the
 * screen you are on, so one lesson works on both sides. Distance, height, speed, walls, who is
 * facing whom, what each fighter is doing and how far into it, how long until each can act,
 * meters, combos, how far each of my moves would reach, and a short memory of what the opponent
 * has been doing (so it can spot habits like "always dashes in then jabs").
 */

const STATE_IDS = Object.keys(STATES) as StateId[];
export const OPP_CLASSES = 11;
const HW = STAGE.halfWidth;

/** Coarse labels for what the opponent is doing, for the short memory of their habits. */
export function classifyOpp(opp: Fighter, me: Fighter): number {
  switch (opp.state) {
    case 'idle':
      return 0;
    case 'walk':
      return opp.vx * (me.x - opp.x) > 0 ? 1 : 2;
    case 'crouch':
      return 3;
    case 'guard':
      return 4;
    case 'jump':
      return 5;
    case 'dash':
      return 6;
    case 'attack': {
      const b = opp.skill ? SKILLS[opp.skill].input.button : 'light';
      return b === 'light' ? 7 : b === 'heavy' ? 8 : 9;
    }
    default:
      return 10;
  }
}

/** One agent's memory between decisions: what the opponent has been doing, and what I did last. */
export class Tracker {
  private readonly hist = new Uint8Array(AI.historyLen).fill(255);
  private head = 0;
  lastMove = 0;
  lastButton = 0;

  reset(): void {
    this.hist.fill(255);
    this.head = 0;
    this.lastMove = 0;
    this.lastButton = 0;
  }

  observe(opp: Fighter, me: Fighter): void {
    this.hist[this.head] = classifyOpp(opp, me);
    this.head = (this.head + 1) % this.hist.length;
  }

  /** Share of the remembered opponent behaviour that falls in these classes (0..1). */
  share(classes: readonly number[]): number {
    let n = 0;
    let hit = 0;
    for (const c of this.hist) {
      if (c === 255) continue;
      n++;
      if (classes.includes(c)) hit++;
    }
    return n === 0 ? 0 : hit / n;
  }

  remember(a: Action): void {
    this.lastMove = a.move;
    this.lastButton = a.button;
  }

  /** Share of recent decisions spent in each class, plus the latest one. */
  write(out: Float32Array, at: number): number {
    let n = 0;
    for (let i = 0; i < OPP_CLASSES * 2; i++) out[at + i] = 0;
    for (const c of this.hist) {
      if (c === 255) continue;
      out[at + c]++;
      n++;
    }
    if (n > 0) for (let i = 0; i < OPP_CLASSES; i++) out[at + i] /= n;
    const last = this.hist[(this.head + this.hist.length - 1) % this.hist.length];
    if (last !== 255) out[at + OPP_CLASSES + last] = 1;
    return at + OPP_CLASSES * 2;
  }
}

function writeFighter(out: Float32Array, k: number, f: Fighter): number {
  // state one-hot
  for (const id of STATE_IDS) out[k++] = f.state === id ? 1 : 0;
  // current skill one-hot, phase one-hot, progress
  const attacking = f.state === 'attack' && f.skill;
  for (const id of SKILL_IDS) out[k++] = attacking && f.skill === id ? 1 : 0;
  const phase = attackPhase(f);
  out[k++] = phase === 'startup' ? 1 : 0;
  out[k++] = phase === 'active' ? 1 : 0;
  out[k++] = phase === 'recovery' ? 1 : 0;
  out[k++] = attacking && f.skill ? f.stateF / skillTotal(SKILLS[f.skill]) : 0;
  return k;
}

/** Fill `out` with the observation for `me` looking at `opp`. Returns how many numbers it wrote. */
export function encode(me: Fighter, opp: Fighter, tracker: Tracker, hitstop: number, out: Float32Array): number {
  const dx = (opp.x - me.x) * me.facing; // + = opponent is in front of me
  const dist = Math.abs(dx);
  let k = 0;

  // distance and direction
  out[k++] = clamp(dx / 400, -1.5, 1.5);
  out[k++] = Math.min(1, dist / 800);
  out[k++] = Math.min(1, dist / 300);
  out[k++] = Math.min(1, dist / 120);
  out[k++] = dx > 0 ? 1 : 0; // am I facing them
  out[k++] = (me.x - opp.x) * opp.facing > 0 ? 1 : 0; // are they facing me

  // height and speed
  out[k++] = clamp((opp.y - me.y) / 150, -2, 2);
  out[k++] = clamp(me.y / 150, 0, 2);
  out[k++] = clamp(opp.y / 150, 0, 2);
  out[k++] = clamp(me.vy / 20, -1.5, 1.5);
  out[k++] = clamp(opp.vy / 20, -1.5, 1.5);
  out[k++] = clamp((me.vx * me.facing) / 15, -2, 2);
  out[k++] = clamp((opp.vx * me.facing) / 15, -2, 2);

  // walls: how much room is behind me, and behind them (the corner)
  const pMe = me.x * me.facing;
  const pOpp = opp.x * me.facing;
  out[k++] = (pMe + HW) / (2 * HW);
  out[k++] = (HW - pOpp) / (2 * HW);

  k = writeFighter(out, k, me);
  k = writeFighter(out, k, opp);

  // meters
  out[k++] = me.hp / me.maxHp;
  out[k++] = opp.hp / opp.maxHp;
  out[k++] = me.guard / RULES.maxGuard;
  out[k++] = opp.guard / RULES.maxGuard;
  out[k++] = me.energy / RULES.maxEnergy;
  out[k++] = opp.energy / RULES.maxEnergy;

  // what I can do right now
  out[k++] = me.energy >= 50 ? 1 : 0;
  out[k++] = (me.cooldown.dash ?? 0) > 0 ? 1 : 0;
  out[k++] = (me.cooldown.guard ?? 0) > 0 ? 1 : 0;
  out[k++] = me.state === 'attack' && (me.skillHit || me.skillBlocked) ? 1 : 0;
  out[k++] = hitstop > 0 ? 1 : 0;
  out[k++] = me.state === 'dash' && me.stateF >= PHYSICS.dash.cancelAfter ? 1 : 0;

  // combos and timing
  out[k++] = Math.min(1, me.combo / 8);
  out[k++] = Math.min(1, opp.combo / 8);
  out[k++] = Math.min(1, framesUntilFree(me) / 40);
  out[k++] = Math.min(1, framesUntilFree(opp) / 40);
  const myWind = framesToActive(me);
  const oppWind = framesToActive(opp);
  out[k++] = myWind === null ? 1 : Math.min(1, myWind / 20);
  out[k++] = oppWind === null ? 1 : Math.min(1, oppWind / 20);

  // how far each of my moves reaches: positive = the opponent is inside it
  for (const id of SKILL_IDS) out[k++] = clamp((REACH[id].max - dist) / 100, -1, 1);
  // how far the opponent's current move reaches
  const oppReach = opp.state === 'attack' && opp.skill ? REACH[opp.skill].max : 0;
  out[k++] = oppReach > 0 ? clamp((oppReach - dist) / 100, -1, 1) : -1;

  // memory: opponent habits and my own last action
  k = tracker.write(out, k);
  for (let i = 0; i < N_MOVES; i++) out[k++] = tracker.lastMove === i ? 1 : 0;
  for (let i = 0; i < N_BUTTONS; i++) out[k++] = tracker.lastButton === i ? 1 : 0;
  return k;
}

/** Observation length, measured from the encoder itself so it can never drift out of sync. */
export const OBS_DIM: number = (() => {
  const w = createWorld();
  return encode(w.fighters[0], w.fighters[1], new Tracker(), 0, new Float32Array(1024));
})();

/** Convenience for a whole world. */
export function observe(w: World, meId: 0 | 1, tracker: Tracker, out: Float32Array): number {
  return encode(w.fighters[meId], w.fighters[meId === 0 ? 1 : 0], tracker, w.hitstop, out);
}

/** A short fingerprint of everything that decides what a saved brain means. A mismatch = retrain. */
export function schemaHash(sizes: readonly number[]): string {
  const text = [OBS_DIM, SKILL_IDS.join(','), MOVES.join(','), BUTTONS.join(','), STATE_IDS.join(','), sizes.join('x'), AI.decisionFrames, 'v1'].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
