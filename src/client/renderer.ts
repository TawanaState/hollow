import { RULES, STAGE } from '../content/config.ts';
import { SKILLS } from '../content/skills.ts';
import { hitRects, hurtRect } from '../core/sim.ts';
import type { Fighter, Rect, World } from '../core/types.ts';
import { applyFatigue, fatigueOf, pickAnim, lerpPose, samplePose } from './anim.ts';
import { Camera, VIEW } from './camera.ts';
import { Figure } from './figure.ts';
import { Habits } from './habits.ts';
import { placeJoints } from './skeleton.ts';
import type { Vfx } from './vfx.ts';
import type { Pose } from '../content/types.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const STAGE_MARKUP = `
<svg id="stage" viewBox="0 0 ${VIEW.w} ${VIEW.h}" preserveAspectRatio="xMidYMid slice" overflow="visible">
  <defs>
    <linearGradient id="sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${VIEW.h}">
      <stop offset="0" style="stop-color:var(--sky-top)"/>
      <stop offset="1" style="stop-color:var(--sky-bottom)"/>
    </linearGradient>
    <linearGradient id="reflect-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:var(--floor);stop-opacity:0"/>
      <stop offset="1" style="stop-color:var(--floor);stop-opacity:1"/>
    </linearGradient>
  </defs>
  <rect x="-6000" y="-6000" width="13600" height="12900" fill="url(#sky)"/>
  <g id="parallax"><circle class="bg-ring" cx="${VIEW.w / 2}" cy="430" r="430"/></g>
  <g id="cam">
    <rect x="-9000" y="0" width="18000" height="9000" style="fill:var(--floor)"/>
    <g id="reflection" transform="scale(1 -1)" opacity="0.2"><use href="#figs"/></g>
    <rect x="-9000" y="0" width="18000" height="260" fill="url(#reflect-fade)"/>
    <line class="floor-line" x1="-9000" y1="0" x2="9000" y2="0"/>
    <g id="shadows"></g>
    <g id="figs"></g>
    <g id="fx"></g>
    <g id="debug"></g>
  </g>
