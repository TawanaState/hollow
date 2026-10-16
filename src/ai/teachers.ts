import type { StyleId } from '../content/ai.ts';
import { SKILLS } from '../content/skills.ts';
import { STATES } from '../content/states.ts';
import { BUTTON, MOVE, buttonMask, moveMask, sanitize } from './actions.ts';
import type { Action } from './actions.ts';
import type { Decision, DecisionContext, Policy } from './policy.ts';
import { sensibleRandom } from './policy.ts';
import { REACH, framesToActive, framesUntilFree } from './tactics.ts';

/**
 * TEACHER BOTS: hand-written fighting logic. They see the real game state (no fuzzy edges), know
 * how far every move reaches and how many frames it takes, and fight with a style. They exist to
 * (1) generate the first training data and (2) label states during imitation training, so the
 * starter personas start out competent and distinctly different instead of random.
 *
 * What a teacher knows how to do, in order of priority:
 *   - defend: guard (sometimes timed as a parry), crouch-guard against lows, back-dash out
 *   - punish: hit back during the opponent's recovery or stun, with a move that fits the window
 *   - continue a string while it is connecting
 *   - control distance: dash in, walk to its preferred range, back off if crowded
 *   - poke, sweep, jump in, and use the ultimate when it is ready
 */
export interface TeacherStyle {
  id: StyleId;
  /** Preferred centre-to-centre distance range. */
  band: readonly [number, number];
  poke: number;
  /** Chance to guard when an attack is coming. */
  guard: number;
  /** Chance a guard is timed as a parry (raised just before the hit lands). */
  parry: number;
  evade: number;
  /** Chance to hit back when the opponent is open. */
  punish: number;
  dashIn: number;
  jumpIn: number;
  sweep: number;
  ultimate: number;
  /** Chance of a random action instead (keeps the data varied). */
  noise: number;
}

export const TEACHERS: Record<'ember' | 'stone' | 'echo', TeacherStyle> = {
  ember: { id: 'ember', band: [60, 135], poke: 0.55, guard: 0.35, parry: 0.2, evade: 0.08, punish: 0.75, dashIn: 0.85, jumpIn: 0.1, sweep: 0.08, ultimate: 0.55, noise: 0.04 },
  stone: { id: 'stone', band: [150, 245], poke: 0.22, guard: 0.85, parry: 0.55, evade: 0.14, punish: 0.95, dashIn: 0.12, jumpIn: 0.03, sweep: 0.14, ultimate: 0.35, noise: 0.03 },
  echo: { id: 'echo', band: [100, 185], poke: 0.38, guard: 0.6, parry: 0.4, evade: 0.12, punish: 0.85, dashIn: 0.45, jumpIn: 0.1, sweep: 0.15, ultimate: 0.45, noise: 0.04 },
};

/** Which teacher bot matches each reward style (the neutral style uses the all-rounder). */
export const TEACHER_FOR: Record<StyleId, keyof typeof TEACHERS> = { neutral: 'echo', ember: 'ember', stone: 'stone', echo: 'echo' };

const STAND = { move: MOVE.neutral, button: BUTTON.none } as const;

export class TeacherPolicy implements Policy {
  readonly style: TeacherStyle;
  constructor(style: TeacherStyle) {
    this.style = style;
  }

  decide(ctx: DecisionContext): Decision {
    const a = this.choose(ctx);
    return { ...sanitize(a, ctx.mask), value: 0 };
  }

