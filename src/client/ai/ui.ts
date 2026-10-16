import { AI } from '../../content/ai.ts';
import { FRAME_MS } from '../../core/index.ts';
import type { AiController } from './controller.ts';
import type { PersonaRow } from './db.ts';
import { saveEffort } from './learner.ts';
import type { Effort, Learner } from './learner.ts';
import type { PersonaStore } from './personas.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ms = (frames: number): string => `${Math.round(frames * FRAME_MS)} ms`;

const bytes = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/**
 * The Students screen: one card per persona with its two difficulty dials, plus watching two of
 * them fight, creating new ones, and importing/exporting. Plain DOM, no framework.
 */
export class StudentsUi {
  private readonly store: PersonaStore;
  private readonly ai: AiController;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

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
    $('ai-list').addEventListener('click', (e) => void this.click(e));
    $('ai-list').addEventListener('input', (e) => this.input(e));
    $('ai-list').addEventListener('change', (e) => this.change(e));
  }

  /** Show the screen. `watch` opens the "watch two students" section. */
  async open(watch = false): Promise<void> {
    await this.render();
    $<HTMLDetailsElement>('ai-watch').open = watch;
    if (watch) $('ai-watch').scrollIntoView({ block: 'nearest' });
  }

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

  private note(text: string, ms = 4000): void {
    const el = $('ai-status');
    el.textContent = text;
    if (ms > 0) setTimeout(() => el.textContent === text && (el.textContent = ''), ms);
  }

  async render(): Promise<void> {
    const list = await this.store.list();
    const host = $('ai-list');
    // do not rebuild a card while someone is typing in it
    if (host.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text') return;
    host.replaceChildren(...list.map((p) => this.card(p)));

    const options = list.map((p) => new Option(p.name, p.id));
    const fill = (id: string, pick: number): void => {
      const sel = $<HTMLSelectElement>(id);
      const keep = sel.value;
      sel.replaceChildren(...options.map((o) => o.cloneNode(true) as HTMLOptionElement));
      sel.value = list.some((p) => p.id === keep) ? keep : (list[pick] ?? list[0])?.id ?? '';
    };
    fill('watch-a', 0);
    fill('watch-b', 1);

    const bases = (await this.store.baseIndex().catch(() => null))?.personas ?? [];
    const sel = $<HTMLSelectElement>('new-base');
    if (sel.options.length !== bases.length) sel.replaceChildren(...bases.map((b) => new Option(`${b.name} · ${b.blurb.split('.')[0]}`, b.id)));
  }

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
      </div>`;
    (el.querySelector('.pname') as HTMLInputElement).value = p.name;
    const blurb = el.querySelector('.blurb') as HTMLElement;
    blurb.textContent = p.stats.stale
      ? 'The game changed, so this student went back to its starting brain.'
      : p.stats.generation === 0
        ? total === 0
          ? 'Fresh. Play it and it starts studying you.'
          : 'Has not learned anything new yet.'
        : `Learned ${p.stats.generation} time${p.stats.generation === 1 ? '' : 's'} from ${p.stats.studied.toLocaleString()} of your decisions.`;
    const rnd = el.querySelector('[data-k="randomness"]') as HTMLInputElement;
    rnd.value = String(Math.round(p.settings.randomness * 100));
    (rnd.nextElementSibling as HTMLOutputElement).textContent = `${rnd.value}%`;
    const rea = el.querySelector('[data-k="reaction"]') as HTMLInputElement;
    rea.value = String(p.settings.reaction);
    (rea.nextElementSibling as HTMLOutputElement).textContent = ms(p.settings.reaction);
    return el;
  }

  private idOf(target: EventTarget | null): string | null {
    return (target as HTMLElement | null)?.closest<HTMLElement>('.card')?.dataset.id ?? null;
  }

  private async click(e: Event): Promise<void> {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
    const id = this.idOf(e.target);
    if (!btn || !id) return;
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

  /** Sliders: update the readout straight away and save a moment after the last change. */
  private input(e: Event): void {
    const t = e.target as HTMLInputElement;
    const id = this.idOf(t);
    const key = t.dataset.k;
    if (!id || !key) return;
    const out = t.nextElementSibling as HTMLOutputElement;
    const patch = key === 'randomness' ? { randomness: Number(t.value) / 100 } : { reaction: Number(t.value) };
    out.textContent = key === 'randomness' ? `${t.value}%` : ms(Number(t.value));
    this.ai.applySettings(id, patch as never);
    clearTimeout(this.timers.get(id + key));
    this.timers.set(id + key, setTimeout(() => void this.store.updateSettings(id, patch), 250));
  }

  private change(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (!t.classList.contains('pname')) return;
    const id = this.idOf(t);
    if (id) void this.store.rename(id, t.value).then(() => this.render());
  }

  private async create(): Promise<void> {
    const base = $<HTMLSelectElement>('new-base').value;
    const nameEl = $<HTMLInputElement>('new-name');
    try {
      const row = await this.store.create(base, nameEl.value);
      nameEl.value = '';
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
      this.note(`${row.name} imported`);
      await this.render();
    } catch (err) {
      this.note(err instanceof Error ? err.message : String(err), 6000);
    }
  }
}
