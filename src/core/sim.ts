/**
 * THE SIMULATION. Pure logic: no DOM, no clocks, no randomness, no trig.
 * step(world, inputs) advances the game by exactly 1 F and returns what happened.
 *
 * Per-frame order (see docs/combat-model.md):
 *   1. read inputs (edge detect + buffer)         6. face opponents
 *   2. hitstop freeze? -> stop here               7. collect + resolve hits
 *   3. guard regen                                8. tick buffers/cooldowns
 *   4. decide (commands, cancels)                 9. KO phase bookkeeping
 *   5. integrate (physics, timers, exits), push apart, bounds
 */
import { BODY_SCALE, HURT, PHYSICS, RULES, STAGE } from '../content/config.ts';
import { BLOCK_HITSTOP_RATIO, bumpTier, IMPACT } from '../content/impacts.ts';
import type { ImpactTier } from '../content/impacts.ts';
import { BUTTON_INDEX, SKILLS, skillTotal } from '../content/skills.ts';
import { STATES } from '../content/states.ts';
import type { StateId } from '../content/states.ts';
import type { RelDir, SkillButton, SkillDef } from '../content/types.ts';
import { ACTION_BITS, ACTIONS, Btn, has } from './input.ts';
import type { InputFrame } from './input.ts';
import type { Facing, Fighter, FighterId, GameEvent, HitSide, Rect, World } from './types.ts';

type Source = 'command' | 'reaction' | 'natural' | 'forced';

/**
 * Bumps whenever a change to the rules would make an old recording play out differently.
 * Stored recordings carry it, and the ones from an older version are thrown away rather than
 * replayed wrongly. (2 = the fair get-up rule.)
 */
export const SIM_VERSION = 2;

// ───────────────────────────── construction ─────────────────────────────

export function createFighter(id: FighterId, maxHp: number = RULES.maxHp * RULES.defaultHpScale): Fighter {
  const side = id === 0 ? -1 : 1;
  return {
    id,
    x: side * STAGE.startOffset,
    y: 0,
    vx: 0,
    vy: 0,
    facing: (id === 0 ? 1 : -1) as Facing,
    hp: maxHp,
    maxHp,
    guard: RULES.maxGuard,
    energy: 0,
    guardDelay: 0,
    state: 'idle',
    stateF: 0,
    stateDur: Infinity,
    skill: null,
    skillHit: false,
    skillBlocked: false,
    hitCount: 0,
    lastHitF: -999,
    dashDir: 1,
    dashEnding: false,
    guardFresh: false,
    koBounced: false,
    held: false,
    combo: 0,
    comboDamage: 0,
    input: 0,
    buffer: { light: 0, heavy: 0, skill: 0, guard: 0, dash: 0, jump: 0 },
    cooldown: {},
  };
}

export function createWorld(opts: { hpScale?: number } = {}): World {
  const hpScale = opts.hpScale ?? RULES.defaultHpScale;
  const maxHp = Math.round(RULES.maxHp * hpScale);
  return {
    frame: 0,
    fighters: [createFighter(0, maxHp), createFighter(1, maxHp)],
    hitstop: 0,
    phase: 'intro',
    phaseF: 0,
    winner: null,
    score: [0, 0],
    hpScale,
  };
}

/** Start a fresh round. Score persists. */
export function resetRound(w: World): void {
  const maxHp = Math.round(RULES.maxHp * w.hpScale);
  w.fighters = [createFighter(0, maxHp), createFighter(1, maxHp)];
  w.hitstop = 0;
  w.phase = 'intro';
  w.phaseF = 0;
  w.winner = null;
}

// ───────────────────────────── queries ─────────────────────────────

export const isAir = (f: Fighter): boolean => STATES[f.state].air;

/** Which side of `b` is `a` on? -1 = left, +1 = right. */
export const sideOf = (a: Fighter, b: Fighter): Facing => (a.x < b.x ? -1 : 1);

/** Held direction relative to which way the fighter faces. */
export function relativeDir(f: Fighter): RelDir {
  if (has(f.input, Btn.DOWN)) return 'down';
  const left = has(f.input, Btn.LEFT);
  const right = has(f.input, Btn.RIGHT);
  if (left === right) return 'neutral';
  return (right ? 1 : -1) === f.facing ? 'forward' : 'back';
}

