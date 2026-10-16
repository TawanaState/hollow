import { describe, expect, it } from 'vitest';
import { RULES } from '../src/content/config.ts';
import { SKILLS } from '../src/content/skills.ts';
import { assertValidContent, validateContent } from '../src/content/validate.ts';
import { Btn } from '../src/core/input.ts';
import type { InputFrame } from '../src/core/input.ts';
import { createWorld, step } from '../src/core/sim.ts';
import type { GameEvent, World } from '../src/core/types.ts';
import { Recorder, runReplay } from '../src/core/recorder.ts';

type In = [InputFrame, InputFrame];
const N = 0;

/** A world already past the intro with the fighters `gap` apart, centred on x=0. */
function fight(gap = 80): World {
  const w = createWorld();
  for (let i = 0; i < RULES.introF + 2; i++) step(w, [N, N]);
  expect(w.phase).toBe('fight');
  w.fighters[0].x = -gap / 2;
  w.fighters[1].x = gap / 2;
  return w;
}

/** Step `frames` times with constant inputs, collecting events. */
function run(w: World, frames: number, a: InputFrame = N, b: InputFrame = N): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < frames; i++) out.push(...step(w, [a, b]));
  return out;
}

/** Tap a button for one frame, then release. */
function tap(w: World, a: InputFrame, b: InputFrame = N): GameEvent[] {
  return [...run(w, 1, a, b)];
}

const ofType = <T extends GameEvent['t']>(events: GameEvent[], t: T) =>
  events.filter((e): e is Extract<GameEvent, { t: T }> => e.t === t);

describe('content', () => {
  it('is valid', () => {
    expect(validateContent()).toEqual([]);
    expect(() => assertValidContent()).not.toThrow();
  });
});

describe('hits', () => {
  it('a jab connects on its first active frame, freezes both, and does damage', () => {
    const w = fight();
    const events = [...tap(w, Btn.LIGHT)];
    const sk = SKILLS.jab;
    events.push(...run(w, sk.startup + 2));
    const hit = ofType(events, 'HIT')[0];
    expect(hit).toBeDefined();
    expect(hit.atk).toBe(0);
    expect(hit.damage).toBe(sk.damage);
    expect(hit.tier).toBe('light');
    expect(w.fighters[1].hp).toBe(w.fighters[1].maxHp - sk.damage);
    expect(w.fighters[1].state).toBe('hitstun');
    expect(w.hitstop).toBeGreaterThan(0);
  });

  it('startup frames are respected: nothing connects before the first active frame', () => {
    const w = fight();
    const events = [...tap(w, Btn.LIGHT)];
    events.push(...run(w, SKILLS.jab.startup - 1));
    expect(ofType(events, 'HIT')).toHaveLength(0);
  });

  it('hitstop freezes the sim but still buffers input', () => {
    const w = fight();
    tap(w, Btn.LIGHT);
    run(w, SKILLS.jab.startup + 1);
    expect(w.hitstop).toBeGreaterThan(0);
    const before = w.fighters[0].stateF;
    // press during hitstop
    step(w, [Btn.LIGHT, N]);
    expect(w.fighters[0].buffer.light).toBeGreaterThan(0);
    expect(w.fighters[0].stateF).toBe(before);
  });

  it('a hit out of range whiffs', () => {
    const w = fight(400);
    const events = [...tap(w, Btn.LIGHT), ...run(w, 20)];
    expect(ofType(events, 'HIT')).toHaveLength(0);
    expect(w.fighters[1].hp).toBe(w.fighters[1].maxHp);
  });
});

