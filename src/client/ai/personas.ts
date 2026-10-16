import { AI } from '../../content/ai.ts';
import type { StyleId } from '../../content/ai.ts';
import { SCHEMA, brainFromBuffer } from '../../ai/brain.ts';
import type { Mlp } from '../../ai/nn.ts';
import { SIM_VERSION } from '../../core/sim.ts';
import { openDb } from './db.ts';
import type { HollowDB, ModelRow, PersonaRow, PersonaSettings, ReplayRow } from './db.ts';

/** One of the starter brains shipped with the game (public/personas). */
export interface BaseInfo {
  id: string;
  name: string;
  blurb: string;
  style: StyleId;
  file: string;
}

export interface BaseIndex {
  schema: string;
  personas: BaseInfo[];
}

/** Where the starter brains come from. The default fetches them (and the service worker caches them for offline). */
export interface BaseLoader {
  index(): Promise<BaseIndex>;
  file(name: string): Promise<ArrayBuffer>;
}

export const fetchLoader: BaseLoader = {
  async index() {
    const res = await fetch('/personas/index.json');
    if (!res.ok) throw new Error('Starter personas are missing (run `npm run train:base`).');
    return (await res.json()) as BaseIndex;
  },
  async file(name) {
    const res = await fetch(`/personas/${name}`);
    if (!res.ok) throw new Error(`Could not load the ${name} brain.`);
    return res.arrayBuffer();
  },
};

const defaultSettings = (): PersonaSettings => ({ randomness: 0.1, reaction: AI.reaction.default, guardrails: true, temperature: 1 });
const emptyStats = (): PersonaRow['stats'] => ({ wins: 0, losses: 0, draws: 0, generation: 0, studied: 0, lastLearnedAt: 0 });

const newId = (): string => (crypto.randomUUID ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/** What the tidy-up found and removed. */
export interface CleanupResult {
  /** Old brain versions and brains from an older version of the game. */
  models: number;
  /** Match recordings no longer worth keeping (too many, or too old). */
  replays: number;
  /** Leftovers of students that were deleted. */
  orphans: number;
  freedBytes: number;
}

/** How much student data is on this device, and what the browser says about its overall storage. */
export interface StorageReport {
  students: number;
  models: number;
  replays: number;
  clones: number;
  /** Bytes taken by student data (brains, recordings, models of you). */
  dataBytes: number;
  /** What the browser reports for this whole site (app files included), if it says. */
  usage?: number;
  quota?: number;
  /** Whether the browser promised not to delete our data when space runs low. */
  persistent?: boolean;
}

/** The file format for sharing a persona. */
interface ExportFile {
  hollow: 'persona';
  version: 1;
  schema: string;
  name: string;
  base: string;
  style: StyleId;
  settings: PersonaSettings;
  stats: PersonaRow['stats'];
  weights: string; // base64
}

const toBase64 = (buf: ArrayBuffer): string => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64: string): ArrayBuffer => {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
};

/**
 * All persona storage and bookkeeping. One persona = a row of settings and stats, a stack of
 * saved brains (newest is in use, the first is its starting point), the recent matches it has
 * studied, and a model of the human it plays.
 */
export class PersonaStore {
  readonly db: HollowDB;
  private readonly loader: BaseLoader;
  private index: BaseIndex | null = null;
  private baseCache = new Map<string, ArrayBuffer>();

  constructor(db: HollowDB = openDb(), loader: BaseLoader = fetchLoader) {
    this.db = db;
    this.loader = loader;
  }

  // ── starter personas (shipped files, cached by the service worker so they work offline) ──

  async baseIndex(): Promise<BaseIndex> {
    this.index ??= await this.loader.index();
    return this.index;
  }

  private async baseWeights(base: BaseInfo): Promise<ArrayBuffer> {
    let buf = this.baseCache.get(base.id);
    if (!buf) {
      buf = await this.loader.file(base.file);
      this.baseCache.set(base.id, buf);
    }
    return buf;
  }

  /** First run: create Ember, Stone and Echo so there is someone to play right away. */
  async ensureDefaults(): Promise<void> {
    if ((await this.db.personas.count()) > 0) return;
    const index = await this.baseIndex();
    for (const base of index.personas) await this.create(base.id, base.name);
    try {
      await navigator.storage?.persist?.(); // ask the browser not to evict our saved brains
    } catch {
      /* not supported: fine */
    }
  }

  // ── people ──

  async list(): Promise<PersonaRow[]> {
    return (await this.db.personas.orderBy('createdAt').toArray()).sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): Promise<PersonaRow | undefined> {
    return this.db.personas.get(id);
  }

