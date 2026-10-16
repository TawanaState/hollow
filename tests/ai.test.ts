import { describe, expect, it } from 'vitest';
import { AI } from '../src/content/ai.ts';
import { Agent } from '../src/ai/agent.ts';
import { BUTTON, BUTTONS, FULL_MASK, MOVE, N_OUT, actionToBits, bitsToAction, buttonMask, legalMask, moveMask } from '../src/ai/actions.ts';
import { duel, playMatch } from '../src/ai/arena.ts';
import { Dataset } from '../src/ai/dataset.ts';
import { OBS_DIM, Tracker, encode, schemaHash } from '../src/ai/features.ts';
import { Guardrails } from '../src/ai/guardrails.ts';
import { balanceWeights, extractHumanSamples, train } from '../src/ai/learn.ts';
import { Mlp } from '../src/ai/nn.ts';
import { IdlePolicy, NetPolicy, RandomPolicy, sensibleRandom } from '../src/ai/policy.ts';
import { packInputs, unpackInputs } from '../src/ai/replayPack.ts';
import { TEACHERS, TeacherPolicy } from '../src/ai/teachers.ts';
import { Btn } from '../src/core/input.ts';
import { createRng } from '../src/core/rng.ts';
import { createWorld, step } from '../src/core/sim.ts';
import type { Policy } from '../src/ai/policy.ts';
import type { World } from '../src/core/types.ts';

function fightWorld(): World {
  const w = createWorld();
  while (w.phase !== 'fight') step(w, [0, 0]);
  return w;
}