describe('dash', () => {
  const P = { stop: 84 };

  it('a tap is a short burst; holding keeps running until the opponent is reached, then brakes', () => {
    const tapped = fight(500);
    run(tapped, 1, Btn.DASH);
    run(tapped, 60);
    const tapDistance = tapped.fighters[0].x - -250;

    const held = fight(500);
    run(held, 60, Btn.DASH);
    const gap = held.fighters[1].x - held.fighters[0].x;
    expect(tapDistance).toBeGreaterThan(60);
    expect(held.fighters[0].x - -250).toBeGreaterThan(tapDistance + 120);
    // arrives near striking range, never through the opponent
    expect(gap).toBeGreaterThan(40);
    expect(gap).toBeLessThan(P.stop + 40);
    expect(held.fighters[0].state).not.toBe('dash');
  });

  it('can be cancelled into an attack after a few frames (dash-in jab)', () => {
    const w = fight(500);
    run(w, 1, Btn.DASH);
    run(w, 8, Btn.DASH);
    expect(w.fighters[0].state).toBe('dash');
    run(w, 1, Btn.DASH | Btn.LIGHT);
    expect(w.fighters[0].state).toBe('attack');
    expect(w.fighters[0].skill).toBe('jab');
  });

  it('a back-dash is a fixed hop that does not run away forever', () => {
    const w = fight(300);
    run(w, 1, Btn.LEFT | Btn.DASH);
    run(w, 40, Btn.DASH); // keep dash held, direction released
    expect(w.fighters[0].state).not.toBe('dash');
    const hop = -150 - w.fighters[0].x;
    expect(hop).toBeGreaterThan(60);
    expect(hop).toBeLessThan(220);
  });
});

describe('fair get-up', () => {
  /** P2 has just been knocked down; P1 is standing close by. */
  function knockedDown(): World {
    const w = fight(100);
    const f = w.fighters[1];
    f.state = 'knockdown';
    f.stateF = 0;
    f.stateDur = RULES.knockdownF;
    return w;
  }

  it('holds the standing fighter: no attacks, and they back away and wait', () => {
    const w = knockedDown();
    const events = run(w, 30, Btn.LIGHT | Btn.RIGHT); // mashing attack and forward
    expect(w.fighters[0].held).toBe(true);
    expect(w.fighters[0].state).not.toBe('attack');
    expect(ofType(events, 'SKILL')).toHaveLength(0);
    expect(Math.abs(w.fighters[1].x - w.fighters[0].x)).toBeGreaterThan(160); // stepped back
    run(w, 30);
    const gap = Math.abs(w.fighters[1].x - w.fighters[0].x);
    expect(gap).toBeGreaterThanOrEqual(RULES.standoffDistance - 12); // far enough, then it waits
    expect(gap).toBeLessThan(RULES.standoffDistance + 40);
  });

  it('gives control back the moment the opponent is on their feet, with the space kept', () => {
    const w = knockedDown();
    run(w, RULES.knockdownF + RULES.getupF + 6);
    expect(w.fighters[1].state).toBe('idle');
    run(w, 1, Btn.LIGHT);
    expect(w.fighters[0].held).toBe(false);
    expect(w.fighters[0].state).toBe('attack');
    expect(Math.abs(w.fighters[1].x - w.fighters[0].x)).toBeGreaterThan(200);
  });

  it('drops presses made just before, so nothing fires the instant they are held', () => {
    const w = fight(100);
    run(w, 1, Btn.HEAVY); // an attack is buffered...
    w.fighters[0].state = 'idle';
    w.fighters[0].stateF = 0;
    w.fighters[0].skill = null;
    w.fighters[1].state = 'getup';
    w.fighters[1].stateF = 0;
    w.fighters[1].stateDur = 20;
    const events = run(w, 10);
    expect(ofType(events, 'SKILL')).toHaveLength(0);
  });

  it('does not hold anyone while the opponent is merely being hit, launched, or both are down', () => {
    const w = fight(100);
    w.fighters[1].state = 'launched';
    w.fighters[1].y = 60;
    run(w, 1);
    expect(w.fighters[0].held).toBe(false);

    const both = knockedDown();
    both.fighters[0].state = 'knockdown';
    both.fighters[0].stateDur = 30;
    run(both, 1);
    expect(both.fighters[0].held).toBe(false);
    expect(both.fighters[1].held).toBe(false);
  });

  it('can be switched off', () => {
    const w = knockedDown();
    (RULES as { fairGetup: boolean }).fairGetup = false;
    try {
      const events = run(w, 6, Btn.LIGHT);
      expect(ofType(events, 'SKILL').length).toBeGreaterThan(0);
    } finally {
      (RULES as { fairGetup: boolean }).fairGetup = true;
    }
  });
});

