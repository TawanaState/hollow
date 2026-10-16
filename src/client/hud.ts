import { RULES } from '../content/config.ts';
import type { FighterId, GameEvent, World } from '../core/index.ts';

const NAMES = ['RED', 'INK'];

interface Side {
  root: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  guard: HTMLElement;
  energy: HTMLElement;
  score: HTMLElement;
  combo: HTMLElement;
  ghostHp: number;
  ghostDelay: number;
  lastHp: number;
  comboFade: number;
}

/** Health/guard/energy bars, combo counters and the centre banner. Pure DOM, driven by the world + events. */
export class Hud {
  private readonly sides: [Side, Side];
  private readonly banner: HTMLElement;
  private readonly status: HTMLElement;

  constructor(root: HTMLElement) {
    const side = (i: number): Side => {
      const el = root.querySelector<HTMLElement>(`.bar[data-p="${i}"]`)!;
      const q = (sel: string) => el.querySelector<HTMLElement>(sel)!;
      q('.name').textContent = NAMES[i];
      return {
        root: el,
        fill: q('.hp .fill'),
        ghost: q('.hp .ghost'),
        guard: q('.guard i'),
        energy: q('.energy i'),
        score: q('.score'),
        combo: root.querySelector<HTMLElement>(`.combo[data-p="${i}"]`)!,
        ghostHp: 0,
        ghostDelay: 0,
        lastHp: 0,
        comboFade: 0,
      };
    };
    this.sides = [side(0), side(1)];
    this.banner = root.querySelector<HTMLElement>('#banner')!;
    this.status = root.querySelector<HTMLElement>('#status')!;
  }

  /** Free-text line under the bars (online status, "waiting for opponent"...). */
  setStatus(text: string): void {
    this.status.textContent = text;
    this.status.hidden = text === '';
  }

  /** Rename the two bars (e.g. "YOU" / "OPPONENT"). */
  setNames(a: string, b: string): void {
    this.sides[0].root.querySelector('.name')!.textContent = a;
    this.sides[1].root.querySelector('.name')!.textContent = b;
  }

  onEvent(e: GameEvent): void {
    switch (e.t) {
      case 'ROUND_START':
        this.show('READY', 'ready');
        break;
      case 'ROUND_GO':
        this.show('FIGHT', 'go');
        break;
      case 'KO':
        this.show('K.O.', 'ko');
        break;
      case 'HIT':
        if (e.combo >= 2) this.showCombo(e.atk, e.combo, e.comboDamage);
        break;
      case 'COMBO_END':
        // the victim's combo ended: let the attacker's counter fade out
        this.sides[e.id === 0 ? 1 : 0].comboFade = 70;
        break;
      default:
        break;
    }
  }

  update(w: World, dtF: number): void {
    for (const f of w.fighters) {
      const s = this.sides[f.id];
      const hp = f.hp / f.maxHp;
      if (f.hp < s.lastHp) s.ghostDelay = 24;
      if (f.hp > s.lastHp || s.ghostHp === 0) s.ghostHp = f.hp;
      s.lastHp = f.hp;
      if (s.ghostDelay > 0) s.ghostDelay -= dtF;
      else if (s.ghostHp > f.hp) s.ghostHp = Math.max(f.hp, s.ghostHp - f.maxHp * 0.012 * dtF);
      s.fill.style.transform = `scaleX(${hp})`;
      s.ghost.style.transform = `scaleX(${s.ghostHp / f.maxHp})`;
      s.guard.style.transform = `scaleX(${f.guard / RULES.maxGuard})`;
      s.guard.parentElement!.classList.toggle('low', f.guard < 25);
      s.energy.style.transform = `scaleX(${f.energy / RULES.maxEnergy})`;
      s.energy.parentElement!.classList.toggle('full', f.energy >= RULES.maxEnergy);
      s.score.textContent = '●'.repeat(w.score[f.id]);
      if (s.comboFade > 0) {
        s.comboFade -= dtF;
        if (s.comboFade <= 0) s.combo.classList.remove('show');
      }
    }
  }

  private show(text: string, cls: string): void {
    const b = this.banner;
    b.textContent = text;
    b.className = '';
    void b.offsetWidth; // restart the CSS animation
    b.className = `show ${cls}`;
  }

  private showCombo(attacker: FighterId, hits: number, damage: number): void {
    const s = this.sides[attacker];
    s.combo.innerHTML = `<b>${hits}</b> HITS<small>${damage} dmg</small>`;
    s.combo.classList.remove('show');
    void s.combo.offsetWidth;
    s.combo.classList.add('show');
    s.comboFade = 0;
  }
}
