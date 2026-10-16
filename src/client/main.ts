import '../style.css';
import logoSvg from '../assets/logo.svg?raw';
import { RULES } from '../content/config.ts';
import { assertValidContent } from '../content/validate.ts';
import { EventBus, FRAME_MS, NullSource, describeEvent } from '../core/index.ts';
import type { GameEvent, InputFrame, InputSource } from '../core/index.ts';
import { Audio } from './audio.ts';
import { cueFor } from './director.ts';
import { Hud } from './hud.ts';
import { Keyboard, P1_KEYS, P2_KEYS } from './keyboard.ts';
import { keepAwake, registerServiceWorker, setupFullscreen, setupInstall } from './pwa.ts';
import { Renderer } from './renderer.ts';
import { saveServer, savedServer, serverUrl } from './server.ts';
import { LocalSession, OnlineSession } from './session.ts';
import type { OnlineInfo, Session } from './session.ts';
import { initTheme, toggleTheme } from './theme.ts';
import { TouchPad } from './touch.ts';
import { Vfx } from './vfx.ts';
import { demoInputs } from '../dev/demo.ts';
import { ScriptedSource } from '../core/index.ts';

assertValidContent(); // a typo in content fails loudly, right here
initTheme();

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const app = $('#app');
$('#logo').innerHTML = logoSvg;

// ── systems (created once, reused across sessions) ──
const renderer = new Renderer(app);
const vfx = new Vfx({
  layer: renderer.fxLayer,
  flash: $('.fx-flash'),
  invert: $('.fx-invert'),
  focus: $('.fx-focus'),
  speed: $('.fx-speed'),
  vignette: $('.fx-vignette'),
});
const audio = new Audio();
const hud = new Hud(app);
const keyboard = new Keyboard();
const touch = new TouchPad($('#touch'));
/** Phones and tablets get on-screen controls. ?touch forces them on (handy for testing). */
const wantsTouch = (): boolean => matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
let awake = false;

/** Everything that reacts to the game subscribes here, whatever the session is. */
const bus = new EventBus();
bus.onAny((e) => {
  const cue = cueFor(e);
  if (cue) {
    vfx.fire(cue.keys, cue.ctx);
    audio.playCue(cue);
  }
  if (e.t === 'ROUND_START') vfx.clear();
  hud.onEvent(e);
  if (logging) {
    const line = describeEvent(e);
    if (line) console.log(line);
  }
});
let logging = new URLSearchParams(location.search).has('log');

/** OR several sources together (keyboard + touch). */
const merge = (...sources: InputSource[]): InputSource => ({
  kind: 'merged',
  poll: (frame): InputFrame => sources.reduce((bits, s) => bits | s.poll(frame), 0),
});

// ── sessions ──
let session: Session = new LocalSession(bus, new NullSource(), new NullSource()); // living menu backdrop
let mode: 'menu' | 'local' | 'training' | 'online' = 'menu';
let roomName = 'lobby';

function begin(next: Session, label: typeof mode): void {
  session.dispose();
  session = next;
  mode = label;
  session.onStep((before) => renderer.capturePrev(before));
  renderer.snapCamera(session.world);
  vfx.clear();
  hud.setStatus('');
  hud.setNames('RED', 'INK');
  const onScreenControls = label !== 'menu' && wantsTouch();
  touch.show(onScreenControls);
  renderer.camera.anchorShift = onScreenControls ? 95 : 0;
  if (label !== 'menu' && !awake) {
    awake = true;
    keepAwake();
  }
  $('#menu').classList.toggle('closed', label !== 'menu');
}

function openMenu(): void {
  begin(new LocalSession(bus, new NullSource(), new NullSource()), 'menu');
}

function startLocal(training: boolean): void {
  const p1 = merge(keyboard.source(P1_KEYS), touch);
  const p2 = training ? new NullSource() : keyboard.source(P2_KEYS);
  begin(new LocalSession(bus, p1, p2), training ? 'training' : 'local');
}

function startOnline(room: string): void {
  roomName = room;
  const online = new OnlineSession({
    room,
    name: 'player',
    input: merge(keyboard.source(P1_KEYS, P2_KEYS), touch),
    bus,
    url: serverUrl(),
  });
  online.onInfo = showOnline;
  begin(online, 'online');
  showOnline(online.info);
}