describe('combos and cancels', () => {
  it('jab cancels into cross on contact and damage scales down', () => {
    const w = fight();
    const events: GameEvent[] = [];
    events.push(...tap(w, Btn.LIGHT));
    // keep tapping light every few frames to chain
    for (let i = 0; i < 40; i++) events.push(...tap(w, i % 6 === 0 ? Btn.LIGHT : N));
    const hits = ofType(events, 'HIT');
    expect(hits.map((h) => h.skill).slice(0, 2)).toEqual(['jab', 'cross']);
    expect(hits[1].combo).toBe(2);
    expect(hits[1].damage).toBeLessThan(SKILLS.cross.damage);
  });
});

describe('guarding', () => {
  it('blocking turns damage into chip and drains guard', () => {
    const w = fight();
    run(w, 12, N, Btn.GUARD); // raise guard well before the attack
    const guardBefore = w.fighters[1].guard;
    const events = [...run(w, 1, Btn.LIGHT, Btn.GUARD), ...run(w, 8, N, Btn.GUARD)];
    const block = ofType(events, 'BLOCK')[0];
    expect(block).toBeDefined();
    expect(ofType(events, 'HIT')).toHaveLength(0);
    expect(w.fighters[1].hp).toBeGreaterThan(w.fighters[1].maxHp - SKILLS.jab.damage);
    expect(w.fighters[1].guard).toBeLessThan(guardBefore);
    expect(w.fighters[1].state).toBe('blockstun');
  });

  it('pressing guard just before the hit parries it and stuns the attacker', () => {
    const w = fight();
    const events = [...run(w, 1, Btn.LIGHT, Btn.GUARD), ...run(w, 8, N, Btn.GUARD)];
    expect(ofType(events, 'PARRY')).toHaveLength(1);
    expect(w.fighters[0].state).toBe('hitstun');
    expect(w.fighters[1].hp).toBe(w.fighters[1].maxHp);
  });

  it('a low attack beats standing guard, but is blocked crouching', () => {
    const standing = fight();
    run(standing, 12, N, Btn.GUARD);
    const e1 = [...run(standing, 1, Btn.HEAVY | Btn.DOWN, Btn.GUARD), ...run(standing, 14, N, Btn.GUARD)];
    expect(ofType(e1, 'HIT')).toHaveLength(1);

    const crouching = fight();
    run(crouching, 12, N, Btn.GUARD | Btn.DOWN);
    const e2 = [...run(crouching, 1, Btn.HEAVY | Btn.DOWN, Btn.GUARD | Btn.DOWN), ...run(crouching, 14, N, Btn.GUARD | Btn.DOWN)];
    expect(ofType(e2, 'BLOCK')).toHaveLength(1);
    expect(ofType(e2, 'HIT')).toHaveLength(0);
  });
});

