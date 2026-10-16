import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Agent } from '../src/ai/agent.ts';
import { duel, playMatch } from '../src/ai/arena.ts';
import { NET_SIZES, SCHEMA, brainFromBuffer } from '../src/ai/brain.ts';
import { learn } from '../src/ai/personaLearn.ts';
import { NetPolicy, RandomPolicy } from '../src/ai/policy.ts';
import { packInputs } from '../src/ai/replayPack.ts';
import { TEACHERS, TeacherPolicy } from '../src/ai/teachers.ts';
import { openDb } from '../src/client/ai/db.ts';
import { PersonaStore } from '../src/client/ai/personas.ts';
import type { BaseIndex, BaseLoader } from '../src/client/ai/personas.ts';
import { Game } from '../src/core/game.ts';
import { createWorld, step } from '../src/core/sim.ts';

const dir = resolve('public/personas');
const files: BaseLoader = {
  index: async () => JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8')) as BaseIndex,
  file: async (name) => {
    const b = readFileSync(resolve(dir, name));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
};

let n = 0;
const fresh = (): PersonaStore => new PersonaStore(openDb(`test-${++n}-${Math.random()}`), files);

describe('starter personas (the shipped brains)', () => {
  it('match this version of the game and are the right size', async () => {
    const index = await files.index();
    expect(index.schema).toBe(SCHEMA);
    expect(index.personas.map((p) => p.id)).toEqual(['ember', 'stone', 'echo']);
    for (const p of index.personas) {
      const net = brainFromBuffer(await files.file(p.file));
      expect(Array.from(net.sizes)).toEqual(Array.from(NET_SIZES));
      expect(net.W.every((w) => w.every(Number.isFinite))).toBe(true);
    }
  });

  it('actually fight: each one beats random play', async () => {
    const index = await files.index();
    for (const p of index.personas) {
      const net = brainFromBuffer(await files.file(p.file));
      expect(duel({ policy: new NetPolicy(net) }, { policy: new RandomPolicy() }, 16, 3).rate).toBeGreaterThan(0.6);
    }
  });
});

describe('persona storage', () => {
  let store: PersonaStore;
  beforeEach(() => {
    store = fresh();
  });

  it('creates the three defaults once, each with a usable brain', async () => {
    await store.ensureDefaults();
    await store.ensureDefaults();
    const list = await store.list();
    expect(list.map((p) => p.name)).toEqual(['Ember', 'Stone', 'Echo']);
    const net = await store.loadBrain(list[0].id);
    expect(net.sizes[0]).toBe(NET_SIZES[0]);
  });

  it('renames, changes dials, and deletes everything belonging to a persona', async () => {
    await store.ensureDefaults();
    const [p] = await store.list();
    await store.rename(p.id, '  Rival  ');
    await store.updateSettings(p.id, { randomness: 0.5, reaction: 14 });
    const row = (await store.get(p.id))!;
    expect(row.name).toBe('Rival');
    expect(row.settings).toMatchObject({ randomness: 0.5, reaction: 14, guardrails: true });
    await store.remove(p.id);
    expect(await store.get(p.id)).toBeUndefined();
    expect(await store.modelCount(p.id)).toBe(0);
  });

  it('keeps versions, can undo a lesson, and can go back to its starting brain', async () => {
    await store.ensureDefaults();
    const [p] = await store.list();
    const net = await store.loadBrain(p.id);
    for (let i = 0; i < 9; i++) {
      net.W[0][0] += 0.1;
      await store.saveBrain(p.id, net, `lesson ${i}`);
    }
    expect(await store.modelCount(p.id)).toBeLessThanOrEqual(6); // the start plus the last five
    const before = (await store.loadBrain(p.id)).W[0][0];
    expect(await store.rollback(p.id)).toBe(true);
    expect((await store.loadBrain(p.id)).W[0][0]).toBeCloseTo(before - 0.1, 4);
    await store.resetToBase(p.id);
    expect(await store.modelCount(p.id)).toBe(1);
    expect(await store.rollback(p.id)).toBe(false);
  });

  it('survives an export and import, and refuses a brain from another version', async () => {
    await store.ensureDefaults();
    const [p] = await store.list();
    const text = await (await store.exportPersona(p.id)).text();
    const copy = await store.importPersona(text);
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe(p.name);
    const a = (await store.loadBrain(p.id)).W[0].slice(0, 8);
    const b = (await store.loadBrain(copy.id)).W[0].slice(0, 8);
    expect(Array.from(b)).toEqual(Array.from(a));
    const wrong = JSON.stringify({ ...JSON.parse(text), schema: 'deadbeef' });
    await expect(store.importPersona(wrong)).rejects.toThrow(/different version/);
    await expect(store.importPersona('{"hello":1}')).rejects.toThrow(/not a hollow persona/);
  });

  it('falls back to the starting brain, and says so, if the game changed under a saved one', async () => {
    await store.ensureDefaults();
    const [p] = await store.list();
    await store.db.models.where('personaId').equals(p.id).modify({ schema: 'old-version' });
    const net = await store.loadBrain(p.id);
    expect(net.sizes[0]).toBe(NET_SIZES[0]);
    expect((await store.get(p.id))!.stats.stale).toBe(true);
  });

  it('studies the recent matches plus a few older ones, and does not hoard', async () => {
    await store.ensureDefaults();
    const [p] = await store.list();
    const data = packInputs([[0, 0]]);
    for (let i = 0; i < 80; i++) await store.saveReplay({ personaId: p.id, at: i, humanSlot: 0, result: 'win', frames: 100, data });
    const kept = await store.db.replays.where('personaId').equals(p.id).count();
    expect(kept).toBeLessThanOrEqual(48);
    const study = await store.studyMatches(p.id);
    expect(study[0].at).toBe(79); // newest first
    expect(study.length).toBeGreaterThan(24);
  });
});

describe('storage cleanup', () => {
  let store: PersonaStore;
  beforeEach(async () => {
    store = fresh();
    await store.ensureDefaults();
  });
  const data = packInputs([[0, 0]]);

  it('reports what is stored', async () => {
    const r = await store.usage();
    expect(r.students).toBe(3);
    expect(r.models).toBe(3);
    expect(r.dataBytes).toBeGreaterThan(3 * 70_000); // three ~75 KB brains
  });

  it('removes old brain versions but never the starting or current brain', async () => {
    const [p] = await store.list();
    // pile up versions behind the store's back, as if an older release had not pruned
    for (let v = 2; v <= 20; v++) await store.db.models.add({ personaId: p.id, version: v, kind: 'learned', schema: SCHEMA, weights: new ArrayBuffer(1000), note: '', createdAt: v });
    const out = await store.cleanup();
    expect(out.models).toBeGreaterThan(10);
    const left = (await store.db.models.where('personaId').equals(p.id).sortBy('version')).map((m) => m.version);
    expect(left[0]).toBe(1);
    expect(left.at(-1)).toBe(20);
    expect(left.length).toBeLessThanOrEqual(6);
  });

  it('removes brains made for an older game, and old recordings, but keeps the study window', async () => {
    const [p] = await store.list();
    const day = 86_400_000;
    await store.db.models.add({ personaId: p.id, version: 2, kind: 'learned', schema: 'ancient', weights: new ArrayBuffer(500), note: '', createdAt: 1 });
    for (let i = 0; i < 40; i++) await store.db.replays.add({ personaId: p.id, at: Date.now() - (i < 10 ? i * 1000 : 200 * day + i), humanSlot: 0, result: 'win', frames: 100, data });
    const out = await store.cleanup();
    expect(out.models).toBe(1);
    expect(out.replays).toBeGreaterThan(0);
    const kept = await store.db.replays.where('personaId').equals(p.id).count();
    expect(kept).toBeGreaterThanOrEqual(10); // the recent ones are always kept
    expect(kept).toBeLessThan(40);
    expect(out.freedBytes).toBeGreaterThan(0);
  });

  it('clears out leftovers of a student that no longer exists', async () => {
    await store.db.models.add({ personaId: 'ghost', version: 1, kind: 'base', schema: SCHEMA, weights: new ArrayBuffer(2000), note: '', createdAt: 1 });
    await store.db.replays.add({ personaId: 'ghost', at: 1, humanSlot: 0, result: 'win', frames: 1, data });
    await store.db.clones.put({ personaId: 'ghost', schema: SCHEMA, weights: new ArrayBuffer(900), updatedAt: 1 });
    const out = await store.cleanup();
    expect(out.orphans).toBe(3);
    expect(await store.db.clones.get('ghost')).toBeUndefined();
    expect(await store.list()).toHaveLength(3); // real students untouched
  });

  it('does nothing when there is nothing to do', async () => {
    const out = await store.cleanup();
    expect(out).toEqual({ models: 0, replays: 0, orphans: 0, freedBytes: 0 });
  });

  it('can forget all matches, or erase everything and start fresh', async () => {
    const [p] = await store.list();
    for (let i = 0; i < 5; i++) await store.saveReplay({ personaId: p.id, at: i, humanSlot: 0, result: 'loss', frames: 50, data });
    expect(await store.forgetMatches(p.id)).toBe(5);
    expect(await store.db.replays.count()).toBe(0);
    await store.rename(p.id, 'Changed');
    await store.wipeAll();
    const list = await store.list();
    expect(list.map((x) => x.name)).toEqual(['Ember', 'Stone', 'Echo']);
    expect(list[0].id).not.toBe(p.id);
  });
});

describe('learning from a human', () => {
  it('studies a recorded match, models the human, and returns a valid brain within its time budget', async () => {
    const index = await files.index();
    const base = brainFromBuffer(await files.file(index.personas[2].file));
    // a "human": the Ember teacher, playing seat 0 against the persona
    const rec = playMatch([{ policy: new TeacherPolicy(TEACHERS.ember) }, { policy: new NetPolicy(base) }], { seed: 77, keepInputs: true });
    const budgetMs = 3000;
    const t0 = Date.now();
    const out = learn({ net: base, base, clone: null, matches: [{ inputs: rec.inputs!, slot: 0 }], style: 'echo', budgetMs, seed: 5 });
    expect(Date.now() - t0).toBeLessThan(budgetMs * 2.5);
    expect(out.humanSamples).toBeGreaterThan(50);
    expect(out.after).toBeGreaterThanOrEqual(0);
    expect(out.after).toBeLessThanOrEqual(1);
    expect(out.net.W.every((w) => w.every(Number.isFinite))).toBe(true);
    expect(out.clone.W.every((w) => w.every(Number.isFinite))).toBe(true);
    // the model of the human learned something: it differs from the starting brain
    expect(Array.from(out.clone.W[0].slice(0, 50))).not.toEqual(Array.from(base.W[0].slice(0, 50)));
  });
});

describe('recording a round in a longer game', () => {
  it('replays from scratch to exactly the state the live game reached', () => {
    const game = new Game();
    const agents = [0, 1].map(
      (i) => new Agent({ slot: i as 0 | 1, getWorld: () => game.world, policy: new TeacherPolicy(TEACHERS[i === 0 ? 'ember' : 'stone']), settings: { randomness: 0.05, reaction: 4 }, seed: 40 + i }),
    );
    game.router.attach(0, agents[0]);
    game.router.attach(1, agents[1]);
    let roundStart = 0;
    let kos = 0;
    let endState = '';
    let segment: [number, number][] = [];
    game.bus.on('ROUND_START', () => {
      roundStart = Math.max(0, game.recorder.inputs.length - 1);
    });
    game.bus.on('KO', () => {
      kos++;
      if (kos === 2) {
        segment = game.recorder.inputs.slice(roundStart);
        endState = JSON.stringify(game.world.fighters);
      }
    });
    for (let i = 0; i < 60_000 && kos < 2; i++) game.tick();
    expect(kos).toBe(2);
    const w = createWorld({ hpScale: game.world.hpScale });
    for (const input of segment) step(w, input);
    expect(JSON.stringify(w.fighters)).toBe(endState);
  });
});