export const opponentOf = (w: World, f: Fighter): Fighter => w.fighters[f.id === 0 ? 1 : 0];

function phaseAt(sk: SkillDef, k: number): 'startup' | 'active' | 'recovery' {
  if (k < sk.startup) return 'startup';
  if (k < sk.startup + sk.active) return 'active';
  return 'recovery';
}

/**
 * Which phase of its skill an attacker is in, or null if not attacking.
 * Read between steps: stateF counts frames already simulated, so the NEXT frame to run is index stateF.
 */
export function skillPhase(f: Fighter): 'startup' | 'active' | 'recovery' | null {
  if (f.state !== 'attack' || !f.skill) return null;
  return phaseAt(SKILLS[f.skill], f.stateF);
}

/** Index of the frame that was just simulated (0 = the first frame of the state). */
const justRan = (f: Fighter): number => f.stateF - 1;

/** Is this fighter untouchable on the frame that was just simulated? */
export function isInvulnerable(f: Fighter): boolean {
  if (STATES[f.state].invulnerable) return true;
  const k = justRan(f);
  if (f.state === 'attack' && f.skill) {
    const range = SKILLS[f.skill].invulnerable;
    if (range && k >= range[0] && k < range[1]) return true;
  }
  if (f.state === 'dash') {
    const back = f.dashDir !== f.facing;
    return k < (back ? PHYSICS.dash.backInvuln : PHYSICS.dash.invuln);
  }
  return false;
}

export function hurtRect(f: Fighter): Rect {
  let kind = STATES[f.state].hurt;
  if (f.state === 'guard' && has(f.input, Btn.DOWN)) kind = 'crouch';
  if (f.state === 'attack' && f.skill && SKILLS[f.skill].crouch) kind = 'crouch';
  const h = HURT[kind];
  const w = h.w * BODY_SCALE;
  const dy = h.dy * BODY_SCALE;
  return { x0: f.x - w / 2, x1: f.x + w / 2, y0: f.y + dy, y1: f.y + dy + h.h * BODY_SCALE };
}

/** Hitboxes in world space, mirrored by facing and scaled by BODY_SCALE. */
export function hitRects(f: Fighter, sk: SkillDef): Rect[] {
  const boxes = Array.isArray(sk.hitbox) ? sk.hitbox : [sk.hitbox];
  const S = BODY_SCALE;
  return boxes.map((b) =>
    f.facing === 1
      ? { x0: f.x + b.x * S, x1: f.x + (b.x + b.w) * S, y0: f.y + b.y * S, y1: f.y + (b.y + b.h) * S }
      : { x0: f.x - (b.x + b.w) * S, x1: f.x - b.x * S, y0: f.y + b.y * S, y1: f.y + (b.y + b.h) * S },
  );
}

const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

// ───────────────────────────── transitions ─────────────────────────────

/**
 * The ONE place states change. `source` decides which rule applies:
 *   command  caller already checked actionable/cancel rules
 *   reaction a hit forces this; refused if invulnerable, or if it would downgrade
 *            a stronger reaction (priority)
 *   natural  a timer ran out, always allowed
 *   forced   KO etc, always allowed
 */
function transition(w: World, f: Fighter, to: StateId, source: Source, ev: GameEvent[], dur = Infinity): boolean {
  if (f.state === 'ko' && source !== 'forced') return false;
  const from = STATES[f.state];
  const dest = STATES[to];
  if (source === 'reaction') {
    if (from.invulnerable) return false;
    if (from.reaction && dest.priority < from.priority) return false;
  }
  if (f.state === 'guard' && source === 'command') f.cooldown.guard = RULES.guardLock;
  const prev = f.state;
  f.state = to;
  f.stateF = 0;
  f.stateDur = dur;
  if (to !== 'attack') f.skill = null;
  if (!dest.reaction && f.combo > 0) {
    if (f.combo > 1) ev.push({ t: 'COMBO_END', f: w.frame, id: f.id, hits: f.combo, damage: f.comboDamage });
    f.combo = 0;
    f.comboDamage = 0;
  }
  ev.push({ t: 'STATE', f: w.frame, id: f.id, from: prev, to });
  return true;
}

// ───────────────────────────── step ─────────────────────────────

