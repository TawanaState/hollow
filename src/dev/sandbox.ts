import '../style.css';
import { ANIMS } from '../content/anims.ts';
import { POSES } from '../content/poses.ts';
import { SKILL_ANIMS } from '../content/skills.ts';
import type { AnimDef, Pose } from '../content/types.ts';
import { samplePose } from '../client/anim.ts';
import { Figure } from '../client/figure.ts';
import { placeJoints } from '../client/skeleton.ts';

/**
 * Dev tool: see every pose and animation, drag the joint sliders, copy the result as code.
 * Open /sandbox.html while `npm run dev` is running.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const style = document.createElement('style');
style.textContent = `
  body.sandbox{overflow:auto;touch-action:auto;user-select:text;height:auto}
  .sandbox header{position:sticky;top:0;z-index:2;display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--panel-line)}
  .sandbox header a{margin-left:auto;color:var(--text)}
  .sandbox main{display:grid;grid-template-columns:1fr 340px;gap:16px;padding:16px}
  @media (max-width:800px){.sandbox main{grid-template-columns:1fr}}
  #grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;align-content:start}
  .cell{border:1px solid var(--panel-line);background:var(--panel);cursor:pointer;padding:0;color:var(--text)}
  .cell.on{border-color:var(--p1);border-width:2px}
  .cell svg{width:100%;height:150px;display:block}
  .cell span{display:block;font:11px monospace;padding:2px 6px 5px}
  aside{position:sticky;top:60px;align-self:start}
  #big{width:100%;border:1px solid var(--panel-line);background:linear-gradient(var(--sky-top),var(--sky-bottom))}
  #sliders label{display:grid;grid-template-columns:96px 1fr 40px;font:11px monospace;align-items:center;gap:6px}
  #code{font:11px monospace;white-space:pre-wrap;background:var(--panel);padding:8px;border:1px solid var(--panel-line)}
  aside button{margin:8px 0;padding:6px 12px}
`;
document.head.appendChild(style);

const KEYS = [
  'lean', 'head', 'shift', 'roll', 'frontArm', 'frontForearm', 'backArm', 'backForearm',
  'frontThigh', 'frontShin', 'backThigh', 'backShin',
] as const satisfies readonly (keyof Pose)[];

function paint(fig: Figure, pose: Pose, facing: 1 | -1 = 1): void {
  fig.draw(placeJoints(pose, facing, 0, 0), facing);
}

function makeSvg(viewBox: string): { svg: SVGSVGElement; fig: Figure } {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', '-200');
  line.setAttribute('x2', '200');
  line.setAttribute('class', 'floor-line');
  svg.appendChild(line);
  const fig = new Figure('p1');
  svg.appendChild(fig.g);
  return { svg, fig };
}

// ── gallery ──
let selected = '';
let working: Pose = { ...POSES.stand };
const cells = new Map<string, { fig: Figure; btn: HTMLElement }>();
for (const [name, pose] of Object.entries(POSES)) {
  const btn = document.createElement('button');
  btn.className = 'cell';
  const { svg, fig } = makeSvg('-150 -200 300 210');
  paint(fig, pose);
  btn.append(svg);
  const label = document.createElement('span');
  label.textContent = name;
  btn.append(label);
  btn.onclick = () => select(name);
  $('grid').appendChild(btn);
  cells.set(name, { fig, btn });
}

// ── editor ──
const big = makeSvg('-160 -230 320 260');
$('big').replaceWith(big.svg);
big.svg.id = 'big';
const sliders = new Map<keyof Pose, HTMLInputElement>();
for (const key of KEYS) {
  const row = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = key;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = key === 'shift' ? '-80' : '-180';
  input.max = key === 'shift' ? '80' : '180';
  const out = document.createElement('span');
  input.oninput = () => {
    working[key] = Number(input.value);
    out.textContent = input.value;
    refresh();
  };
  row.append(name, input, out);
  $('sliders').appendChild(row);
  sliders.set(key, input);
}

function refresh(): void {
  paint(big.fig, working);
  $('code').textContent = `{ ${KEYS.map((k) => `${k}: ${Math.round(working[k])}`).join(', ')} }`;
  if (selected && cells.has(selected)) paint(cells.get(selected)!.fig, working);
}

function select(name: string): void {
  selected = name;
  working = { ...POSES[name as keyof typeof POSES] };
  for (const [n, c] of cells) c.btn.classList.toggle('on', n === name);
  $('sel').textContent = name;
  for (const key of KEYS) {
    sliders.get(key)!.value = String(working[key]);
    (sliders.get(key)!.nextSibling as HTMLElement).textContent = String(Math.round(working[key]));
  }
  refresh();
}
$('copy').onclick = () => void navigator.clipboard?.writeText($('code').textContent ?? '');
select('stand');

// ── animation player ──
const all: Record<string, AnimDef> = { ...ANIMS };
for (const [id, a] of Object.entries(SKILL_ANIMS)) all[`skill:${id}`] = a;
const picker = $<HTMLSelectElement>('anim');
picker.add(new Option('— none (editing pose) —', ''));
for (const id of Object.keys(all)) picker.add(new Option(id, id));
let t = 0;
let last = performance.now();
function loop(now: number): void {
  const dtF = (now - last) / (1000 / 60);
  last = now;
  const a = all[picker.value];
  if (a) {
    const scrub = $<HTMLInputElement>('scrub');
    if ($<HTMLInputElement>('play').checked) {
      t += dtF;
      if (t > a.duration) t = a.loop ? t - a.duration : 0;
      scrub.value = String((t / a.duration) * 100);
    } else {
      t = (Number(scrub.value) / 100) * a.duration;
    }
    paint(big.fig, samplePose(a, t));
    $('time').textContent = `${t.toFixed(1)} / ${a.duration}F`;
  } else {
    $('time').textContent = '';
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
