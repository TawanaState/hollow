import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sampleGroupsUsed, validateContent } from '../src/content/validate.ts';
import { ANNOUNCER_LINES, SFX } from '../src/content/sfx.ts';
import { cueFor, sfxKeys } from '../src/client/director.ts';
import { createWorld } from '../src/core/sim.ts';
import type { GameEvent } from '../src/core/types.ts';

const dir = resolve('public/audio');
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as Record<string, string[]>;

describe('sound files', () => {
  it('has every group the recipes and the announcer use', () => {
    for (const group of sampleGroupsUsed()) expect(manifest[group], `missing sample group '${group}'`).toBeDefined();
  });

  it('lists only real OGG files, and stays small enough to cache on a phone', () => {
    let bytes = 0;
    for (const [group, files] of Object.entries(manifest)) {
      expect(files.length, group).toBeGreaterThan(0);
      for (const f of files) {
        const path = resolve(dir, f);
        expect(existsSync(path), f).toBe(true);
        const head = readFileSync(path).subarray(0, 4).toString('latin1');
        expect(head, `${f} is not an Ogg file`).toBe('OggS');
        bytes += statSync(path).size;
      }
    }
    expect(bytes).toBeLessThan(1.6 * 1024 * 1024);
  });

  it('has no recording nothing uses (so nothing is shipped for no reason)', () => {
    const used = new Set(sampleGroupsUsed());
    for (const group of Object.keys(manifest)) expect(used.has(group), `unused sample group '${group}'`).toBe(true);
  });

  it('credits the source and licence', () => {
    const credits = readFileSync(resolve(dir, 'CREDITS.txt'), 'utf8');
    expect(credits).toMatch(/CC0/);
    expect(credits).toMatch(/kenney\.nl/i);
  });
});

describe('sound recipes', () => {
  it('are valid, and every recipe works without recordings (synth fallback or body)', () => {
    expect(validateContent()).toEqual([]);
    for (const [key, r] of Object.entries(SFX)) {
      if (key.startsWith('ui.')) continue; // interface sounds are recordings only
      expect(r.fallback ?? r.body, key).toBeDefined();
    }
  });

  it('cover every tier of hit, block, skill and landing', () => {
    for (const tier of ['light', 'medium', 'heavy', 'crush']) {
      expect(SFX[`hit.${tier}`], `hit.${tier}`).toBeDefined();
      expect(SFX[`block.${tier}`], `block.${tier}`).toBeDefined();
      expect(SFX[`skill.${tier}`], `skill.${tier}`).toBeDefined();
    }
    expect(SFX['land.light']).toBeDefined();
    expect(SFX['land.medium']).toBeDefined();
  });
});

describe('what plays for each event', () => {
  const hit = (over: Partial<Extract<GameEvent, { t: 'HIT' }>> = {}): GameEvent => ({
    t: 'HIT', f: 1, atk: 0, def: 1, skill: 'jab', tier: 'heavy', damage: 100, x: 0, y: 100, dir: 1, counter: false, side: 'front', launch: false, combo: 1, comboDamage: 100, hitstop: 11, ...over,
  });
  const has = (k: string): boolean => k in SFX;

  it('picks the sound for the hit tier and passes the combo count along for the pitch', () => {
    const cue = cueFor(hit({ combo: 3 }))!;
    expect(sfxKeys(cue, has)).toEqual(['hit.heavy']);
    expect(cue.ctx.combo).toBe(3);
  });

  it('adds the counter-hit sound on top', () => {
    expect(sfxKeys(cueFor(hit({ counter: true }))!, has)).toEqual(['hit.heavy', 'counter']);
  });

  it('shouts "combo" once, at the fifth hit', () => {
    expect(cueFor(hit({ combo: 4 }))!.announce).toBeUndefined();
    expect(cueFor(hit({ combo: 5 }))!.announce?.line).toBe('combo');
    expect(cueFor(hit({ combo: 6 }))!.announce).toBeUndefined();
  });

  it('announces the round number, then FIGHT', () => {
    const w = createWorld();
    expect(cueFor({ t: 'ROUND_START', f: 0 }, { world: w })!.announce?.line).toBe('round-1');
    w.score = [1, 1];
    expect(cueFor({ t: 'ROUND_START', f: 0 }, { world: w })!.announce?.line).toBe('round-3');
    w.score = [3, 3];
    expect(cueFor({ t: 'ROUND_START', f: 0 }, { world: w })!.announce?.line).toBe('final-round');
    expect(cueFor({ t: 'ROUND_GO', f: 0 })!.announce?.line).toBe('fight');
  });

  it('announces the winner in the right words', () => {
    const w = createWorld();
    const ko = (winner: 0 | 1 | -1): GameEvent => ({ t: 'KO', f: 1, id: winner === 0 ? 1 : 0, winner, x: 0, y: 70 });
    expect(cueFor(ko(0), { world: w, humanSlot: 0 })!.announce?.line).toBe('you-win');
    expect(cueFor(ko(1), { world: w, humanSlot: 0 })!.announce?.line).toBe('you-lose');
    expect(cueFor(ko(-1), { world: w })!.announce?.line).toBe('tie');
    expect(cueFor(ko(0), { world: w })!.announce?.line).toBe('flawless'); // winner untouched
    w.fighters[0].hp -= 10;
    expect(cueFor(ko(0), { world: w })!.announce?.line).toBe('winner');
    for (const line of ['you-win', 'you-lose', 'tie', 'flawless', 'winner']) expect(ANNOUNCER_LINES as readonly string[]).toContain(line);
  });

  it('does not pan the sounds that belong to the whole screen', () => {
    expect(cueFor({ t: 'ROUND_GO', f: 0 })!.ctx.global).toBe(true);
    expect(cueFor({ t: 'SKILL', f: 0, id: 0, skill: 'jab', tier: 'light' })!.ctx.global).toBe(true);
    expect(cueFor({ t: 'JUMP', f: 0, id: 0, x: 200 })!.ctx.global).toBeUndefined();
  });
});