</svg>`;

/** Smoothly changes between animations by blending from the last drawn pose. */
class PoseBlender {
  private id = '';
  private from: Pose | null = null;
  private last: Pose | null = null;
  private t = 0;
  private dur = 3;

  pose(id: string, target: Pose, blend: number, dtF: number): Pose {
    if (id !== this.id) {
      this.id = id;
      this.from = this.last;
      this.t = 0;
      this.dur = Math.max(0.01, blend);
    }
    this.t += dtF;
    let out = target;
    if (this.from && this.t < this.dur) {
      const k = this.t / this.dur;
      out = lerpPose(this.from, target, k * k * (3 - 2 * k));
    }
    this.last = out;
    return out;
  }
}

interface FighterView {
  fig: Figure;
  blender: PoseBlender;
  habits: Habits;
  /** 0 fresh, 1 exhausted; eased so the posture changes gradually. */
  fatigue: number;
  shadow: SVGEllipseElement;
  ghosts: Figure[];
  ghostAge: number[];
  nextGhost: number;
  lastGhostAt: number;
}

const GHOSTS = 6;

export class Renderer {
  readonly camera = new Camera();
  readonly fxLayer: SVGGElement;
  debug = false;
  private readonly cam: SVGGElement;
  private readonly parallax: SVGGElement;
  private readonly debugLayer: SVGGElement;
  private readonly views: [FighterView, FighterView];
  private prev: { x: number; y: number }[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  private frame = 0;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML('afterbegin', STAGE_MARKUP);
    const q = <T extends Element>(sel: string): T => root.querySelector(sel) as T;
    this.cam = q('#cam');
    this.parallax = q('#parallax');
    this.fxLayer = q('#fx');
    this.debugLayer = q('#debug');
    const figs = q<SVGGElement>('#figs');
    const shadows = q<SVGGElement>('#shadows');
    const make = (cls: string): FighterView => {
      const seed = Math.floor(Math.random() * 2 ** 32);
      const ghosts = Array.from({ length: GHOSTS }, () => {
        const g = new Figure(`${cls} ghost`, seed);
        g.g.setAttribute('opacity', '0');
        figs.appendChild(g.g);
        return g;
      });
      const shadow = document.createElementNS(SVG_NS, 'ellipse');
      shadow.setAttribute('class', 'shadow');
      shadows.appendChild(shadow);
      const fig = new Figure(cls, seed);
      figs.appendChild(fig.g);
      return { fig, blender: new PoseBlender(), habits: new Habits(seed ^ 0x9e3779b9), fatigue: 0, shadow, ghosts, ghostAge: ghosts.map(() => 99), nextGhost: 0, lastGhostAt: -99 };
    };
    this.views = [make('p1'), make('p2')];

    // The view fills the whole screen (cropping the top/bottom on very wide phones). On narrower
    // screens the sides are cropped instead, so tell the camera how much width it really has.
    const fit = (): void => {
      const r = root.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) this.camera.visibleW = Math.min(VIEW.w, VIEW.h * (r.width / r.height));
    };
    new ResizeObserver(fit).observe(root);
    fit();
  }

  /** Remember where everyone is, so the next render can interpolate from here. */
  capturePrev(w: World): void {
    for (const f of w.fighters) this.prev[f.id] = { x: f.x, y: f.y };
  }

  snapCamera(w: World): void {
    this.camera.snap(w);
    this.capturePrev(w);
  }

  /**
   * Draw one frame. `alpha` is how far we are between the last sim step and the next (0..1).
   * `dtF` is the elapsed time in F on the scaled clock.
   */
  render(w: World, alpha: number, dtF: number, vfx: Vfx): void {
    this.frame++;
    const frozen = w.hitstop > 0;
    const a = frozen ? 0 : alpha;

    for (const f of w.fighters) this.drawFighter(f, w, a, dtF, vfx);

    const cam = this.camera;
    cam.update(w, dtF, {
      zoom: vfx.zoomPunch,
      focus: vfx.cameraFocus,
      roll: vfx.roll,
      shakeX: vfx.shakeX,
      shakeY: vfx.shakeY,
    });
    this.cam.setAttribute('transform', cam.transform());
    // the big ring drifts slower than the fighters, which gives the flat stage some depth
    this.parallax.setAttribute(
      'transform',
      `translate(${(-cam.x * 0.12).toFixed(1)} ${((cam.groundScreenY - 660) * 0.35).toFixed(1)})`,
    );

    if (this.debug) this.drawDebug(w);
    else if (this.debugLayer.firstChild) this.debugLayer.replaceChildren();
  }

  private drawFighter(f: Fighter, w: World, alpha: number, dtF: number, vfx: Vfx): void {
    const v = this.views[f.id];
    const p = this.prev[f.id];
    let x = p.x + (f.x - p.x) * alpha;
    const y = p.y + (f.y - p.y) * alpha;
    let yy = y;
    if (w.hitstop > 0) {
      const j = vfx.jitterFor(f.id);
      x += j.x;
      yy += j.y;
    }
    const choice = pickAnim(f, alpha);
    // animation -> random hand habit (never the striking hand) -> fatigue -> crossfade
    let pose = samplePose(choice.anim, choice.t);
    pose = v.habits.apply(f, pose, dtF);
    const tired = fatigueOf(f.hp / RULES.maxHp, f.guard);
    v.fatigue += (tired - v.fatigue) * (1 - Math.pow(0.97, dtF));
    pose = applyFatigue(choice.id, pose, choice.t, v.fatigue);
    pose = v.blender.pose(choice.id, pose, choice.anim.blend ?? 3, dtF);
    const joints = placeJoints(pose, f.facing, x, yy);
    v.fig.draw(joints, f.facing);

    const height = Math.max(0, y);
    v.shadow.setAttribute('cx', x.toFixed(1));
    v.shadow.setAttribute('cy', '3');
    v.shadow.setAttribute('rx', Math.max(14, 44 - height * 0.12).toFixed(1));
    v.shadow.setAttribute('ry', '7');
    v.shadow.setAttribute('opacity', Math.max(0.08, 0.35 - height * 0.002).toFixed(2));

    this.updateGhosts(v, f, w, dtF);
  }

  /** Afterimages: a trailing copy every couple of frames while a trail skill or a dash runs. */
  private updateGhosts(v: FighterView, f: Fighter, w: World, dtF: number): void {
    const trailing = f.state === 'dash' || (f.state === 'attack' && !!f.skill && !!SKILLS[f.skill]?.fx?.trail);
    if (trailing && w.hitstop === 0 && this.frame - v.lastGhostAt >= 2) {
      v.lastGhostAt = this.frame;
      const g = v.ghosts[v.nextGhost];
      v.fig.copyTo(g);
      v.ghostAge[v.nextGhost] = 0;
      v.nextGhost = (v.nextGhost + 1) % GHOSTS;
    }
    for (let i = 0; i < GHOSTS; i++) {
      v.ghostAge[i] += dtF;
      const life = 14;
      const o = v.ghostAge[i] >= life ? 0 : 0.4 * (1 - v.ghostAge[i] / life);
      v.ghosts[i].g.setAttribute('opacity', o.toFixed(2));
    }
  }

  private drawDebug(w: World): void {
    const parts: string[] = [];
    const rect = (r: Rect, cls: string): string =>
      `<rect class="${cls}" x="${r.x0.toFixed(1)}" y="${(-r.y1).toFixed(1)}" width="${(r.x1 - r.x0).toFixed(1)}" height="${(r.y1 - r.y0).toFixed(1)}"/>`;
    for (const f of w.fighters) {
      parts.push(rect(hurtRect(f), 'dbg-hurt'));
      if (f.state === 'attack' && f.skill) {
        const sk = SKILLS[f.skill];
        const active = f.stateF - 1 >= sk.startup && f.stateF - 1 < sk.startup + sk.active;
        for (const r of hitRects(f, sk)) parts.push(rect(r, active ? 'dbg-hit' : 'dbg-hit-idle'));
      }
      parts.push(
        `<text class="dbg-text" x="${f.x.toFixed(0)}" y="${(-(f.y + 210)).toFixed(0)}" text-anchor="middle">${f.state}${f.skill ? ':' + f.skill : ''} ${f.stateF} · ${f.facing > 0 ? '→' : '←'}</text>`,
      );
    }
    parts.push(`<line class="dbg-wall" x1="${-STAGE.halfWidth}" y1="0" x2="${-STAGE.halfWidth}" y2="-300"/><line class="dbg-wall" x1="${STAGE.halfWidth}" y1="0" x2="${STAGE.halfWidth}" y2="-300"/>`);
    this.debugLayer.innerHTML = parts.join('');
  }
}