  /** A new student that starts as a copy of one of the starter personas. */
  async create(baseId: string, name: string): Promise<PersonaRow> {
    const index = await this.baseIndex();
    const base = index.personas.find((b) => b.id === baseId) ?? index.personas[0];
    const weights = await this.baseWeights(base);
    const now = Date.now();
    const row: PersonaRow = {
      id: newId(),
      name: name.trim().slice(0, 24) || base.name,
      base: base.id,
      style: base.style,
      createdAt: now,
      updatedAt: now,
      settings: defaultSettings(),
      stats: emptyStats(),
    };
    await this.db.transaction('rw', this.db.personas, this.db.models, async () => {
      await this.db.personas.add(row);
      await this.db.models.add({ personaId: row.id, version: 1, kind: 'base', schema: index.schema, weights: weights.slice(0), note: `starts as ${base.name}`, createdAt: now });
    });
    return row;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.db.personas.update(id, { name: name.trim().slice(0, 24) || 'Student', updatedAt: Date.now() });
  }

  async updateSettings(id: string, patch: Partial<PersonaSettings>): Promise<void> {
    const row = await this.db.personas.get(id);
    if (!row) return;
    await this.db.personas.update(id, { settings: { ...row.settings, ...patch }, updatedAt: Date.now() });
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction('rw', [this.db.personas, this.db.models, this.db.replays, this.db.clones], async () => {
      await this.db.personas.delete(id);
      await this.db.models.where('personaId').equals(id).delete();
      await this.db.replays.where('personaId').equals(id).delete();
      await this.db.clones.delete(id);
    });
  }

  // ── brains ──

  private async latestModel(id: string): Promise<ModelRow | undefined> {
    const all = await this.db.models.where('personaId').equals(id).sortBy('version');
    return all[all.length - 1];
  }

  /** The brain currently in use. If it no longer fits this version of the game, fall back to its base and say so. */
  async loadBrain(id: string): Promise<Mlp> {
    const model = await this.latestModel(id);
    if (!model) throw new Error('This student has no brain saved.');
    if (model.schema === SCHEMA) return brainFromBuffer(model.weights.slice(0));
    const row = await this.db.personas.get(id);
    const index = await this.baseIndex();
    const base = index.personas.find((b) => b.id === row?.base) ?? index.personas[0];
    if (index.schema !== SCHEMA) throw new Error('The shipped starter brains do not match this version of the game.');
    const fresh = await this.baseWeights(base);
    await this.db.models.where('personaId').equals(id).delete();
    await this.db.models.add({ personaId: id, version: 1, kind: 'base', schema: SCHEMA, weights: fresh.slice(0), note: 'reset: the game changed', createdAt: Date.now() });
    if (row) await this.db.personas.update(id, { stats: { ...row.stats, stale: true } });
    return brainFromBuffer(fresh.slice(0));
  }

  /** The starting brain (version 1), used to keep learning anchored to the persona's personality. */
  async loadStartBrain(id: string): Promise<Mlp> {
    const first = (await this.db.models.where('personaId').equals(id).sortBy('version'))[0];
    if (!first || first.schema !== SCHEMA) return this.loadBrain(id);
    return brainFromBuffer(first.weights.slice(0));
  }

  async saveBrain(id: string, net: Mlp, note: string): Promise<void> {
    const last = await this.latestModel(id);
    await this.db.models.add({ personaId: id, version: (last?.version ?? 0) + 1, kind: 'learned', schema: SCHEMA, weights: net.toBuffer(), note, createdAt: Date.now() });
    // keep the starting brain and the most recent few, so there is always something to roll back to
    const all = await this.db.models.where('personaId').equals(id).sortBy('version');
    const drop = all.slice(1, Math.max(1, all.length - AI.keepVersions));
    if (drop.length) await this.db.models.bulkDelete(drop.map((m) => m.id!));
  }

  /** Undo the most recent thing it learned. Returns false if there is nothing to undo. */
  async rollback(id: string): Promise<boolean> {
    const all = await this.db.models.where('personaId').equals(id).sortBy('version');
    if (all.length <= 1) return false;
    await this.db.models.delete(all[all.length - 1].id!);
    return true;
  }

  /** Forget everything it learned and go back to its starting brain (matches you played are kept). */
  async resetToBase(id: string): Promise<void> {
    const all = await this.db.models.where('personaId').equals(id).sortBy('version');
    if (all.length > 1) await this.db.models.bulkDelete(all.slice(1).map((m) => m.id!));
    const row = await this.db.personas.get(id);
    if (row) await this.db.personas.update(id, { stats: { ...row.stats, generation: 0, stale: false }, updatedAt: Date.now() });
    await this.db.clones.delete(id);
  }