export function step(w: World, inputs: readonly [InputFrame, InputFrame]): GameEvent[] {
  const ev: GameEvent[] = [];
  w.frame++;
  const live = w.phase === 'fight';
  const eff = live ? applyFairGetup(w, inputs) : ([0, 0] as [InputFrame, InputFrame]);
  for (const f of w.fighters) readInput(f, eff[f.id]);

  if (w.hitstop > 0) {
    w.hitstop--;
    return ev;
  }

  if (w.phase === 'intro') {
    if (w.phaseF === 0) ev.push({ t: 'ROUND_START', f: w.frame });
    w.phaseF++;
    if (w.phaseF >= RULES.introF) {
      w.phase = 'fight';
      w.phaseF = 0;
      ev.push({ t: 'ROUND_GO', f: w.frame });
    }
    for (const f of w.fighters) integrate(w, f, ev);
    return ev;
  }

  const [a, b] = w.fighters;
  for (const f of w.fighters) regenGuard(f);
  for (const f of w.fighters) decide(w, f, opponentOf(w, f), ev);
  for (const f of w.fighters) integrate(w, f, ev);
  pushApart(a, b);
  enforceBounds(a, b);
  enforceBounds(b, a);
  for (const f of w.fighters) faceOpponent(f, opponentOf(w, f));
  if (w.phase === 'fight') resolveHits(w, ev);
  for (const f of w.fighters) tickTimers(f);

  if (w.phase === 'ko') {
    w.phaseF++;
    if (w.phaseF >= RULES.koResetF) resetRound(w);
  }
  return ev;
}

// ───────────────────────────── input ─────────────────────────────

const isDown = (f: Fighter): boolean => f.state === 'knockdown' || f.state === 'getup';

/**
 * The fair get-up rule. If one fighter is down and the other is free (not being hit, not down
 * too), the free one is HELD: whatever they press is ignored, buffered presses are dropped, and
 * a back-step is pressed for them until they are at least standoffDistance away. They wait there
 * until the opponent is up. Returns the inputs the sim should actually use.
 */
function applyFairGetup(w: World, inputs: readonly [InputFrame, InputFrame]): [InputFrame, InputFrame] {
  const out: [InputFrame, InputFrame] = [inputs[0], inputs[1]];
  for (const f of w.fighters) {
    const opp = opponentOf(w, f);
    const held = RULES.fairGetup && isDown(opp) && !isDown(f) && !STATES[f.state].reaction;
    f.held = held;
    if (!held) continue;
    for (const a of ACTIONS) f.buffer[a] = 0;
    const gap = Math.abs(opp.x - f.x);
    const cornered = Math.abs(f.x) >= STAGE.halfWidth - 6;
    out[f.id] = gap < RULES.standoffDistance && !cornered && !STATES[f.state].air ? (f.facing === 1 ? Btn.LEFT : Btn.RIGHT) : 0;
  }
  return out;
}

function readInput(f: Fighter, input: InputFrame): void {
  const pressed = input & ~f.input;
  f.input = input;
  for (const a of ACTIONS) if (has(pressed, ACTION_BITS[a])) f.buffer[a] = RULES.inputBuffer;
}

function tickTimers(f: Fighter): void {
  for (const a of ACTIONS) if (f.buffer[a] > 0) f.buffer[a]--;
  for (const key of Object.keys(f.cooldown)) if (f.cooldown[key] > 0) f.cooldown[key]--;
}

function regenGuard(f: Fighter): void {
  if (f.guardDelay > 0) {
    f.guardDelay--;
    return;
  }
  if (f.state === 'guard' || f.state === 'blockstun') return;
  if (f.guard < RULES.maxGuard) f.guard = Math.min(RULES.maxGuard, f.guard + RULES.guardRegen);
}

// ───────────────────────────── commands ─────────────────────────────

function turnToward(f: Fighter, opp: Fighter): void {
  const dx = opp.x - f.x;
  if (Math.abs(dx) > 4) f.facing = dx > 0 ? 1 : -1;
}

/** Automatic facing: only while grounded and not mid-attack. */
function faceOpponent(f: Fighter, opp: Fighter): void {
  const st = STATES[f.state];
  let allowed = (st.actionable && !st.air) || f.state === 'blockstun' || f.state === 'land' || f.state === 'dash';
  // Holding guard keeps your stance: only an airborne opponent (a cross-up) can get behind you.
  if (f.state === 'guard' || f.state === 'blockstun') allowed = allowed && opp.y <= 0;
  if (allowed) turnToward(f, opp);
}

