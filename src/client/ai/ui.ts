import { AI, DIFFICULTY, difficultyOf } from '../../content/ai.ts';
import type { DifficultyId } from '../../content/ai.ts';
import { FRAME_MS } from '../../core/index.ts';
import { saveStudent, savedStudent } from '../settings.ts';
import type { AiController } from './controller.ts';
import type { PersonaRow } from './db.ts';
import { saveEffort } from './learner.ts';
import type { Effort, Learner } from './learner.ts';
import type { PersonaStore } from './personas.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ms = (frames: number): string => `${Math.round(frames * FRAME_MS)} ms`;

const bytes = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/**
 * The Students screen. It shows ONE student at a time, with next/previous buttons (or swipe, or
 * the arrow keys), so everything fits a phone and the difficulty is quick to change: four presets
 * (Easy, Normal, Hard, Brutal) and the two dials behind them. Below: watching two students fight,
 * creating or importing students, storage, and how long they think after a round.
 */
export class StudentsUi {
  private readonly store: PersonaStore;
  private readonly ai: AiController;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private list: PersonaRow[] = [];
  private index = 0;

  constructor(store: PersonaStore, learner: Learner, ai: AiController) {
    this.store = store;
    this.ai = ai;
    ai.onChanged = () => void this.render();

    const effort = $<HTMLSelectElement>('effort');
    effort.value = learner.effort;
    effort.addEventListener('change', () => {
      learner.effort = effort.value as Effort;
      saveEffort(learner.effort);
    });

    $('ai-prev').addEventListener('click', () => this.go(-1));
    $('ai-next').addEventListener('click', () => this.go(1));
    $('ai-dots').addEventListener('click', (e) => {
      const dot = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (dot) this.show(Number(dot.dataset.i));
    });
    // arrow keys flip through students while the screen is open (and nobody is typing)
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if ($('ai-panel').hidden || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.code === 'ArrowLeft') this.go(-1);
      else if (e.code === 'ArrowRight') this.go(1);
    });
    // swipe the card
    let startX: number | null = null;
    const list = $('ai-list');
    list.addEventListener('pointerdown', (e) => {
      startX = (e.target as HTMLElement).closest('input, button, select, summary') ? null : e.clientX;
    });
    list.addEventListener('pointerup', (e) => {
      if (startX !== null && Math.abs(e.clientX - startX) > 55) this.go(e.clientX < startX ? 1 : -1);
      startX = null;
    });

    $('storage-tidy').addEventListener('click', () => void this.tidy());
    $('storage-forget').addEventListener('click', () => void this.forget());
    $('storage-wipe').addEventListener('click', () => void this.wipe());
    $('ai-storage').addEventListener('toggle', () => void this.showStorage());

    $('watch-go').addEventListener('click', () => {
      const a = $<HTMLSelectElement>('watch-a').value;
      const b = $<HTMLSelectElement>('watch-b').value;
      if (a && b) void ai.watch(a, b);
    });
    $('new-go').addEventListener('click', () => void this.create());
    $<HTMLInputElement>('import-file').addEventListener('change', (e) => void this.importFile(e.target as HTMLInputElement));
    list.addEventListener('click', (e) => void this.click(e));
    list.addEventListener('input', (e) => this.input(e));
    list.addEventListener('change', (e) => this.change(e));
  }

  /** Show the screen. `watch` opens the "watch two students fight" section. */
  async open(watch = false): Promise<void> {
    await this.render();
    $<HTMLDetailsElement>('ai-watch').open = watch;
    if (watch) $('ai-watch').scrollIntoView({ block: 'nearest' });
  }

  private note(text: string, ms = 4000): void {
    const el = $('ai-status');
    el.textContent = text;
    if (ms > 0) setTimeout(() => el.textContent === text && (el.textContent = ''), ms);
  }

  // ── which student is showing ──

  private go(delta: number): void {
    if (this.list.length < 2) return;
    this.show((this.index + delta + this.list.length) % this.list.length);
  }

  private show(i: number): void {
    this.index = Math.max(0, Math.min(this.list.length - 1, i));
    const p = this.list[this.index];
    if (p) saveStudent(p.id);
    this.draw();
  }

  async render(): Promise<void> {
    const keepId = this.list[this.index]?.id ?? savedStudent();
    this.list = await this.store.list();
    const at = this.list.findIndex((p) => p.id === keepId);
    this.index = at >= 0 ? at : Math.min(this.index, Math.max(0, this.list.length - 1));
    this.draw();

    const options = this.list.map((p) => new Option(p.name, p.id));
    const fill = (id: string, pick: number): void => {
      const sel = $<HTMLSelectElement>(id);
      const keep = sel.value;
      sel.replaceChildren(...options.map((o) => o.cloneNode(true) as HTMLOptionElement));
      sel.value = this.list.some((p) => p.id === keep) ? keep : ((this.list[pick] ?? this.list[0])?.id ?? '');
    };
    fill('watch-a', 0);
    fill('watch-b', 1);

    const bases = (await this.store.baseIndex().catch(() => null))?.personas ?? [];
    const sel = $<HTMLSelectElement>('new-base');
    if (sel.options.length !== bases.length) sel.replaceChildren(...bases.map((b) => new Option(`${b.name} · ${b.blurb.split('.')[0]}`, b.id)));
  }

  private draw(): void {
    const host = $('ai-list');
    const p = this.list[this.index];
    host.replaceChildren(...(p ? [this.card(p)] : []));
    const many = this.list.length > 1;
    $<HTMLButtonElement>('ai-prev').disabled = !many;
    $<HTMLButtonElement>('ai-next').disabled = !many;
    $('ai-dots').replaceChildren(
      ...this.list.map((s, i) => {
        const dot = document.createElement('button');
        dot.dataset.i = String(i);
        dot.className = i === this.index ? 'dot on' : 'dot';
        dot.title = s.name;
        dot.setAttribute('aria-label', `${s.name} (${i + 1} of ${this.list.length})`);
        return dot;
      }),
    );
  }

  // ── the card ──

  private card(p: PersonaRow): HTMLElement {
    const el = document.createElement('article');
    el.className = 'card';
    el.dataset.id = p.id;
    const total = p.stats.wins + p.stats.losses + p.stats.draws;
    el.innerHTML = `
      <div class="top">
        <input class="pname" type="text" maxlength="24" spellcheck="false" aria-label="name" />
        <span class="rec">${p.stats.wins}W ${p.stats.losses}L${p.stats.draws ? ` ${p.stats.draws}D` : ''}</span>
      </div>
      <p class="blurb"></p>
      <div class="level">
        <span class="lvl">Difficulty <b></b></span>
        <div class="presets">${(Object.keys(DIFFICULTY) as DifficultyId[]).map((id) => `<button data-preset="${id}">${DIFFICULTY[id].label}</button>`).join('')}</div>
      </div>
      <label class="dial">Randomness
        <input type="range" min="0" max="100" step="5" data-k="randomness" />
        <output></output>
      </label>
      <label class="dial">Reaction
        <input type="range" min="${AI.reaction.min}" max="${AI.reaction.max}" step="1" data-k="reaction" />
        <output></output>
      </label>
      <div class="actions">
        <button class="primary" data-act="play">Play</button>
        <details><summary>More</summary>
          <div class="more">
            <button data-act="undo">Undo last lesson</button>
            <button data-act="reset">Reset</button>
            <button data-act="export">Export</button>
            <button data-act="delete">Delete</button>
          </div>
        </details>
      </div>
      <p class="count"></p>`;
    (el.querySelector('.pname') as HTMLInputElement).value = p.name;
    (el.querySelector('.count') as HTMLElement).textContent = `${this.index + 1} of ${this.list.length}`;
    const blurb = el.querySelector('.blurb') as HTMLElement;
    blurb.textContent = p.stats.stale
      ? 'The game changed, so this student went back to its starting brain.'
      : p.stats.generation === 0
        ? total === 0
          ? 'Fresh. Play it and it starts studying you.'
          : 'Has not learned anything new yet.'
        : `Learned ${p.stats.generation} time${p.stats.generation === 1 ? '' : 's'} from ${p.stats.studied.toLocaleString()} of your decisions.`;
    this.syncDials(el, p.settings.randomness, p.settings.reaction);
    return el;
  }

  /** Put the dials, their read-outs and the difficulty label in step with these values. */
  private syncDials(card: HTMLElement, randomness: number, reaction: number): void {
    const rnd = card.querySelector('[data-k="randomness"]') as HTMLInputElement;
    rnd.value = String(Math.round(randomness * 100));
    (rnd.nextElementSibling as HTMLOutputElement).textContent = `${rnd.value}%`;
    const rea = card.querySelector('[data-k="reaction"]') as HTMLInputElement;
    rea.value = String(reaction);
    (rea.nextElementSibling as HTMLOutputElement).textContent = ms(reaction);
    const level = difficultyOf({ randomness, reaction });
    (card.querySelector('.lvl b') as HTMLElement).textContent = level === 'custom' ? 'Custom' : DIFFICULTY[level].label;
    for (const b of card.querySelectorAll<HTMLButtonElement>('[data-preset]')) b.classList.toggle('on', b.dataset.preset === level);
  }

  private idOf(target: EventTarget | null): string | null {
    return (target as HTMLElement | null)?.closest<HTMLElement>('.card')?.dataset.id ?? null;
  }

  private saveSoon(id: string, patch: { randomness?: number; reaction?: number }): void {
    this.ai.applySettings(id, patch as never);
    const key = id + Object.keys(patch).join();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => void this.store.updateSettings(id, patch), 250));
  }

  private async click(e: Event): Promise<void> {
    const target = e.target as HTMLElement;
    const id = this.idOf(target);
    if (!id) return;

    const preset = target.closest<HTMLButtonElement>('[data-preset]');
    if (preset) {
      const d = DIFFICULTY[preset.dataset.preset as DifficultyId];
      this.syncDials(target.closest('.card') as HTMLElement, d.randomness, d.reaction);
      this.saveSoon(id, { randomness: d.randomness, reaction: d.reaction });
      return;
    }

    const btn = target.closest<HTMLButtonElement>('[data-act]');
    if (!btn) return;
    const row = await this.store.get(id);
    if (!row) return;
    try {
      switch (btn.dataset.act) {
        case 'play':
          await this.ai.play(id);
          break;
        case 'undo':
          this.note((await this.store.rollback(id)) ? `${row.name} forgot its last lesson` : `${row.name} has nothing to undo`);
          break;
        case 'reset':
          if (confirm(`Reset ${row.name} to its starting brain? Its lessons are forgotten (your matches are kept).`)) {
            await this.store.resetToBase(id);
            this.note(`${row.name} is back to its starting brain`);
          }
          break;
        case 'export': {
          const blob = await this.store.exportPersona(id);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${row.name.replace(/[^\w-]+/g, '_')}.hollow.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          break;
        }
        case 'delete':
          if (confirm(`Delete ${row.name} and everything it learned?`)) await this.store.remove(id);
          break;
      }
    } catch (err) {
      this.note(err instanceof Error ? err.message : String(err), 6000);
    }
    await this.render();
  }

  /** Sliders: update the read-outs and label straight away, and save a moment after the last change. */
  private input(e: Event): void {
    const t = e.target as HTMLInputElement;
    const id = this.idOf(t);
    const key = t.dataset.k;
    if (!id || !key) return;
    const card = t.closest('.card') as HTMLElement;
    const rnd = Number((card.querySelector('[data-k="randomness"]') as HTMLInputElement).value) / 100;
    const rea = Number((card.querySelector('[data-k="reaction"]') as HTMLInputElement).value);
    this.syncDials(card, rnd, rea);
    this.saveSoon(id, key === 'randomness' ? { randomness: rnd } : { reaction: rea });
  }

  private change(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (!t.classList.contains('pname')) return;
    const id = this.idOf(t);
    if (id) void this.store.rename(id, t.value).then(() => this.render());
  }

  // ── storage ──

  private async showStorage(): Promise<void> {
    const r = await this.store.usage();
    const parts = [`${bytes(r.dataBytes)} of student data: ${r.students} students, ${r.models} brains, ${r.replays} recorded matches.`];
    if (r.usage !== undefined && r.quota) parts.push(`This browser says the whole app uses ${bytes(r.usage)} of ${bytes(r.quota)}.`);
    if (r.persistent === false) parts.push('The browser may clear this data if the device runs low on space (installing the app helps).');
    $('storage-info').textContent = parts.join(' ');
  }

  private async tidy(): Promise<void> {
    const r = await this.store.cleanup();
    const found = r.models + r.replays + r.orphans;
    this.note(found === 0 ? 'Nothing to tidy: everything is still in use' : `Freed ${bytes(r.freedBytes)}: ${r.models} old brains, ${r.replays} old matches${r.orphans ? `, ${r.orphans} leftovers` : ''}`, 7000);
    await this.showStorage();
    await this.render();
  }

  private async forget(): Promise<void> {
    if (!confirm('Delete all recorded matches? Students keep what they learned, but have nothing left to study.')) return;
    const n = await this.store.forgetMatches();
    this.note(`Forgot ${n} matches`);
    await this.showStorage();
  }

  private async wipe(): Promise<void> {
    if (!confirm('Erase every student and everything they learned, and start over with Ember, Stone and Echo?')) return;
    await this.store.wipeAll();
    this.note('Everything erased. Fresh starters are ready.');
    await this.showStorage();
    await this.render();
  }

  // ── making and importing ──

  private async create(): Promise<void> {
    const base = $<HTMLSelectElement>('new-base').value;
    const nameEl = $<HTMLInputElement>('new-name');
    try {
      const row = await this.store.create(base, nameEl.value);
      nameEl.value = '';
      saveStudent(row.id);
      this.note(`${row.name} is ready`);
      await this.render();
    } catch (err) {
      this.note(err instanceof Error ? err.message : String(err), 6000);
    }
  }

  private async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const row = await this.store.importPersona(await file.text());
      saveStudent(row.id);
      this.note(`${row.name} imported`);
      await this.render();
    } catch (err) {
      this.note(err instanceof Error ? err.message : String(err), 6000);
    }
  }
}
