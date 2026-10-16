import { createRng } from '../core/rng.ts';
import { BODY } from './skeleton.ts';
import type { Joints, Pt } from './skeleton.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * How each bone bows, as a fraction of its length. Two numbers per bone: the bend near the
 * start and near the end. Positive = toward the front of the body. Tiny on purpose (about
 * 2 units on a 40-unit bone): it takes the ruler-straight look off the lines (a quad here,
 * a calf there, the curve of the lower back) without making the figure lumpy.
 */
const BONES = {
  spine: [-0.05, 0.035],
  thigh: [0.06, 0.02],
  shin: [-0.04, 0.025],
  upperArm: [0.05, -0.01],
  foreArm: [-0.03, 0.03],
} as const;

type BoneName = keyof typeof BONES;
type Shape = Record<BoneName, [number, number]>;

/** Each figure gets its own tiny variation so two fighters are not exact copies. */
function makeShape(seed: number): Shape {
  const rng = createRng(seed);
  const out = {} as Shape;
  for (const name of Object.keys(BONES) as BoneName[]) {
    const [a, b] = BONES[name];
    out[name] = [a * rng.range(0.75, 1.25), b * rng.range(0.75, 1.25)];
  }
  return out;
}

const f1 = (n: number): string => n.toFixed(1);
const P = (p: Pt): string => `${f1(p.x)},${f1(-p.y)}`;

/**
 * One stickman as SVG: five bowed paths and a head. draw() takes joints in world space
 * (y UP) and writes SVG coordinates (y flipped). Colours come from CSS variables
 * via the `cls` class (see style.css), so a theme switch needs no JS.
 */
export class Figure {
  readonly g: SVGGElement;
  private readonly shape: Shape;
  private readonly backArm: SVGPathElement;
  private readonly backLeg: SVGPathElement;
  private readonly spine: SVGPathElement;
  private readonly head: SVGCircleElement;
  private readonly frontLeg: SVGPathElement;
  private readonly frontArm: SVGPathElement;

  constructor(cls: string, seed = 1) {
    this.shape = makeShape(seed);
    this.g = document.createElementNS(SVG_NS, 'g');
    this.g.setAttribute('class', `fig ${cls}`);
    const path = () => this.g.appendChild(document.createElementNS(SVG_NS, 'path'));
    this.backArm = path();
    this.backLeg = path();
    this.spine = path();
    this.head = this.g.appendChild(document.createElementNS(SVG_NS, 'circle'));
    this.head.setAttribute('r', f1(BODY.headR));
    this.frontLeg = path();
    this.frontArm = path();
  }

  /** A bone from a to b as a cubic curve that bows a little to one side. */
  private bone(a: Pt, b: Pt, name: BoneName, facing: 1 | -1): string {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // normal, flipped with facing so the bulge stays on the same side of the body
    const nx = -uy * facing;
    const ny = ux * facing;
    const [k1, k2] = this.shape[name];
    const c1: Pt = { x: a.x + dx * 0.33 + nx * k1 * len, y: a.y + dy * 0.33 + ny * k1 * len };
    const c2: Pt = { x: a.x + dx * 0.66 + nx * k2 * len, y: a.y + dy * 0.66 + ny * k2 * len };
    return `C${P(c1)} ${P(c2)} ${P(b)}`;
  }

  draw(j: Joints, facing: 1 | -1): void {
    const limb = (a: Pt, mid: Pt, end: Pt, upper: BoneName, lower: BoneName): string =>
      `M${P(a)} ${this.bone(a, mid, upper, facing)} ${this.bone(mid, end, lower, facing)}`;
    this.backArm.setAttribute('d', limb(j.shoulder, j.elbowB, j.handB, 'upperArm', 'foreArm'));
    this.backLeg.setAttribute('d', limb(j.hip, j.kneeB, j.footB, 'thigh', 'shin'));
    this.spine.setAttribute('d', `M${P(j.hip)} ${this.bone(j.hip, j.neck, 'spine', facing)} L${P(j.head)}`);
    this.head.setAttribute('cx', f1(j.head.x));
    this.head.setAttribute('cy', f1(-j.head.y));
    this.frontLeg.setAttribute('d', limb(j.hip, j.kneeF, j.footF, 'thigh', 'shin'));
    this.frontArm.setAttribute('d', limb(j.shoulder, j.elbowF, j.handF, 'upperArm', 'foreArm'));
  }

  /** Copy the current drawing onto another figure (afterimages). */
  copyTo(other: Figure): void {
    const copy = (from: SVGElement, to: SVGElement, attr: string): void => {
      to.setAttribute(attr, from.getAttribute(attr) ?? '');
    };
    copy(this.backArm, other.backArm, 'd');
    copy(this.backLeg, other.backLeg, 'd');
    copy(this.spine, other.spine, 'd');
    copy(this.frontLeg, other.frontLeg, 'd');
    copy(this.frontArm, other.frontArm, 'd');
    copy(this.head, other.head, 'cx');
    copy(this.head, other.head, 'cy');
  }
}