  async modelCount(id: string): Promise<number> {
    return this.db.models.where('personaId').equals(id).count();
  }

  // ── what it has learned from you ──

  async loadClone(id: string): Promise<Mlp | null> {
    const row = await this.db.clones.get(id);
    return row && row.schema === SCHEMA ? brainFromBuffer(row.weights.slice(0)) : null;
  }

  async saveClone(id: string, net: Mlp): Promise<void> {
    await this.db.clones.put({ personaId: id, schema: SCHEMA, weights: net.toBuffer(), updatedAt: Date.now() });
  }

  async saveReplay(row: Omit<ReplayRow, 'id'>): Promise<void> {
    await this.db.replays.add({ sim: SIM_VERSION, ...row });
    // only the most recent matches plus a handful of older ones are worth keeping
    const keep = AI.recentMatches + AI.rehearsalMatches * 3;
    const count = await this.db.replays.where('personaId').equals(row.personaId).count();
    if (count > keep) {
      const old = await this.db.replays.where('personaId').equals(row.personaId).sortBy('at');
      await this.db.replays.bulkDelete(old.slice(0, count - keep).map((r) => r.id!));
    }
  }

  /** Recent matches, plus a few older ones as a reminder (so recent habits do not erase old lessons). */
  async studyMatches(id: string): Promise<ReplayRow[]> {
    const all = (await this.db.replays.where('personaId').equals(id).sortBy('at')).reverse();
    const recent = all.slice(0, AI.recentMatches);
    const older = all.slice(AI.recentMatches);
    const picks: ReplayRow[] = [];
    const step = Math.max(1, Math.floor(older.length / AI.rehearsalMatches));
    for (let i = 0; i < older.length && picks.length < AI.rehearsalMatches; i += step) picks.push(older[i]);
    return [...recent, ...picks];
  }

  async recordResult(id: string, personaResult: 'win' | 'loss' | 'draw'): Promise<void> {
    const row = await this.db.personas.get(id);
    if (!row) return;
    const s = { ...row.stats };
    if (personaResult === 'win') s.wins++;
    else if (personaResult === 'loss') s.losses++;
    else s.draws++;
    await this.db.personas.update(id, { stats: s, updatedAt: Date.now() });
  }

  async noteLearned(id: string, studied: number): Promise<void> {
    const row = await this.db.personas.get(id);
    if (!row) return;
    await this.db.personas.update(id, { stats: { ...row.stats, generation: row.stats.generation + 1, studied: row.stats.studied + studied, lastLearnedAt: Date.now(), stale: false }, updatedAt: Date.now() });
  }

  // ── storage: how much is used, and tidying up ──