  private choose(ctx: DecisionContext): Action {
    const { me, opp, rng, mask } = ctx;
    const S = this.style;
    const can = (b: number): boolean => ((buttonMask(mask) >> b) & 1) === 1;
    const canMove = (m: number): boolean => ((moveMask(mask) >> m) & 1) === 1;
    const dx = (opp.x - me.x) * me.facing;
    const dist = Math.abs(dx);
    const inReach = (id: string, slack = 0): boolean => dist >= REACH[id].min - slack && dist <= REACH[id].max - 4;

    // helpless: nothing to do (but keep guard up through blockstun)
    if (buttonMask(mask) === 1 << BUTTON.none && moveMask(mask) === 1 << MOVE.neutral) return STAND;
    if (me.state === 'blockstun') return can(BUTTON.guard) && rng.chance(0.85) ? { move: MOVE.neutral, button: BUTTON.guard } : STAND;
    if (rng.chance(S.noise)) return sensibleRandom(mask, rng);

    // how the opponent's habits shape this teacher (echo adapts, the others do not):
    // against someone who keeps attacking it guards more; against someone passive it pokes more
    let aggroFactor = 0;
    let pokeBonus = 0;
    if (S.id === 'echo') {
      if (ctx.tracker.share([7, 8, 9]) > 0.3) aggroFactor = 0.25;
      if (ctx.tracker.share([0, 3, 4]) > 0.6) pokeBonus = 0.25;
    }

    // ── 1. defend ──
    const threat = opp.state === 'attack' && opp.skill ? opp.skill : null;
    if (threat && dist <= REACH[threat].max + 24 && dx > -30) {
      const wind = framesToActive(opp);
      const low = SKILLS[threat].level === 'low';
      if (can(BUTTON.guard) && rng.chance(Math.min(1, S.guard + aggroFactor))) {
        if (rng.chance(S.parry) && wind !== null && wind > 5) return STAND; // wait, then raise guard so the hit lands inside the parry window
        return { move: low ? MOVE.down : MOVE.neutral, button: BUTTON.guard };
      }
      if (can(BUTTON.dash) && canMove(MOVE.back) && rng.chance(S.evade)) return { move: MOVE.back, button: BUTTON.dash };
    }

    // ── 2. punish an open opponent ──
    const openFor = STATES[opp.state].invulnerable ? 0 : framesUntilFree(opp);
    if (openFor > 0 && rng.chance(S.punish)) {
      if (me.energy >= 50 && can(BUTTON.skill) && openFor >= 14 && inReach('rush', 120) && rng.chance(S.ultimate)) return { move: MOVE.neutral, button: BUTTON.skill };
      if (openFor >= 16 && can(BUTTON.heavy) && inReach('straight')) return { move: MOVE.neutral, button: BUTTON.heavy };
      if (openFor >= 10 && can(BUTTON.heavy) && canMove(MOVE.down) && inReach('sweep') && rng.chance(0.4)) return { move: MOVE.down, button: BUTTON.heavy };
      if (openFor >= 6 && can(BUTTON.light) && inReach('jab')) return { move: MOVE.neutral, button: BUTTON.light };
      if (dist > REACH.jab.max - 20) return can(BUTTON.dash) && dist > 190 && openFor > 10 ? { move: MOVE.forward, button: BUTTON.dash } : { move: MOVE.forward, button: BUTTON.none };
    }

    // ── 3. keep a string going while it connects ──
    if (me.state === 'attack' && (me.skillHit || me.skillBlocked)) {
      const hit = me.skillHit;
      if (hit && can(BUTTON.light) && me.skill !== 'spinKick' && rng.chance(0.85)) return { move: MOVE.neutral, button: BUTTON.light };
      if (hit && can(BUTTON.heavy) && rng.chance(S.id === 'stone' ? 0.5 : 0.35)) return { move: MOVE.neutral, button: BUTTON.heavy };
      return STAND;
    }
    if (me.state === 'attack') return STAND;

    // ── 4. in the air: dive in or drift toward them ──
    if (me.state === 'jump') {
      if (can(BUTTON.light) && dist < REACH.airKick.max + 20 && rng.chance(0.9)) return { move: MOVE.forward, button: BUTTON.light };
      return { move: dist > 120 ? MOVE.forward : MOVE.neutral, button: BUTTON.none };
    }

    // ── 5. neutral: control the distance ──
    const [near, far] = S.band;
    if (dist > far + 70) {
      if (can(BUTTON.dash) && rng.chance(S.dashIn)) return { move: MOVE.forward, button: BUTTON.dash };
      return { move: MOVE.forward, button: BUTTON.none };
    }
    if (dist > far) {
      if (canMove(MOVE.upForward) && rng.chance(S.jumpIn * 0.3) && dist < 330) return { move: MOVE.upForward, button: BUTTON.none };
      return { move: MOVE.forward, button: BUTTON.none };
    }
    // in the preferred band, or inside it
    if (rng.chance(S.poke + pokeBonus)) {
      if (me.energy >= 50 && can(BUTTON.skill) && dist < REACH.rush.max && rng.chance(S.ultimate * 0.4)) return { move: MOVE.neutral, button: BUTTON.skill };
      if (can(BUTTON.heavy) && canMove(MOVE.down) && inReach('sweep') && rng.chance(S.sweep)) return { move: MOVE.down, button: BUTTON.heavy };
      if (can(BUTTON.heavy) && inReach('straight') && !inReach('jab') && rng.chance(0.4)) return { move: MOVE.neutral, button: BUTTON.heavy };
      if (can(BUTTON.light) && inReach('jab')) return { move: MOVE.neutral, button: BUTTON.light };
      if (dist > REACH.jab.max - 10) return { move: MOVE.forward, button: BUTTON.none };
    }
    if (dist < near) {
      // crowded: back off, or crash in if rushing
      if (S.id === 'ember') return can(BUTTON.light) && inReach('jab') ? { move: MOVE.neutral, button: BUTTON.light } : STAND;
      return { move: MOVE.back, button: BUTTON.none };
    }
    // idle in range: a little shuffling so it does not stand like a statue
    const r = rng.next();
    if (r < 0.2) return { move: MOVE.forward, button: BUTTON.none };
    if (r < 0.38) return { move: MOVE.back, button: BUTTON.none };
    if (r < 0.46 && can(BUTTON.guard) && S.guard > 0.5) return { move: MOVE.neutral, button: BUTTON.guard };
    return STAND;
  }
}
