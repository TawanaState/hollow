import { IMPACT, tierAtLeast } from '../content/impacts.ts';
import type { FxStep } from '../content/vfx.ts';
import { VFX } from '../content/vfx.ts';
import type { FighterId } from '../core/types.ts';
import type { FxContext } from './director.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const rand = (): number => Math.random();

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

interface Effect {
  age: number;
  dur: number;
  /** p = age/dur in 0..1 */
  tick(p: number): void;
  end(): void;
}

/** A full-screen overlay whose opacity follows a curve over time. */
class Overlay {
  private age = 0;
  private dur = 0;
  private peak = 0;
  private shape: (p: number) => number = (p) => 1 - p;
  private shown = -1;
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  /** Replace only if stronger than what is already showing. */
  trigger(peak: number, dur: number, shape?: (p: number) => number): void {
    const left = this.dur > 0 ? this.peak * this.shape(this.age / this.dur) : 0;
    if (peak < left) return;
    this.age = 0;
    this.dur = dur;
    this.peak = peak;
    if (shape) this.shape = shape;
    else this.shape = (p) => 1 - p;
  }

  update(dtF: number): void {
    let v = 0;
    if (this.dur > 0) {
      this.age += dtF;
      if (this.age >= this.dur) this.dur = 0;
      else v = this.peak * this.shape(this.age / this.dur);
    }
    const rounded = Math.round(v * 100) / 100;
    if (rounded !== this.shown) {
      this.el.style.opacity = String(rounded);
      this.shown = rounded;
    }
  }
}

export interface VfxTargets {
  /** SVG group (screen-flipped world space) where spark/ring/dust/text are drawn. */
  layer: SVGGElement;
  flash: HTMLElement;
  invert: HTMLElement;
  focus: HTMLElement;
  speed: HTMLElement;
  vignette: HTMLElement;
}

/**
 * Plays the recipes in content/vfx.ts. All durations are F. `update` takes two clocks:
 * `real` (wall-clock F) and `scaled` (slowed by slow-mo). Visual effects follow the
 * scaled clock so slow-mo slows them too; slow-mo itself runs on the real one.
 */
export class Vfx {
  /** The loop multiplies sim speed by this. 1 = normal, <1 = slow-mo. */
  timeScale = 1;
  /** Extra camera zoom (fraction): punches and dollies together. */
  zoomPunch = 0;
  /** Camera is pulled toward this world point (weight 0..1), or null. */
  cameraFocus: { x: number; y: number; w: number } | null = null;
  /** Camera roll in degrees. */
  roll = 0;
  shakeX = 0;
  shakeY = 0;

  private effects: Effect[] = [];
  private shakes: { amp: number; dur: number; age: number; dir: number }[] = [];
  private zooms: { amt: number; dur: number; age: number }[] = [];
  private dollies: { x: number; y: number; amt: number; pan: number; dur: number; age: number }[] = [];
  private tilts: { deg: number; dir: number; dur: number; age: number }[] = [];
  private slow: { scale: number; left: number; total: number }[] = [];
  private jitters: Record<number, { amp: number; left: number }> = {};
  private tickCount = 0;
  private readonly flash: Overlay;
  private readonly invert: Overlay;
  private readonly focus: Overlay;
  private readonly speed: Overlay;
  private readonly vignette: Overlay;
  private readonly layer: SVGGElement;

  constructor(t: VfxTargets) {
    this.layer = t.layer;
    this.flash = new Overlay(t.flash);
    this.invert = new Overlay(t.invert);
    this.focus = new Overlay(t.focus);
    this.speed = new Overlay(t.speed);
    this.vignette = new Overlay(t.vignette);
  }

  /** Play every recipe for these keys (plus '<key>.<tier>' extras). */
  fire(keys: string[], ctx: FxContext): void {
    for (const key of keys) {
      for (const k of [key, `${key}.${ctx.tier}`]) {
        for (const step of VFX[k] ?? []) {
          if (step.minTier && !tierAtLeast(ctx.tier, step.minTier)) continue;
          this.play(step, ctx);
        }
      }
    }
  }

  /** Random offset for a fighter frozen by hitstop (the victim trembles). */
  jitterFor(id: FighterId): { x: number; y: number } {
    const j = this.jitters[id];
    if (!j || j.left <= 0) return { x: 0, y: 0 };
    return { x: (rand() * 2 - 1) * j.amp, y: (rand() * 2 - 1) * j.amp * 0.5 };
  }