  async usage(): Promise<StorageReport> {
    const [students, models, replays, clones] = await Promise.all([this.db.personas.count(), this.db.models.toArray(), this.db.replays.toArray(), this.db.clones.toArray()]);
    const sum = (rows: { weights?: ArrayBuffer; data?: ArrayBuffer }[]): number => rows.reduce((n, r) => n + (r.weights?.byteLength ?? r.data?.byteLength ?? 0), 0);
    const report: StorageReport = { students, models: models.length, replays: replays.length, clones: clones.length, dataBytes: sum(models) + sum(replays) + sum(clones) };
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) {
        report.usage = est.usage;
        report.quota = est.quota;
      }
      report.persistent = await navigator.storage?.persisted?.();
    } catch {
      /* the browser does not say: fine */
    }
    return report;
  }

  /**
   * Throw away what the students no longer need:
   *   - brain versions beyond the starting brain and the most recent few, and brains made for an older game
   *   - match recordings beyond the study window, and old ones (see AI.replayMaxAgeDays)
   *   - anything left behind by a deleted student
   * It never touches the current brain, the starting brain, or the matches a student is still studying.
   */
  async cleanup(): Promise<CleanupResult> {
    const out: CleanupResult = { models: 0, replays: 0, orphans: 0, freedBytes: 0 };
    const db = this.db;
    await db.transaction('rw', [db.personas, db.models, db.replays, db.clones], async () => {
      const ids = new Set((await db.personas.toArray()).map((p) => p.id));
      const drop = async <T extends { weights?: ArrayBuffer; data?: ArrayBuffer }>(table: { bulkDelete(keys: never[]): Promise<void> }, rows: (T & { id?: number })[], counter: 'models' | 'replays' | 'orphans'): Promise<void> => {
        if (!rows.length) return;
        await table.bulkDelete(rows.map((r) => r.id) as never[]);
        out[counter] += rows.length;
        out.freedBytes += rows.reduce((n, r) => n + (r.weights?.byteLength ?? r.data?.byteLength ?? 0), 0);
      };

      // leftovers of deleted students
      const models = await db.models.toArray();
      const replays = await db.replays.toArray();
      await drop(db.models, models.filter((m) => !ids.has(m.personaId)), 'orphans');
      await drop(db.replays, replays.filter((r) => !ids.has(r.personaId)), 'orphans');
      // recordings made under older rules would replay differently now, so they are no use
      await drop(db.replays, replays.filter((r) => ids.has(r.personaId) && (r.sim ?? 1) !== SIM_VERSION), 'replays');
      for (const c of await db.clones.toArray()) {
        if (!ids.has(c.personaId)) {
          await db.clones.delete(c.personaId);
          out.orphans++;
          out.freedBytes += c.weights.byteLength;
        }
      }

      const cutoff = Date.now() - AI.replayMaxAgeDays * 86_400_000;
      const keepMatches = AI.recentMatches + AI.rehearsalMatches * 3;
      for (const id of ids) {
        // brains: the starting one, plus the newest few that fit this version of the game
        const mine = models.filter((m) => m.personaId === id).sort((a, b) => a.version - b.version);
        if (mine.length > 1) {
          const keep = new Set<number>([mine[0].version, ...mine.slice(1).filter((m) => m.schema === SCHEMA).slice(-AI.keepVersions).map((m) => m.version)]);
          await drop(db.models, mine.filter((m) => !keep.has(m.version)), 'models');
        }
        // matches: newest first; keep the study window, drop the rest if too many or too old
        const plays = replays.filter((r) => r.personaId === id && (r.sim ?? 1) === SIM_VERSION).sort((a, b) => b.at - a.at);
        const surplus = plays.filter((r, i) => i >= keepMatches || (i >= AI.recentMatches && r.at < cutoff));
        await drop(db.replays, surplus, 'replays');
      }
    });
    return out;
  }

  /** Delete the recorded matches (of one student, or all). Brains stay; they just stop learning from the past. */
  async forgetMatches(personaId?: string): Promise<number> {
    const table = this.db.replays;
    const rows = personaId ? await table.where('personaId').equals(personaId).toArray() : await table.toArray();
    await table.bulkDelete(rows.map((r) => r.id!));
    if (!personaId) await this.db.clones.clear(); // the models of you were built from those matches
    return rows.length;
  }

  /** Erase every student, brain, match and model of you, then set the three starters up fresh. */
  async wipeAll(): Promise<void> {
    await this.db.transaction('rw', [this.db.personas, this.db.models, this.db.replays, this.db.clones], async () => {
      await Promise.all([this.db.personas.clear(), this.db.models.clear(), this.db.replays.clear(), this.db.clones.clear()]);
    });
    await this.ensureDefaults();
  }

  // ── sharing ──

  async exportPersona(id: string): Promise<Blob> {
    const row = await this.db.personas.get(id);
    const model = await this.latestModel(id);
    if (!row || !model) throw new Error('Nothing to export.');
    const file: ExportFile = { hollow: 'persona', version: 1, schema: model.schema, name: row.name, base: row.base, style: row.style, settings: row.settings, stats: row.stats, weights: toBase64(model.weights) };
    return new Blob([JSON.stringify(file)], { type: 'application/json' });
  }

  async importPersona(text: string): Promise<PersonaRow> {
    const f = JSON.parse(text) as Partial<ExportFile>;
    if (f.hollow !== 'persona' || !f.weights || !f.name) throw new Error('That is not a hollow persona file.');
    if (f.schema !== SCHEMA) throw new Error('That persona was made for a different version of the game.');
    const now = Date.now();
    const weights = fromBase64(f.weights);
    brainFromBuffer(weights.slice(0)); // validates the shape
    const row: PersonaRow = {
      id: newId(),
      name: String(f.name).slice(0, 24),
      base: String(f.base ?? 'echo'),
      style: (f.style as StyleId) ?? 'echo',
      createdAt: now,
      updatedAt: now,
      settings: { ...defaultSettings(), ...f.settings },
      stats: { ...emptyStats(), ...f.stats },
    };
    await this.db.transaction('rw', this.db.personas, this.db.models, async () => {
      await this.db.personas.add(row);
      await this.db.models.add({ personaId: row.id, version: 1, kind: 'base', schema: SCHEMA, weights, note: 'imported', createdAt: now });
    });
    return row;
  }
}
