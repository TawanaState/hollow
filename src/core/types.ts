import type { ImpactTier } from '../content/impacts.ts';
import type { StateId } from '../content/states.ts';
import type { Action, InputFrame } from './input.ts';

export type FighterId = 0 | 1;
export type Facing = 1 | -1;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Fighter {
  id: FighterId;
  /** World position. x is horizontal, y is height of the feet above the ground. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** +1 faces right (+x), -1 faces left. Always resolved relative to the opponent. */
  facing: Facing;

  hp: number;
  /** Full health for this match (RULES.maxHp x the world's hpScale). */
  maxHp: number;
  guard: number;
  energy: number;
  /** F until guard starts regenerating. */
  guardDelay: number;

  state: StateId;
  /** F spent in the current state (0 on the first frame). */
  stateF: number;
  /** Length of a timed state (stuns, dash, land...). Infinity for open-ended states. */
  stateDur: number;
  /** Skill id while state === 'attack'. */
  skill: string | null;
  /** Current attack connected (hit). */
  skillHit: boolean;
  /** Current attack was blocked. */
  skillBlocked: boolean;
  hitCount: number;
  lastHitF: number;

  /** Direction of the current dash (world space, +1/-1). */
  dashDir: Facing;
  /** The dash is braking to a stop. */
  dashEnding: boolean;
  /** Guard was raised freshly, so a hit inside the parry window is a parry. */
  guardFresh: boolean;
  koBounced: boolean;
  /** Controls are switched off because the opponent is down (see RULES.fairGetup). */
  held: boolean;

  /** Hits taken in the current combo and the damage they did. */
  combo: number;
  comboDamage: number;

  input: InputFrame;
  /** F each buffered press remains usable. */
  buffer: Record<Action, number>;
  /** F until a skill/dash/guard is usable again. Keyed by skill id, 'dash', 'guard'. */
  cooldown: Record<string, number>;
}

export type Phase = 'intro' | 'fight' | 'ko';

export interface World {
  /** Total sim frames stepped. */
  frame: number;
  fighters: [Fighter, Fighter];
  /** Frames of global freeze remaining. */
  hitstop: number;
  phase: Phase;
  phaseF: number;
  /** Winner of the round, -1 for a draw, or null while fighting. */
  winner: FighterId | -1 | null;
  /** Round wins, persists across rounds. */
  score: [number, number];
  /** Health multiplier for this match (1 = the reference 1000 HP). */
  hpScale: number;
}

export type HitSide = 'front' | 'back';

interface Base {
  /** World frame the event happened on. */
  f: number;
}

/**
 * Everything the sim reports. Plain JSON-safe objects, discriminated by `t`.
 * This is the public contract: VFX, audio, HUD, logs, replays, the network and
 * AI observers all consume exactly this.
 */
export type GameEvent =
  | (Base & { t: 'ROUND_START' })
  | (Base & { t: 'ROUND_GO' })
  | (Base & { t: 'STATE'; id: FighterId; from: StateId; to: StateId })
  | (Base & { t: 'SKILL'; id: FighterId; skill: string; tier: ImpactTier })
  | (Base & {
      t: 'HIT';
      atk: FighterId;
      def: FighterId;
      skill: string;
      tier: ImpactTier;
      damage: number;
      /** Point of impact in world space. */
      x: number;
      y: number;
      /** Direction the attack travelled (+1 right, -1 left). */
      dir: Facing;
      counter: boolean;
      side: HitSide;
      launch: boolean;
      combo: number;
      comboDamage: number;
      hitstop: number;
    })
  | (Base & {
      t: 'BLOCK';
      atk: FighterId;
      def: FighterId;
      skill: string;
      tier: ImpactTier;
      chip: number;
      x: number;
      y: number;
      dir: Facing;
      hitstop: number;
    })
  | (Base & {
      t: 'PARRY';
      atk: FighterId;
      def: FighterId;
      skill: string;
      tier: ImpactTier;
      x: number;
      y: number;
      dir: Facing;
      hitstop: number;
    })
  | (Base & { t: 'GUARD_BREAK'; id: FighterId; x: number; y: number })
  | (Base & { t: 'JUMP'; id: FighterId; x: number })
  | (Base & { t: 'LAND'; id: FighterId; x: number; power: number })
  | (Base & { t: 'DASH'; id: FighterId; x: number; dir: Facing })
  | (Base & { t: 'KNOCKDOWN'; id: FighterId; x: number })
  | (Base & { t: 'COMBO_END'; id: FighterId; hits: number; damage: number })
  | (Base & { t: 'KO'; id: FighterId; winner: FighterId | -1; x: number; y: number });

export type GameEventType = GameEvent['t'];
export type EventOf<T extends GameEventType> = Extract<GameEvent, { t: T }>;