describe('direction', () => {
  it('fighters face each other and flip when the opponent crosses over', () => {
    const w = fight();
    expect(w.fighters[0].facing).toBe(1);
    expect(w.fighters[1].facing).toBe(-1);
    w.fighters[0].x = 100;
    w.fighters[1].x = -100;
    run(w, 2);
    expect(w.fighters[0].facing).toBe(-1);
    expect(w.fighters[1].facing).toBe(1);
  });

  it('forward and back inputs are relative to facing', () => {
    const w = fight(400);
    run(w, 10, Btn.RIGHT, Btn.RIGHT); // P1 walks forward, P2 walks back (away from P1)
    expect(w.fighters[0].x).toBeGreaterThan(-200);
    expect(w.fighters[1].x).toBeGreaterThan(200);
    expect(w.fighters[1].x - 200).toBeLessThan(w.fighters[0].x + 200 + 80);
    // forward speed beats backward speed
    expect(Math.abs(w.fighters[0].x - -200)).toBeGreaterThan(Math.abs(w.fighters[1].x - 200));
  });

  it('a cross-up (airborne attacker landing behind a guarding defender) cannot be blocked and does bonus damage', () => {
    const w = fight();
    run(w, 12, N, Btn.GUARD);
    const atk = w.fighters[0];
    const def = w.fighters[1];
    // Attacker is airborne on the defender's back side. Defenders do not turn for airborne opponents.
    atk.state = 'jump';
    atk.y = 60;
    atk.vy = 0;
    atk.x = 40;
    atk.facing = -1;
    def.x = -40;
    const events = [...run(w, 1, Btn.LIGHT, Btn.GUARD), ...run(w, 10, N, Btn.GUARD)];
    const hit = ofType(events, 'HIT')[0];
    expect(hit).toBeDefined();
    expect(hit.side).toBe('back');
    expect(hit.damage).toBe(Math.round(SKILLS.airKick.damage * RULES.backHitDamage));
    expect(def.facing).toBe(-1);
  });
});

describe('state priority', () => {
  it('a weaker reaction cannot pull a launched fighter out of the air', () => {
    const w = fight();
    const f = w.fighters[1];
    f.state = 'launched';
    f.y = 80;
    f.vy = 0;
    f.stateDur = Infinity;
    const atk = w.fighters[0];
    atk.x = f.x - 60;
    // Place a jab in its active frame directly
    run(w, 1, Btn.LIGHT);
    run(w, SKILLS.jab.startup);
    expect(['launched', 'knockdown']).toContain(f.state);
  });

  it('being hit interrupts the attacker\'s own attack (reaction beats command)', () => {
    const w = fight();
    // P2 starts a slow heavy; P1 jabs first and lands during P2's startup
    run(w, 1, N, Btn.HEAVY);
    run(w, 1, Btn.LIGHT, N);
    const events = run(w, 10);
    expect(ofType(events, 'HIT').some((h) => h.def === 1 && h.counter)).toBe(true);
    expect(w.fighters[1].skill).toBeNull();
  });

  it('knocked-down fighters are invulnerable', () => {
    const w = fight();
    w.fighters[1].state = 'knockdown';
    w.fighters[1].stateDur = 30;
    const events = [...run(w, 1, Btn.LIGHT), ...run(w, 10)];
    expect(ofType(events, 'HIT')).toHaveLength(0);
  });
});

describe('KO and rounds', () => {
  it('KO ends the round, awards the score, and the world resets afterwards', () => {
    const w = fight();
    w.fighters[1].hp = 10;
    const events = [...run(w, 1, Btn.LIGHT), ...run(w, 10)];
    expect(ofType(events, 'KO')[0]).toMatchObject({ id: 1, winner: 0 });
    expect(w.phase).toBe('ko');
    expect(w.score).toEqual([1, 0]);
    run(w, RULES.koResetF + 40); // + the KO hitstop
    expect(w.phase).not.toBe('ko');
    expect(w.fighters[1].hp).toBe(w.fighters[1].maxHp);
    expect(w.score).toEqual([1, 0]);
  });
});

describe('determinism', () => {
  it('the same inputs always give the same world, and a replay reproduces it', () => {
    const script = (f: number): In => [
      [Btn.RIGHT, Btn.LIGHT, N, Btn.LIGHT | Btn.RIGHT, Btn.GUARD, Btn.UP, Btn.HEAVY][f % 7],
      [Btn.LEFT, N, Btn.DASH, Btn.GUARD, Btn.LIGHT, Btn.DOWN | Btn.HEAVY, N][(f * 3) % 7],
    ];
    const rec = new Recorder();
    const a = createWorld();
    for (let f = 0; f < 1500; f++) {
      const inp = script(f);
      rec.record(inp, step(a, inp));
    }
    const b = runReplay(rec.toReplay()).world;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.fighters[0].hp + a.fighters[1].hp).toBeLessThan(a.fighters[0].maxHp + a.fighters[1].maxHp); // something actually happened
  });
});
