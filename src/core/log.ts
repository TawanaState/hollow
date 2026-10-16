import { SKILLS } from '../content/skills.ts';
import type { GameEvent } from './types.ts';

const who = (id: number): string => `P${id + 1}`;
const name = (skill: string): string => SKILLS[skill]?.name ?? skill;

/**
 * One compact, human/LLM-readable line per event. This is the text an AI observer
 * reads instead of looking at the screen. Returns null for events too noisy to log.
 */
export function describeEvent(e: GameEvent): string | null {
  const at = `f${e.f}`;
  switch (e.t) {
    case 'ROUND_START':
      return `${at} round start`;
    case 'ROUND_GO':
      return `${at} FIGHT`;
    case 'SKILL':
      return `${at} ${who(e.id)} uses ${name(e.skill)}`;
    case 'HIT': {
      const tags = [e.counter ? 'counter' : '', e.side === 'back' ? 'from behind' : '', e.launch ? 'launch' : '']
        .filter(Boolean)
        .join(', ');
      return `${at} ${who(e.atk)} ${name(e.skill)} HITS ${who(e.def)} -${e.damage}hp (${e.tier}${tags ? ', ' + tags : ''}) combo ${e.combo}`;
    }
    case 'BLOCK':
      return `${at} ${who(e.def)} blocks ${who(e.atk)} ${name(e.skill)} (chip ${e.chip})`;
    case 'PARRY':
      return `${at} ${who(e.def)} PARRIES ${who(e.atk)} ${name(e.skill)}`;
    case 'GUARD_BREAK':
      return `${at} ${who(e.id)} guard broken`;
    case 'JUMP':
      return `${at} ${who(e.id)} jumps`;
    case 'DASH':
      return `${at} ${who(e.id)} dashes ${e.dir > 0 ? 'right' : 'left'}`;
    case 'KNOCKDOWN':
      return `${at} ${who(e.id)} knocked down`;
    case 'COMBO_END':
      return `${at} ${who(e.id)} combo over: ${e.hits} hits, ${e.damage} damage`;
    case 'KO':
      return `${at} ${who(e.id)} K.O.${e.winner >= 0 ? ` ${who(e.winner)} wins` : ' (draw)'}`;
    case 'STATE':
    case 'LAND':
      return null;
  }
}