  private play(step: FxStep, c: FxContext): void {
    const power = IMPACT[c.tier].power;
    switch (step.fx) {
      case 'shake':
        this.shakes.push({ amp: step.amp * power, dur: step.dur, age: 0, dir: c.dir });
        break;
      case 'jitter':
        if (c.victim !== undefined) this.jitters[c.victim] = { amp: step.amp * power, left: Math.max(1, c.hitstop) };
        break;
      case 'zoom':
        this.zooms.push({ amt: step.amt * power, dur: step.dur, age: 0 });
        break;
      case 'dolly':
        this.dollies.push({ x: c.x, y: c.y, amt: step.amt * power, pan: step.pan, dur: step.dur, age: 0 });
        break;
      case 'tilt':
        this.tilts.push({ deg: step.deg * power, dir: c.dir, dur: step.dur, age: 0 });
        break;
      case 'slowmo':
        this.slow.push({ scale: step.scale, left: step.dur, total: step.dur });
        break;
      case 'flash':
        this.flash.trigger(step.alpha, step.dur);
        break;
      case 'invert':
        this.invert.trigger(1, step.dur, (p) => (p < 1 ? 1 : 0));
        break;
      case 'focus':
        this.focus.trigger(0.85, step.dur);
        break;
      case 'speed':
        this.speed.trigger(0.8, step.dur);
        break;
      case 'vignette':
        this.vignette.trigger(step.alpha, step.dur, (p) => Math.sqrt(1 - p));
        break;
      case 'spark':
        this.spark(c, step.n, step.len * power, step.dur, power);
        break;
      case 'ring':
        this.ring(c, step.r * power, step.dur);
        break;
      case 'dust':
        this.dust(c, step.n, step.dur);
        break;
      case 'text':
        this.text(c, step.text, step.size, step.dur);
        break;
    }
  }

  update(realF: number, scaledF: number): void {
    this.tickCount++;
    // slow-mo (real clock)
    let ts = 1;
    for (const s of this.slow) {
      s.left -= realF;
      const p = 1 - s.left / s.total; // 0..1
      const back = p > 0.7 ? (p - 0.7) / 0.3 : 0; // ease back to normal speed at the end
      ts = Math.min(ts, s.scale + (1 - s.scale) * back * back);
    }
    this.slow = this.slow.filter((s) => s.left > 0);
    this.timeScale = ts;

    for (const id of Object.keys(this.jitters)) this.jitters[Number(id)].left -= realF;

    // shake
    let sx = 0;
    let sy = 0;
    const sign = this.tickCount % 2 ? 1 : -1;
    for (const s of this.shakes) {
      s.age += scaledF;
      const k = Math.max(0, 1 - s.age / s.dur);
      const amp = s.amp * k * k;
      sx += (sign * (0.6 + 0.4 * rand()) + s.dir * 0.4) * amp;
      sy += (rand() * 2 - 1) * amp * 0.6;
    }
    this.shakes = this.shakes.filter((s) => s.age < s.dur);
    this.shakeX = sx;
    this.shakeY = sy;

    // zoom punch
    let z = 0;
    for (const p of this.zooms) {
      p.age += scaledF;
      const k = Math.max(0, 1 - p.age / p.dur);
      z += p.amt * k * k;
    }
    this.zooms = this.zooms.filter((p) => p.age < p.dur);

    // dolly: snaps in fast, eases out. The strongest one decides where the camera leans.
    let focus: { x: number; y: number; w: number } | null = null;
    for (const d of this.dollies) {
      d.age += scaledF;
      const p = Math.min(1, d.age / d.dur);
      const env = p < 0.12 ? p / 0.12 : Math.pow(1 - (p - 0.12) / 0.88, 1.5);
      z += d.amt * env;
      const w = d.pan * env;
      if (!focus || w > focus.w) focus = { x: d.x, y: d.y, w };
    }
    this.dollies = this.dollies.filter((d) => d.age < d.dur);
    this.cameraFocus = focus;
    this.zoomPunch = z;

    // tilt: kicks over in the direction of the blow, settles back
    let roll = 0;
    for (const t of this.tilts) {
      t.age += scaledF;
      const k = Math.max(0, 1 - t.age / t.dur);
      roll += t.dir * t.deg * k * k;
    }
    this.tilts = this.tilts.filter((t) => t.age < t.dur);
    this.roll = roll;

    for (const o of [this.flash, this.invert, this.focus, this.speed, this.vignette]) o.update(scaledF);

    for (const e of this.effects) {
      e.age += scaledF;
      if (e.age >= e.dur) e.end();
      else e.tick(e.age / e.dur);
    }
    this.effects = this.effects.filter((e) => e.age < e.dur);
  }