/** Pick the best skill for a pressed button given held direction and air/ground. */
function matchSkill(f: Fighter, button: SkillButton, air: boolean, pool: readonly string[] | null): string | null {
  const dir = relativeDir(f);
  let best: string | null = null;
  let bestScore = -1;
  for (const id of pool ?? BUTTON_INDEX[button]) {
    const sk = SKILLS[id];
    if (!sk || sk.input.button !== button) continue;
    if (!pool && sk.chainOnly) continue;
    if (!!sk.input.air !== air) continue;
    if ((sk.cost ?? 0) > f.energy) continue;
    if ((f.cooldown[id] ?? 0) > 0) continue;
    const want = sk.input.dir ?? 'any';
    if (want !== 'any' && want !== dir) continue;
    const score = want === 'any' ? 1 : 2;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/** Buttons checked for skills, strongest first. */
const SKILL_BUTTON_ORDER: SkillButton[] = ['skill', 'heavy', 'light'];

function startSkill(w: World, f: Fighter, opp: Fighter, id: string, ev: GameEvent[]): void {
  const sk = SKILLS[id];
  if (!isAir(f)) turnToward(f, opp);
  transition(w, f, 'attack', 'command', ev, skillTotal(sk));
  f.skill = id;
  f.skillHit = false;
  f.skillBlocked = false;
  f.hitCount = 0;
  f.lastHitF = -999;
  f.cooldown[id] = sk.cooldown ?? 0;
  f.energy -= sk.cost ?? 0;
  f.buffer[sk.input.button] = 0;
  ev.push({ t: 'SKILL', f: w.frame, id: f.id, skill: id, tier: sk.impact });
}

function startDash(w: World, f: Fighter, ev: GameEvent[]): void {
  const backHeld = relativeDir(f) === 'back';
  f.dashDir = (backHeld ? -f.facing : f.facing) as Facing;
  // Open-ended: integrate() runs the dash until the button is released, the opponent is reached,
  // or the wall is hit, then brakes.
  transition(w, f, 'dash', 'command', ev);
  f.dashEnding = false;
  f.vx = 0;
  f.cooldown.dash = PHYSICS.dash.cooldown;
  f.buffer.dash = 0;
  ev.push({ t: 'DASH', f: w.frame, id: f.id, x: f.x, dir: f.dashDir });
}

function startJump(w: World, f: Fighter, ev: GameEvent[]): void {
  const dx = (has(f.input, Btn.RIGHT) ? 1 : 0) - (has(f.input, Btn.LEFT) ? 1 : 0);
  transition(w, f, 'jump', 'command', ev);
  f.vy = PHYSICS.jumpVy;
  f.vx = dx * PHYSICS.jumpVx;
  f.buffer.jump = 0;
  ev.push({ t: 'JUMP', f: w.frame, id: f.id, x: f.x });
}

interface Candidate {
  priority: number;
  run: () => void;
}

function decide(w: World, f: Fighter, opp: Fighter, ev: GameEvent[]): void {
  if (w.phase !== 'fight') return;
  if (f.state === 'attack') {
    tryCancel(w, f, opp, ev);
    return;
  }
  const st = STATES[f.state];
  // A running dash can be cancelled into an attack (dash-in jab), and only into an attack.
  const dashCancel = f.state === 'dash' && f.stateF >= PHYSICS.dash.cancelAfter;
  if (!st.actionable && !dashCancel) return;

  const cands: Candidate[] = [];
  for (const button of SKILL_BUTTON_ORDER) {
    if (f.buffer[button] <= 0) continue;
    const id = matchSkill(f, button, st.air, null);
    if (id) {
      cands.push({ priority: STATES.attack.priority, run: () => startSkill(w, f, opp, id, ev) });
      break;
    }
  }
  if (!st.air && st.actionable) {
    if (f.buffer.dash > 0 && (f.cooldown.dash ?? 0) <= 0) {
      cands.push({ priority: STATES.dash.priority, run: () => startDash(w, f, ev) });
    }
    if (f.buffer.jump > 0) cands.push({ priority: STATES.jump.priority, run: () => startJump(w, f, ev) });
    if (has(f.input, Btn.GUARD) && (f.cooldown.guard ?? 0) <= 0) {
      cands.push({
        priority: STATES.guard.priority,
        run: () => {
          if (f.state !== 'guard') {
            transition(w, f, 'guard', 'command', ev);
            f.guardFresh = true;
          }
        },
      });
    } else if (has(f.input, Btn.DOWN)) {
      cands.push({ priority: STATES.crouch.priority, run: () => setLocomotion(w, f, 'crouch', ev) });
    } else if (has(f.input, Btn.LEFT) !== has(f.input, Btn.RIGHT)) {
      cands.push({
        priority: STATES.walk.priority,
        run: () => {
          setLocomotion(w, f, 'walk', ev);
          const dirX = has(f.input, Btn.RIGHT) ? 1 : -1;
          f.vx = dirX * (dirX === f.facing ? PHYSICS.walkSpeed : PHYSICS.walkBackSpeed);
        },
      });
    } else {
      cands.push({ priority: STATES.idle.priority, run: () => setLocomotion(w, f, 'idle', ev) });
    }
  }
  let best: Candidate | null = null;
  for (const c of cands) if (!best || c.priority > best.priority) best = c;
  best?.run();
}

function setLocomotion(w: World, f: Fighter, to: 'idle' | 'walk' | 'crouch', ev: GameEvent[]): void {
  if (f.state !== to) transition(w, f, to, 'command', ev);
}

/** While attacking: may a buffered press cancel into something else right now? */
function tryCancel(w: World, f: Fighter, opp: Fighter, ev: GameEvent[]): void {
  const sk = SKILLS[f.skill!];
  const total = skillTotal(sk);
  const air = f.y > 0;
  for (const rule of sk.cancels ?? []) {
    const from = rule.from ?? sk.startup;
    const to = rule.to ?? total - 1;
    if (f.stateF < from || f.stateF > to) continue;
    if (rule.on === 'hit' && !f.skillHit) continue;
    if (rule.on === 'contact' && !f.skillHit && !f.skillBlocked) continue;
    for (const target of rule.into) {
      if (target === 'dash') {
        if (f.buffer.dash > 0 && (f.cooldown.dash ?? 0) <= 0 && !air) return startDash(w, f, ev);
        continue;
      }
      if (target === 'jump') {
        if (f.buffer.jump > 0 && !air) return startJump(w, f, ev);
        continue;
      }
      const into = SKILLS[target];
      if (!into || f.buffer[into.input.button] <= 0) continue;
      const id = matchSkill(f, into.input.button, air, [target]);
      if (id) return startSkill(w, f, opp, id, ev);
    }
  }
}

// ───────────────────────────── physics + timers ─────────────────────────────

/** Gravity + movement. Returns the downward speed on the frame the fighter touches ground, else 0. */
function move(f: Fighter): number {
  let landSpeed = 0;
  if (f.y > 0 || f.vy > 0) {
    f.vy -= PHYSICS.gravity;
    f.y += f.vy;
    if (f.y <= 0) {
      f.y = 0;
      landSpeed = -f.vy;
      f.vy = 0;
    }
  }
  f.x += f.vx;
  return landSpeed;
}

const landPower = (speed: number): number => Math.min(1, speed / 20);

/**
 * A dash runs while the button is held: ease up to cruising speed, hold it, and brake when the
 * button is released, the opponent is within stopDistance, or the wall is reached. A tap still
 * runs minFrames. A back-dash is a fixed hop.
 */
function integrateDash(w: World, f: Fighter): void {
  const D = PHYSICS.dash;
  const back = f.dashDir !== f.facing;
  const opp = opponentOf(w, f);
  if (!f.dashEnding) {
    const arrived = !back && (opp.x - f.x) * f.dashDir > 0 && Math.abs(opp.x - f.x) <= D.stopDistance;
    const atWall = Math.abs(f.x) >= STAGE.halfWidth - 2;
    const done = back
      ? f.stateF >= D.backFrames
      : f.stateF >= D.minFrames && (!has(f.input, Btn.DASH) || arrived);
    if (done || atWall) f.dashEnding = true;
  }
  if (f.dashEnding) {
    f.vx *= D.brake;
    if (Math.abs(f.vx) < 1.2) f.stateDur = f.stateF + 1; // exits after this frame
  } else {
    const top = back ? D.backSpeed : D.speed;
    f.vx = f.dashDir * top * Math.min(1, (f.stateF + 1) / D.accel);
  }
  move(f);
}

function integrate(w: World, f: Fighter, ev: GameEvent[]): void {
  switch (f.state) {
    case 'idle':
    case 'crouch':
    case 'guard':
    case 'land':
      f.vx *= PHYSICS.groundFriction;
      move(f);
      break;
    case 'walk':
      move(f);
      break;
    case 'jump': {
      const speed = move(f);
      if (speed > 0) {
        transition(w, f, 'idle', 'natural', ev);
        f.vx = 0;
        ev.push({ t: 'LAND', f: w.frame, id: f.id, x: f.x, power: landPower(speed) });
      }
      break;
    }
    case 'dash':
      integrateDash(w, f);
      break;
    case 'attack': {
      const sk = SKILLS[f.skill!];
      let override = false;
      for (const m of sk.motion ?? []) {
        if (f.stateF >= m.from && f.stateF < m.to) {
          f.vx = m.vx * f.facing;
          if (m.vy !== undefined) f.vy = m.vy;
          override = true;
        }
      }
      const wasAir = f.y > 0 || f.vy > 0;
      if (!override && !wasAir) f.vx *= PHYSICS.groundFriction;
      const speed = move(f);
      if (speed > 0 && wasAir) {
        transition(w, f, 'land', 'natural', ev, PHYSICS.airAttackLandF);
        ev.push({ t: 'LAND', f: w.frame, id: f.id, x: f.x, power: landPower(speed) });
      }
      break;
    }
    case 'blockstun':
    case 'hitstun':
      f.vx *= PHYSICS.stunFriction;
      move(f);
      break;
    case 'launched': {
      const speed = move(f);
      if (speed > 0) {
        f.vx *= 0.4;
        transition(w, f, 'knockdown', 'natural', ev, RULES.knockdownF);
        ev.push({ t: 'KNOCKDOWN', f: w.frame, id: f.id, x: f.x });
      }
      break;
    }
    case 'knockdown':
    case 'getup':
      f.vx *= 0.8;
      move(f);
      break;
    case 'ko': {
      const speed = move(f);
      if (speed > 0) {
        if (!f.koBounced && speed > 5) {
          f.koBounced = true;
          f.vy = speed * 0.35;
          f.vx *= 0.6;
          ev.push({ t: 'KNOCKDOWN', f: w.frame, id: f.id, x: f.x });
        } else {
          f.vx *= 0.5;
        }
      } else if (f.y <= 0) {
        f.vx *= 0.85;
      }
      break;
    }
  }
  f.stateF++;
  if (f.stateF >= f.stateDur) exitState(w, f, ev);
}

/** A timed state ran out. */
function exitState(w: World, f: Fighter, ev: GameEvent[]): void {
  switch (f.state) {
    case 'attack':
      transition(w, f, f.y > 0 ? 'jump' : 'idle', 'natural', ev);
      break;
    case 'blockstun':
      if (has(f.input, Btn.GUARD) && (f.cooldown.guard ?? 0) <= 0) {
        transition(w, f, 'guard', 'natural', ev);
        f.guardFresh = false;
      } else {
        transition(w, f, 'idle', 'natural', ev);
      }
      break;
    case 'knockdown':
      transition(w, f, 'getup', 'natural', ev, RULES.getupF);
      break;
    case 'dash':
    case 'land':
    case 'hitstun':
    case 'getup':
      transition(w, f, 'idle', 'natural', ev);
      break;
    default:
      f.stateDur = Infinity;
  }
}

function pushApart(a: Fighter, b: Fighter): void {
  if (STATES[a.state].hurt === 'down' || STATES[b.state].hurt === 'down') return;
  if (a.y > PHYSICS.pushMaxHeight * BODY_SCALE || b.y > PHYSICS.pushMaxHeight * BODY_SCALE) return;
  const dx = b.x - a.x;
  const gap = PHYSICS.pushSeparation * BODY_SCALE - Math.abs(dx);
  if (gap <= 0) return;
  const dir = dx === 0 ? (a.id === 0 ? 1 : -1) : dx > 0 ? 1 : -1;
  a.x -= (dir * gap) / 2;
  b.x += (dir * gap) / 2;
}

/** Keep a fighter on stage. A fighter pinned in the corner pushes the opponent back instead. */
function enforceBounds(f: Fighter, opp: Fighter): void {
  const lim = STAGE.halfWidth;
  const over = f.x > lim ? f.x - lim : f.x < -lim ? f.x + lim : 0;
  if (over === 0) return;
  f.x -= over;
  if (STATES[f.state].reaction && STATES[f.state].hurt !== 'down') {
    opp.x -= over;
    opp.x = Math.max(-lim, Math.min(lim, opp.x));
  }
}

// ───────────────────────────── hits ─────────────────────────────

interface Contact {
  atk: Fighter;
  def: Fighter;
  sk: SkillDef;
  skillId: string;
  counter: boolean;
  /** Where the hitbox and hurtbox overlap. */
  x: number;
  y: number;
}

function resolveHits(w: World, ev: GameEvent[]): void {
  // Collect first, apply after, so simultaneous hits (trades) are judged on the same snapshot.
  const contacts: Contact[] = [];
  for (const atk of w.fighters) {
    if (atk.state !== 'attack' || !atk.skill) continue;
    const sk = SKILLS[atk.skill];
    const k = justRan(atk);
    if (k < sk.startup || k >= sk.startup + sk.active) continue;
    if (atk.hitCount > 0 && !(sk.rehit && k - atk.lastHitF >= sk.rehit)) continue;
    const def = opponentOf(w, atk);
    if (isInvulnerable(def)) continue;
    const hurt = hurtRect(def);
    for (const r of hitRects(atk, sk)) {
      if (!overlaps(r, hurt)) continue;
      const defPhase = def.state === 'attack' && def.skill ? phaseAt(SKILLS[def.skill], justRan(def)) : null;
      contacts.push({
        atk,
        def,
        sk,
        skillId: atk.skill,
        counter: defPhase === 'startup' || defPhase === 'active',
        x: (Math.max(r.x0, hurt.x0) + Math.min(r.x1, hurt.x1)) / 2,
        y: (Math.max(r.y0, hurt.y0) + Math.min(r.y1, hurt.y1)) / 2,
      });
      break;
    }
  }
  for (const c of contacts) applyContact(w, c, ev);
}

function applyContact(w: World, c: Contact, ev: GameEvent[]): void {
  const { atk, def, sk } = c;
  const attackedFromFront = (atk.x - def.x) * def.facing >= 0;
  const guarding = def.state === 'guard' || def.state === 'blockstun';
  const crouchGuard = has(def.input, Btn.DOWN);
  const levelOk = sk.level === 'low' ? crouchGuard : sk.level === 'high' ? !crouchGuard : true;
  const canBlock = guarding && attackedFromFront && !sk.unblockable && !STATES[def.state].air;

  atk.hitCount++;
  atk.lastHitF = justRan(atk);

  if (canBlock && def.state === 'guard' && def.guardFresh && justRan(def) < RULES.parryWindow) {
    return parry(w, c, ev);
  }
  if (canBlock && levelOk) return block(w, c, ev);
  hit(w, c, attackedFromFront ? 'front' : 'back', ev);
}

const awayFrom = (def: Fighter, atk: Fighter): Facing => (def.x >= atk.x ? 1 : -1);

function parry(w: World, c: Contact, ev: GameEvent[]): void {
  const { atk, def, sk } = c;
  transition(w, atk, 'hitstun', 'forced', ev, RULES.parryStun);
  atk.vx = -awayFrom(def, atk) * 3;
  def.energy = Math.min(RULES.maxEnergy, def.energy + RULES.parryEnergy);
  w.hitstop = Math.max(w.hitstop, RULES.parryHitstop);
  ev.push({
    t: 'PARRY', f: w.frame, atk: atk.id, def: def.id, skill: c.skillId, tier: sk.impact,
    x: c.x, y: c.y, dir: atk.facing, hitstop: RULES.parryHitstop,
  });
}

function block(w: World, c: Contact, ev: GameEvent[]): void {
  const { atk, def, sk } = c;
  const away = awayFrom(def, atk);
  const chip = Math.max(0, Math.min(Math.round(sk.damage * RULES.chip), def.hp - 1));
  def.hp -= chip;
  def.guard -= sk.guardDamage;
  def.guardDelay = RULES.guardRegenDelay;
  def.guardFresh = false;
  atk.skillBlocked = true;
  atk.energy = Math.min(RULES.maxEnergy, atk.energy + RULES.blockEnergy);
  def.energy = Math.min(RULES.maxEnergy, def.energy + RULES.blockEnergy);

  let hitstop = Math.round(IMPACT[sk.impact].hitstop * BLOCK_HITSTOP_RATIO);
  if (def.guard <= 0) {
    def.guard = RULES.guardBreakRefill;
    transition(w, def, 'hitstun', 'reaction', ev, RULES.guardBreakStun);
    def.vx = away * sk.knockback * 0.5;
    hitstop = IMPACT.heavy.hitstop;
    ev.push({ t: 'GUARD_BREAK', f: w.frame, id: def.id, x: def.x, y: def.y + 100 });
  } else {
    transition(w, def, 'blockstun', 'reaction', ev, sk.blockstun);
    def.vx = away * (sk.blockKnockback ?? sk.knockback * 0.7);
  }
  w.hitstop = Math.max(w.hitstop, hitstop);
  ev.push({
    t: 'BLOCK', f: w.frame, atk: atk.id, def: def.id, skill: c.skillId, tier: sk.impact,
    chip, x: c.x, y: c.y, dir: atk.facing, hitstop,
  });
}

function hit(w: World, c: Contact, side: HitSide, ev: GameEvent[]): void {
  const { atk, def, sk, counter } = c;
  const away = awayFrom(def, atk);
  const wasInCombo = STATES[def.state].reaction;
  const scale = Math.max(RULES.comboMinScale, 1 - RULES.comboScaling * (wasInCombo ? def.combo : 0));
  const damage = Math.round(
    sk.damage * scale * (counter ? RULES.counterDamage : 1) * (side === 'back' ? RULES.backHitDamage : 1),
  );
  def.hp = Math.max(0, def.hp - damage);
  const ko = def.hp <= 0;

  let tier: ImpactTier = counter ? bumpTier(sk.impact) : sk.impact;
  if (ko) tier = 'crush';
  const hitstop = IMPACT[tier].hitstop;
  const launched = !!sk.launch || STATES[def.state].air;

  if (ko) {
    transition(w, def, 'ko', 'forced', ev);
    def.vx = away * (sk.launch?.vx ?? Math.max(sk.knockback, 6));
    def.vy = (sk.launch?.vy ?? 10) + 3;
    def.koBounced = false;
    w.phase = 'ko';
    w.phaseF = 0;
    if (w.winner !== null && w.winner !== atk.id) {
      if (w.winner !== -1) w.score[w.winner]--;
      w.winner = -1;
    } else {
      w.winner = atk.id;
      w.score[atk.id]++;
    }
  } else if (launched) {
    if (transition(w, def, 'launched', 'reaction', ev)) {
      def.vx = away * (sk.launch?.vx ?? sk.knockback);
      def.vy = sk.launch?.vy ?? RULES.airHitPop;
    }
  } else {
    const stun = sk.hitstun + (counter ? RULES.counterStunBonus : 0);
    if (transition(w, def, 'hitstun', 'reaction', ev, stun)) def.vx = away * sk.knockback;
  }

  def.combo = wasInCombo ? def.combo + 1 : 1;
  def.comboDamage = (wasInCombo ? def.comboDamage : 0) + damage;
  atk.skillHit = true;
  atk.energy = Math.min(RULES.maxEnergy, atk.energy + IMPACT[sk.impact].energy + (sk.energyGain ?? 0));
  def.energy = Math.min(RULES.maxEnergy, def.energy + damage * RULES.energyOnDamaged);
  w.hitstop = Math.max(w.hitstop, hitstop);

  ev.push({
    t: 'HIT', f: w.frame, atk: atk.id, def: def.id, skill: c.skillId, tier, damage,
    x: c.x, y: c.y, dir: atk.facing, counter, side, launch: launched,
    combo: def.combo, comboDamage: def.comboDamage, hitstop,
  });
  if (ko) ev.push({ t: 'KO', f: w.frame, id: def.id, winner: w.winner ?? -1, x: def.x, y: def.y + 70 });
}