describe('network', () => {
  it('backprop matches numerical gradients', () => {
    const rng = createRng(3);
    const net = new Mlp([6, 7, 5, 4], rng);
    // give the biases something to do
    for (const b of net.b) for (let i = 0; i < b.length; i++) b[i] = (rng.next() - 0.5) * 0.3;
    const batch = 3;
    const x = Float32Array.from({ length: batch * 6 }, () => rng.next() * 2 - 1);
    const target = Float32Array.from({ length: batch * 4 }, () => rng.next());
    const loss = (): number => {
      const out = net.forward(x, batch);
      let s = 0;
      for (let i = 0; i < out.length; i++) s += 0.5 * (out[i] - target[i]) ** 2;
      return s;
    };
    const out = net.forward(x, batch);
    const d = new Float32Array(out.length);
    for (let i = 0; i < d.length; i++) d[i] = out[i] - target[i];
    net.zeroGrad();
    net.backward(d, batch);
    const grads = (net as unknown as { gW: Float32Array[] }).gW.map((g) => g.slice());
    const eps = 1e-3;
    let worst = 0;
    for (let l = 0; l < net.W.length; l++) {
      for (let i = 0; i < net.W[l].length; i += 3) {
        const keep = net.W[l][i];
        net.W[l][i] = keep + eps;
        const up = loss();
        net.W[l][i] = keep - eps;
        const down = loss();
        net.W[l][i] = keep;
        const numeric = (up - down) / (2 * eps);
        worst = Math.max(worst, Math.abs(numeric - grads[l][i]) / (Math.abs(numeric) + Math.abs(grads[l][i]) + 1e-3));
      }
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('saves and loads without changing a single output', () => {
    const net = new Mlp([OBS_DIM, 32, N_OUT], createRng(5));
    const x = Float32Array.from({ length: OBS_DIM }, (_, i) => Math.sin(i));
    const before = Array.from(net.forward(x, 1));
    const back = Mlp.fromBuffer(net.toBuffer());
    expect(Array.from(back.forward(x, 1))).toEqual(before);
  });

  it('learns a simple mapping', () => {
    const rng = createRng(11);
    const ds = new Dataset(500);
    const net = new Mlp([OBS_DIM, 32, N_OUT], rng);
    const obs = new Float32Array(OBS_DIM);
    for (let i = 0; i < 400; i++) {
      obs.fill(0);
      const bucket = rng.int(3);
      obs[0] = bucket; // the answer depends only on feature 0
      ds.add(obs, bucket === 0 ? MOVE.forward : bucket === 1 ? MOVE.back : MOVE.down, bucket === 2 ? BUTTON.light : BUTTON.none, FULL_MASK);
    }
    train(net, ds, { steps: 400, batch: 32, lr: 3e-3, rng });
    const stats = train(net, ds, { steps: 40, batch: 64, lr: 1e-4, rng }); // measure after learning
    expect(stats.moveAcc).toBeGreaterThan(0.9);
    expect(stats.buttonAcc).toBeGreaterThan(0.9);
  });
});

describe('what the AI sees', () => {
  it('has a fixed size, finite values, and is identical from either side of the screen', () => {
    const w = fightWorld();
    const [a, b] = w.fighters;
    a.x = -100;
    b.x = 160;
    b.state = 'attack';
    b.skill = 'jab';
    b.stateF = 2;
    const left = new Float32Array(OBS_DIM);
    expect(encode(a, b, new Tracker(), 0, left)).toBe(OBS_DIM);
    expect(left.every(Number.isFinite)).toBe(true);

    // the exact mirror image of the same situation
    const mirrorA = { ...a, x: -a.x, vx: -a.vx, facing: -a.facing as 1 | -1 };
    const mirrorB = { ...b, x: -b.x, vx: -b.vx, facing: -b.facing as 1 | -1 };
    const right = new Float32Array(OBS_DIM);
    encode(mirrorA, mirrorB, new Tracker(), 0, right);
    expect(Array.from(right)).toEqual(Array.from(left));
  });

  it('knows how far away the opponent is and which way they are', () => {
    const w = fightWorld();
    const [a, b] = w.fighters;
    const near = new Float32Array(OBS_DIM);
    const far = new Float32Array(OBS_DIM);
    a.x = 0;
    b.x = 90;
    encode(a, b, new Tracker(), 0, near);
    b.x = 600;
    encode(a, b, new Tracker(), 0, far);
    expect(near[0]).toBeLessThan(far[0]); // signed distance in front
    expect(near[3]).toBeLessThan(far[3]); // closeness
    b.x = -200; // now behind me
    const behind = new Float32Array(OBS_DIM);
    encode(a, b, new Tracker(), 0, behind);
    expect(behind[0]).toBeLessThan(0);
    expect(behind[4]).toBe(0); // not facing them
  });

  it('changes its fingerprint when the feature layout changes', () => {
    expect(schemaHash([OBS_DIM, 96, 64, N_OUT])).not.toBe(schemaHash([OBS_DIM, 64, 64, N_OUT]));
  });
});

describe('actions', () => {
  it('turns an action into presses and back again', () => {
    const rng = createRng(2);
    for (let i = 0; i < 200; i++) {
      const a = { move: rng.int(7), button: rng.int(6) };
      for (const facing of [1, -1] as const) {
        const frames = [0, 1, 2, 3].map((k) => actionToBits(a, facing, k));
        const back = bitsToAction(frames, 0, facing);
        expect(back).toEqual(a);
      }
    }
  });

  it('forward means toward the opponent on either side', () => {
    expect(actionToBits({ move: MOVE.forward, button: 0 }, 1, 0) & Btn.RIGHT).toBeTruthy();
    expect(actionToBits({ move: MOVE.forward, button: 0 }, -1, 0) & Btn.LEFT).toBeTruthy();
  });

  it('only offers what the game would not ignore', () => {
    const w = fightWorld();
    const f = w.fighters[0];
    expect(buttonMask(legalMask(f)) & (1 << BUTTON.skill)).toBe(0); // no energy
    f.energy = 80;
    expect(buttonMask(legalMask(f)) & (1 << BUTTON.skill)).not.toBe(0);
    f.state = 'hitstun';
    expect(moveMask(legalMask(f))).toBe(1);
    expect(buttonMask(legalMask(f))).toBe(1);
  });
});

describe('ground rules and randomness', () => {
  it('stop an action being repeated too many times in a row', () => {
    const w = fightWorld();
    const lights: Policy = { decide: () => ({ move: MOVE.neutral, button: BUTTON.light, value: 0 }) };
    const agent = new Agent({ slot: 0, getWorld: () => w, policy: lights, settings: { randomness: 0, reaction: 0 }, seed: 1 });
    const seen: number[] = [];
    agent.onDecision = (r) => seen.push(r.action.button);
    for (let i = 0; i < 400; i++) agent.poll();
    let streak = 0;
    let longest = 0;
    for (const b of seen) {
      streak = b === BUTTON.light ? streak + 1 : 0;
      longest = Math.max(longest, streak);
    }
    expect(longest).toBeLessThanOrEqual(6);
    expect(seen.some((b) => b !== BUTTON.light)).toBe(true);
    // and with the rules off it does spam
    const free = new Agent({ slot: 0, getWorld: () => w, policy: lights, settings: { randomness: 0, reaction: 0, guardrails: false }, seed: 1 });
    const seen2: number[] = [];
    free.onDecision = (r) => seen2.push(r.action.button);
    for (let i = 0; i < 100; i++) free.poll();
    expect(seen2.every((b) => b === BUTTON.light)).toBe(true);
  });

  it('the guardrail object only removes options and never leaves nothing', () => {
    const rails = new Guardrails();
    for (let i = 0; i < 40; i++) {
      const mask = rails.apply(FULL_MASK);
      expect(moveMask(mask)).not.toBe(0);
      expect(buttonMask(mask) & 1).toBe(1); // doing nothing is always possible
      rails.record({ move: MOVE.neutral, button: BUTTON.none });
    }
  });

  it('the Randomness dial replaces about that share of decisions', () => {
    const w = fightWorld();
    for (const p of [0, 0.25, 0.5, 1]) {
      const agent = new Agent({ slot: 0, getWorld: () => w, policy: new IdlePolicy(), settings: { randomness: p, reaction: 0 }, seed: 9 });
      for (let i = 0; i < 4 * 3000; i++) agent.poll();
      const share = agent.stats.random / agent.stats.decisions;
      expect(Math.abs(share - p)).toBeLessThan(0.05);
    }
  });

  it('random choices are legal ones', () => {
    const rng = createRng(4);
    const w = fightWorld();
    w.fighters[0].state = 'hitstun';
    const mask = legalMask(w.fighters[0]);
    for (let i = 0; i < 50; i++) expect(sensibleRandom(mask, rng)).toEqual({ move: MOVE.neutral, button: BUTTON.none });
    expect(BUTTONS.length).toBe(6);
  });
});

describe('data', () => {
  it('replays shrink and come back exactly', () => {
    const inputs: [number, number][] = [];
    for (let i = 0; i < 5000; i++) inputs.push([i % 97 < 60 ? Btn.RIGHT : Btn.LIGHT, i % 211 < 100 ? 0 : Btn.GUARD | Btn.DOWN]);
    const packed = packInputs(inputs);
    expect(packed.byteLength).toBeLessThan(inputs.length * 4);
    expect(unpackInputs(packed)).toEqual(inputs);
  });

  it('what is learned from a recording is exactly what the AI saw when it played', () => {
    const seats = [{ policy: new TeacherPolicy({ ...TEACHERS.ember, noise: 0 }), record: true }, { policy: new TeacherPolicy({ ...TEACHERS.stone, noise: 0 }) }] as const;
    const r = playMatch(seats, { seed: 21, keepInputs: true });
    const traj = r.traj[0]!;
    const ds = new Dataset(5000);
    const added = extractHumanSamples({ inputs: r.inputs!, slot: 0 }, ds);
    expect(added).toBeGreaterThan(traj.n * 0.4);
    // every extracted example matches a decision the agent really made, in order
    let at = 0;
    for (let i = 0; i < ds.size; i++) {
      let found = false;
      for (; at < traj.n && !found; at++) {
        let same = true;
        for (let k = 0; k < OBS_DIM && same; k++) same = traj.obs[at * OBS_DIM + k] === ds.obs[i * OBS_DIM + k];
        if (same) {
          found = true;
          expect(ds.move[i]).toBe(traj.move[at]);
          expect(ds.button[i]).toBe(traj.button[at]);
        }
      }
      expect(found).toBe(true);
    }
  });

  it('balancing stops idle moments from dominating', () => {
    const ds = new Dataset(100);
    const obs = new Float32Array(OBS_DIM);
    for (let i = 0; i < 90; i++) ds.add(obs, MOVE.neutral, BUTTON.none, FULL_MASK);
    for (let i = 0; i < 10; i++) ds.add(obs, MOVE.forward, BUTTON.light, FULL_MASK);
    balanceWeights(ds);
    const idleTotal = Array.from({ length: 90 }, (_, i) => ds.weight[i]).reduce((a, b) => a + b, 0);
    const actTotal = Array.from({ length: 10 }, (_, i) => ds.weight[90 + i]).reduce((a, b) => a + b, 0);
    expect(actTotal / idleTotal).toBeGreaterThan(10 / 90 + 0.1);
  });
});

describe('practice matches', () => {
  it('are deterministic for a given seed and finish', () => {
    const seat = () => ({ policy: new TeacherPolicy(TEACHERS.echo) });
    const a = playMatch([seat(), { policy: new RandomPolicy() }], { seed: 5 });
    const b = playMatch([seat(), { policy: new RandomPolicy() }], { seed: 5 });
    expect(a.hp).toEqual(b.hp);
    expect(a.frames).toBe(b.frames);
    expect(a.frames).toBeLessThanOrEqual(AI.matchFrames);
  });

  it('the teachers beat doing nothing and beat random play', () => {
    const t = { policy: new TeacherPolicy(TEACHERS.echo) };
    expect(duel(t, { policy: new IdlePolicy() }, 6, 1).rate).toBe(1);
    expect(duel(t, { policy: new RandomPolicy() }, 20, 2).rate).toBeGreaterThan(0.6);
  });

  it('a network can play (any network) without crashing', () => {
    const net = new Mlp([OBS_DIM, 32, N_OUT], createRng(8));
    const r = playMatch([{ policy: new NetPolicy(net) }, { policy: new RandomPolicy() }], { seed: 3, maxFrames: 600 });
    expect(r.frames).toBeGreaterThan(0);
  });
});