  /** Remove everything (e.g. when a new round starts). */
  clear(): void {
    for (const e of this.effects) e.end();
    this.effects = [];
    this.shakes = [];
    this.zooms = [];
    this.dollies = [];
    this.tilts = [];
    this.cameraFocus = null;
    this.roll = 0;
    this.zoomPunch = 0;
    this.slow = [];
    this.timeScale = 1;
  }

  private add(e: Effect): void {
    if (this.effects.length > 80) this.effects.shift()?.end();
    this.effects.push(e);
  }

  // ── effect builders ──

  private spark(c: FxContext, n: number, len: number, dur: number, power: number): void {
    const g = svg('g', { transform: `translate(${c.x} ${-c.y})` });
    const core = svg('circle', { class: 'fx-core' });
    g.appendChild(core);
    const rays = Array.from({ length: n }, (_, i) => ({
      el: g.appendChild(svg('polygon', { class: 'fx-ray' })),
      a: (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.7,
      l: len * (0.55 + 0.45 * rand()),
    }));
    this.layer.appendChild(g);
    this.add({
      age: 0,
      dur,
      tick: (p) => {
        const w = 7 * power * (1 - p) + 0.5;
        for (const r of rays) {
          const r1 = r.l * easeOut(p);
          const r0 = r1 * (0.15 + 0.8 * p * p);
          const cx = Math.cos(r.a);
          const cy = Math.sin(r.a);
          const nx = -cy * w;
          const ny = cx * w;
          r.el.setAttribute(
            'points',
            `${(cx * r0 + nx).toFixed(1)},${(cy * r0 + ny).toFixed(1)} ${(cx * r1).toFixed(1)},${(cy * r1).toFixed(1)} ${(cx * r0 - nx).toFixed(1)},${(cy * r0 - ny).toFixed(1)}`,
          );
        }
        core.setAttribute('r', (26 * power * (1 - p) * (1 - p)).toFixed(1));
      },
      end: () => g.remove(),
    });
  }

  private ring(c: FxContext, radius: number, dur: number): void {
    const el = svg('circle', { class: 'fx-ring', cx: c.x, cy: -c.y });
    this.layer.appendChild(el);
    this.add({
      age: 0,
      dur,
      tick: (p) => {
        el.setAttribute('r', (radius * easeOut(p)).toFixed(1));
        el.setAttribute('stroke-width', (9 * (1 - p) + 0.5).toFixed(1));
        el.setAttribute('opacity', (1 - p).toFixed(2));
      },
      end: () => el.remove(),
    });
  }

  private dust(c: FxContext, n: number, dur: number): void {
    const puffs = Array.from({ length: n }, () => ({
      el: this.layer.appendChild(svg('circle', { class: 'fx-dust', cx: c.x, cy: -c.y - 4 })),
      vx: (rand() * 2 - 1) * 60,
      vy: 10 + rand() * 30,
      r: 6 + rand() * 8,
    }));
    this.add({
      age: 0,
      dur,
      tick: (p) => {
        for (const d of puffs) {
          d.el.setAttribute('cx', (c.x + d.vx * easeOut(p)).toFixed(1));
          d.el.setAttribute('cy', (-c.y - 4 - d.vy * easeOut(p)).toFixed(1));
          d.el.setAttribute('r', (d.r * (1 + p)).toFixed(1));
          d.el.setAttribute('opacity', (0.5 * (1 - p)).toFixed(2));
        }
      },
      end: () => puffs.forEach((d) => d.el.remove()),
    });
  }

  private text(c: FxContext, text: string, size: number, dur: number): void {
    const el = svg('text', { class: 'fx-text', 'font-size': size, 'text-anchor': 'middle' });
    el.textContent = text;
    this.layer.appendChild(el);
    const baseY = -c.y - 90;
    this.add({
      age: 0,
      dur,
      tick: (p) => {
        const pop = p < 0.18 ? 1 + 0.6 * (1 - p / 0.18) : 1;
        const rise = 50 * easeOut(p);
        const alpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
        el.setAttribute('transform', `translate(${c.x} ${baseY - rise}) rotate(-5) scale(${pop.toFixed(3)})`);
        el.setAttribute('opacity', alpha.toFixed(2));
      },
      end: () => el.remove(),
    });
  }
}
