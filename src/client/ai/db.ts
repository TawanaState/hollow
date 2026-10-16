import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { StyleId } from '../../content/ai.ts';

/**
 * Everything the AI remembers lives in IndexedDB on the player's own device, so it works with no
 * internet and survives closing the app. Brains are small (about 80 KB each).
 */
export interface PersonaSettings {
  /** 0..1 share of decisions replaced by random ones. */
  randomness: number;
  /** F of reaction delay. */
  reaction: number;
  guardrails: boolean;
  temperature: number;
}

export interface PersonaStats {
  wins: number;
  losses: number;
  draws: number;
  /** How many times it has learned something new and kept it. */
  generation: number;
  /** Your decisions it has studied. */
  studied: number;
  lastLearnedAt: number;
  /** Set when the saved brain no longer fits this version of the game (it was reset to its base). */
  stale?: boolean;
}

export interface PersonaRow {
  id: string;
  name: string;
  /** Which starter persona it grew from (the 'ember' / 'stone' / 'echo' files). */
  base: string;
  style: StyleId;
  createdAt: number;
  updatedAt: number;
  settings: PersonaSettings;
  stats: PersonaStats;
}

export interface ModelRow {
  id?: number;
  personaId: string;
  version: number;
  kind: 'base' | 'learned';
  schema: string;
  weights: ArrayBuffer;
  note: string;
  createdAt: number;
}

export interface ReplayRow {
  id?: number;
  personaId: string;
  at: number;
  /** Which seat the human played. */
  humanSlot: 0 | 1;
  result: 'win' | 'loss' | 'draw';
  frames: number;
  /** Run-length packed inputs (see ai/replayPack.ts). */
  data: ArrayBuffer;
}

/** A persona's model of the human it plays: what it spars against when it practises. */
export interface CloneRow {
  personaId: string;
  schema: string;
  weights: ArrayBuffer;
  updatedAt: number;
}

export type HollowDB = Dexie & {
  personas: Table<PersonaRow, string>;
  models: Table<ModelRow, number>;
  replays: Table<ReplayRow, number>;
  clones: Table<CloneRow, string>;
};

export function openDb(name = 'hollow'): HollowDB {
  const db = new Dexie(name) as HollowDB;
  db.version(1).stores({
    personas: 'id, createdAt, updatedAt',
    models: '++id, personaId, [personaId+version]',
    replays: '++id, personaId, at',
    clones: 'personaId',
  });
  return db;
}
