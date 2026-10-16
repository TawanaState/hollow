/**
 * FIGHTER STATES: what a fighter can be doing, and what may override what.
 *
 * priority     Tie-breaker. Used (a) to pick between several valid commands in one
 *              frame (higher wins) and (b) so a weaker reaction can never downgrade
 *              a stronger one (a jab cannot pull you out of 'launched').
 * actionable   The player may start commands (attacks, jump, dash, guard...) from here.
 * air          Airborne state (affects which skills are legal and hurtbox/physics).
 * reaction     A state forced on you by the opponent. Combo tracking lives across these.
 * invulnerable Cannot be hit at all.
 * hurt         Which hurtbox shape applies (see config.HURT).
 */
export type StateId =
  | 'idle'
  | 'walk'
  | 'crouch'
  | 'guard'
  | 'jump'
  | 'land'
  | 'dash'
  | 'attack'
  | 'blockstun'
  | 'hitstun'
  | 'launched'
  | 'knockdown'
  | 'getup'
  | 'ko';

export type HurtKind = 'stand' | 'crouch' | 'air' | 'down';

export interface StateDef {
  priority: number;
  actionable: boolean;
  air: boolean;
  reaction: boolean;
  invulnerable: boolean;
  hurt: HurtKind;
}

const S = (
  priority: number,
  hurt: HurtKind,
  o: Partial<Omit<StateDef, 'priority' | 'hurt'>> = {},
): StateDef => ({
  priority,
  hurt,
  actionable: false,
  air: false,
  reaction: false,
  invulnerable: false,
  ...o,
});

export const STATES: Record<StateId, StateDef> = {
  idle: S(0, 'stand', { actionable: true }),
  walk: S(1, 'stand', { actionable: true }),
  crouch: S(1, 'crouch', { actionable: true }),
  guard: S(2, 'stand', { actionable: true }),
  jump: S(3, 'air', { actionable: true, air: true }),
  land: S(3, 'stand'),
  dash: S(5, 'stand'),
  attack: S(10, 'stand'),
  blockstun: S(28, 'stand', { reaction: true }),
  hitstun: S(30, 'stand', { reaction: true }),
  launched: S(35, 'air', { reaction: true, air: true }),
  knockdown: S(40, 'down', { reaction: true, invulnerable: true }),
  getup: S(41, 'down', { reaction: true, invulnerable: true }),
  ko: S(100, 'down', { reaction: true, invulnerable: true }),
};