function showOnline(info: OnlineInfo): void {
  const name = (slot: 0 | 1, fallback: string): string => {
    const n = info.players.find((p) => p.slot === slot)?.name ?? fallback;
    return info.slot === slot ? `${n} (you)` : n;
  };
  hud.setNames(name(0, 'RED'), name(1, 'INK'));
  const where = info.slot === 'spectator' ? 'spectating' : info.slot === null ? '' : `you are P${info.slot + 1}`;
  hud.setStatus([info.message, `room “${roomName}”`, where, info.ping ? `${info.ping}ms` : ''].filter(Boolean).join('  ·  '));
}

// ── UI ──
$('#go-local').addEventListener('click', () => (audio.unlock(), startLocal(false)));
$('#go-training').addEventListener('click', () => (audio.unlock(), startLocal(true)));
$('#go-online').addEventListener('click', () => {
  audio.unlock();
  saveServer($<HTMLInputElement>('#server').value);
  startOnline(($<HTMLInputElement>('#room').value.trim() || 'lobby').toLowerCase());
});
$('#btn-theme').addEventListener('click', () => toggleTheme());
$('#btn-sound').addEventListener('click', () => toggleSound());
$('#btn-menu').addEventListener('click', () => openMenu());

// ── installable app + offline ──
registerServiceWorker();
setupInstall($('#btn-install'), $('#install-hint'));
const fullscreen = setupFullscreen($('#btn-full'));
$<HTMLInputElement>('#server').value = savedServer();

/** Online play needs the network; everything else works without it. */
function syncOnline(): void {
  const online = navigator.onLine;
  const btn = $<HTMLButtonElement>('#go-online');
  btn.disabled = !online;
  btn.textContent = online ? 'Play online' : 'Offline';
}
window.addEventListener('online', syncOnline);
window.addEventListener('offline', syncOnline);
syncOnline();

function toggleSound(): void {
  audio.muted = !audio.muted;
  $('#btn-sound').style.opacity = audio.muted ? '0.4' : '1';
}

window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.repeat) return;
  switch (e.code) {
    case 'Escape':
      openMenu();
      break;
    case 'KeyT':
      if ((e.target as HTMLElement).tagName !== 'INPUT') toggleTheme();
      break;
    case 'KeyM':
      if ((e.target as HTMLElement).tagName !== 'INPUT') toggleSound();
      break;
    case 'Backquote':
      renderer.debug = !renderer.debug;
      break;
    case 'KeyF':
      if ((e.target as HTMLElement).tagName !== 'INPUT') fullscreen.toggle();
      break;
    case 'KeyR':
      if (session instanceof LocalSession && (e.target as HTMLElement).tagName !== 'INPUT') {
        session.game.restart();
        vfx.clear();
      }
      break;
  }
});
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// ?demo plays a scripted fight (screenshots, docs, smoke tests). ?autostart=local|training skips the menu.
const params = new URLSearchParams(location.search);
if (params.has('demo')) {
  begin(
    new LocalSession(
      bus,
      new ScriptedSource((f) => demoInputs(f)[0]),
      new ScriptedSource((f) => demoInputs(f)[1]),
    ),
    'local',
  );
  // ?ff=N fast-forwards N frames first (to screenshot a specific moment).
  const ff = Number(params.get('ff') ?? 0);
  for (let i = 0; i < ff && session instanceof LocalSession; i++) {
    session.game.tick();
    vfx.update(1, 1);
  }
} else if (params.get('autostart') === 'online') {
  startOnline(params.get('room') ?? 'lobby');
} else if (params.get('autostart')) {
  startLocal(params.get('autostart') === 'training');
}

// ?hp=0.9,0.2 sets starting health ratios (dev: to look at the tired stance without a long fight).
const hpParam = params.get('hp');
if (hpParam && session instanceof LocalSession) {
  hpParam.split(',').forEach((v, i) => {
    const f = session.world.fighters[i];
    if (f) f.hp = Math.max(1, Math.round(Number(v) * RULES.maxHp));
  });
}

// ── main loop ──
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(now - last, 100);
  last = now;
  const alpha = session.update(dt, vfx.timeScale);
  const dtF = dt / FRAME_MS;
  const scaled = dtF * vfx.timeScale;
  vfx.update(dtF, scaled);
  renderer.render(session.world, alpha, scaled, vfx);
  hud.update(session.world, scaled);
  requestAnimationFrame(frame);
}
renderer.snapCamera(session.world);
requestAnimationFrame(frame);

// Handy in the console: window.hollow.world, .bus, .session ...
Object.assign(window, {
  hollow: {
    get world() {
      return session.world;
    },
    get session() {
      return session;
    },
    get mode() {
      return mode;
    },
    bus,
    vfx,
    renderer,
    log: (on = true) => (logging = on),
    onEvent: (fn: (e: GameEvent) => void) => bus.onAny(fn),
  },
});
