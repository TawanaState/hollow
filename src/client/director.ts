import { SKILLS } from '../content/skills.ts';
import type { ImpactTier } from '../content/impacts.ts';
import type { Facing, FighterId, GameEvent, World } from '../core/types.ts';

/** Where and how strongly an effect plays. */
export interface FxContext {
  x: number;
  y: number;
  dir: Facing;
  tier: ImpactTier;
  /** Freeze length of this event, for effects that should match it (jitter). */
  hitstop: number;
  /** Fighter on the receiving end, if any. */
  victim?: FighterId;
  /** Hits in the combo so far (sounds climb in pitch with it). */
  combo?: number;
  /** Not tied to a place on screen: do not pan the sound. */
  global?: boolean;
}

export interface Cue {
  /** Recipe keys to play (content/vfx.ts and content/sfx.ts). */
  keys: string[];
  ctx: FxContext;
  /** An announcer line to say, after this many F. */
  announce?: { line: string; delayF: number };
}

/** What the director may need to know about the match beyond the event itself. */
export interface DirectorView {
  world?: World;
  /** Which seat a person plays in a single-player match (so the announcer can say "You win"), if any. */
  humanSlot?: FighterId | null;
}

/**
 * THE MAPPING from game events to presentation. This is the only place that decides
 * "which event plays which effect/sound". Add a key here, then add a recipe under the
 * same key in content/vfx.ts and/or content/sfx.ts.
 */
export function cueFor(e: GameEvent, view: DirectorView = {}): Cue | null {
  const at = (x: number, y = 0): FxContext => ({ x, y, dir: 1, tier: 'light', hitstop: 0 });
  const everywhere = (): FxContext => ({ ...at(0), global: true });
  switch (e.t) {
    case 'HIT': {
      const keys = ['hit'];
      if (e.counter) keys.push('counter');
      if (e.side === 'back') keys.push('backhit');
      const cue: Cue = { keys, ctx: { x: e.x, y: e.y, dir: e.dir, tier: e.tier, hitstop: e.hitstop, victim: e.def, combo: e.combo } };
      if (e.combo === 5) cue.announce = { line: 'combo', delayF: 10 };
      return cue;
    }
    case 'BLOCK':
      return { keys: ['block'], ctx: { x: e.x, y: e.y, dir: e.dir, tier: e.tier, hitstop: e.hitstop, victim: e.def } };
    case 'PARRY':
      return { keys: ['parry'], ctx: { x: e.x, y: e.y, dir: e.dir, tier: 'medium', hitstop: e.hitstop, victim: e.atk } };
    case 'GUARD_BREAK':
      return { keys: ['guardBreak'], ctx: { ...at(e.x, e.y), tier: 'heavy', victim: e.id } };
    case 'SKILL':
      return { keys: ['skill', `skill.${e.skill}`], ctx: { ...at(0), tier: e.tier, global: true } };
    case 'JUMP':
      return { keys: ['jump'], ctx: at(e.x) };
    case 'LAND':
      return e.power > 0.25 ? { keys: ['land'], ctx: { ...at(e.x), tier: e.power > 0.7 ? 'medium' : 'light' } } : null;
    case 'DASH':
      return { keys: ['dash'], ctx: { ...at(e.x), dir: e.dir } };
    case 'KNOCKDOWN':
      return { keys: ['knockdown'], ctx: { ...at(e.x), tier: 'medium' } };
    case 'KO': {
      return { keys: ['ko'], ctx: { ...at(e.x, e.y), tier: 'crush', victim: e.id }, announce: { line: closingLine(e.winner, view), delayF: 85 } };
    }
    case 'ROUND_START': {
      const w = view.world;
      const round = w ? w.score[0] + w.score[1] + 1 : 1;
      return { keys: ['roundStart'], ctx: everywhere(), announce: { line: round > 5 ? 'final-round' : `round-${round}`, delayF: 8 } };
    }
    case 'ROUND_GO':
      return { keys: ['roundGo'], ctx: everywhere(), announce: { line: 'fight', delayF: 0 } };
    case 'STATE':
    case 'COMBO_END':
      return null;
  }
}

/** What the announcer says when the round ends. */
function closingLine(winner: FighterId | -1, view: DirectorView): string {
  if (winner === -1) return 'tie';
  const human = view.humanSlot;
  if (human === 0 || human === 1) return winner === human ? 'you-win' : 'you-lose';
  const w = view.world;
  return w && w.fighters[winner].hp >= w.fighters[winner].maxHp ? 'flawless' : 'winner';
}

/** Sound keys for a cue: the more specific "<key>.<tier>" is used if a recipe exists. */
export function sfxKeys(cue: Cue, has: (key: string) => boolean): string[] {
  const out: string[] = [];
  for (const k of cue.keys) {
    const tiered = `${k}.${cue.ctx.tier}`;
    if (has(tiered)) out.push(tiered);
    else if (has(k)) out.push(k);
  }
  return out;
}

/** Skill names are only used for debug labels. */
export const skillName = (id: string): string => SKILLS[id]?.name ?? id;
