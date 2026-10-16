import '../style.css';
import { Audio } from '../client/audio.ts';
import { ANNOUNCER_LINES, SFX } from '../content/sfx.ts';

/**
 * Dev tool: click any sound to hear it exactly as the game plays it (layers, random variants,
 * pitch, reverb), change the combo count and stereo position, or play a scripted fight.
 * Open /sounds.html while `npm run dev` is running.
 */
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const style = document.createElement('style');
style.textContent = `
  body.sandbox{overflow:auto;touch-action:auto;user-select:text;height:auto}
  .sandbox header{position:sticky;top:0;z-index:2;display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--panel-line)}
  .sandbox header a{color:var(--text)}
  .sandbox header a:last-child{margin-left:auto}
  .board{padding:16px;display:grid;gap:18px;max-width:1000px;margin:0 auto}
  .board h3{margin:0 0 8px;font:700 12px 'Segoe UI',sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--text-dim)}
  .board .row{display:flex;flex-wrap:wrap;gap:8px}
  .board button{border:2px solid var(--ink);background:transparent;color:var(--text);padding:8px 12px;font:600 13px 'Segoe UI',sans-serif;cursor:pointer}
  .board button:hover,.board button.primary{background:var(--ink);color:var(--sky-top)}
  .board button:active{transform:scale(.96)}
`;
document.head.appendChild(style);

const audio = new Audio();
audio.prepare();
audio.listener = () => 0;

const status = $('status');
const refresh = (): void => {
  status.textContent = audio.samplesLoaded > 0 ? `${audio.samplesLoaded} recordings loaded` : 'loading sounds…';
};
setInterval(refresh, 400);
refresh();

const pan = (): number => Number($<HTMLInputElement>('pan').value) / 100;
const combo = (): number => Number($<HTMLSelectElement>('combo').value);
$<HTMLInputElement>('vol').addEventListener('input', (e) => audio.setVolume(Number((e.target as HTMLInputElement).value) / 100));

const GROUPS: [string, (k: string) => boolean][] = [
  ['Hits', (k) => k.startsWith('hit.') || k === 'counter'],
  ['Defence', (k) => k.startsWith('block.') || k === 'parry' || k === 'guardBreak'],
  ['Moves', (k) => k.startsWith('skill.') || ['dash', 'jump', 'step'].includes(k) || k.startsWith('land.') || k === 'knockdown'],
  ['Big moments', (k) => ['ko', 'roundStart', 'roundGo', 'energyReady', 'heartbeat'].includes(k)],
  ['Interface', (k) => k.startsWith('ui.')],
];

const host = $('groups');
for (const [title, test] of GROUPS) {
  const section = document.createElement('section');
  section.innerHTML = `<h3>${title}</h3><div class="row"></div>`;
  const row = section.querySelector('.row')!;
  for (const key of Object.keys(SFX).filter(test)) {
    const b = document.createElement('button');
    b.textContent = key;
    b.onclick = () => {
      audio.unlock();
      audio.play(key, { pan: pan(), combo: combo() });
    };
    row.appendChild(b);
  }
  host.appendChild(section);
}
const voice = document.createElement('section');
voice.innerHTML = '<h3>Announcer</h3><div class="row"></div>';
for (const line of ANNOUNCER_LINES) {
  const b = document.createElement('button');
  b.textContent = line;
  b.onclick = () => {
    audio.unlock();
    audio.say(line);
  };
  voice.querySelector('.row')!.appendChild(b);
}
host.appendChild(voice);

// ── a scripted fight, in context ──
type Step = [ms: number, play: () => void];
const p = (key: string, o: { pan?: number; combo?: number } = {}) => () => audio.play(key, o);
const say = (line: string) => () => audio.say(line);
const FIGHT: Step[] = [
  [0, p('roundStart')],
  [150, say('round-1')],
  [1400, p('roundGo')],
  [1450, say('fight')],
  [2600, p('dash', { pan: -0.3 })],
  [3000, p('skill.light', { pan: -0.2 })],
  [3150, p('hit.light', { pan: 0.1, combo: 1 })],
  [3450, p('skill.light')],
  [3600, p('hit.light', { pan: 0.1, combo: 2 })],
  [3900, p('skill.medium')],
  [4050, p('hit.medium', { pan: 0.1, combo: 3 })],
  [4400, p('skill.heavy')],
  [4600, p('hit.heavy', { pan: 0.15, combo: 4 })],
  [5300, p('knockdown', { pan: 0.4 })],
  [6300, p('skill.light', { pan: 0.3 })],
  [6420, p('block.light', { pan: -0.2 })],
  [6900, p('skill.heavy', { pan: 0.3 })],
  [7050, p('block.heavy', { pan: -0.2 })],
  [7700, p('skill.light', { pan: 0.3 })],
  [7800, p('parry', { pan: -0.2 })],
  [8500, p('jump', { pan: -0.4 })],
  [9000, p('land.medium', { pan: -0.1 })],
  [9700, p('skill.crush')],
  [9950, p('hit.crush', { combo: 1 })],
  [10100, p('counter')],
  [10800, p('guardBreak', { pan: 0.2 })],
  [11800, p('hit.heavy', { combo: 5 })],
  [11830, say('combo')],
  [12700, p('hit.crush', { combo: 6 })],
  [12760, p('ko', { pan: 0.3 })],
  [14200, say('you-win')],
];
let timers: number[] = [];
const stop = (): void => {
  timers.forEach(clearTimeout);
  timers = [];
};
$('demo-fight').onclick = () => {
  audio.unlock();
  stop();
  for (const [ms, fn] of FIGHT) timers.push(window.setTimeout(fn, ms));
};
$('demo-stop').onclick = stop;
