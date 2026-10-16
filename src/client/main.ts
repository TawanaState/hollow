import '../style.css';
import logoSvg from '../assets/logo.svg?raw';
import { SFX } from '../content/sfx.ts';
import { assertValidContent } from '../content/validate.ts';
import { EventBus, FRAME_MS, NullSource, describeEvent } from '../core/index.ts';
import type { GameEvent, InputFrame, InputSource } from '../core/index.ts';
import { AiController } from './ai/controller.ts';
import { Learner } from './ai/learner.ts';
import { PersonaStore } from './ai/personas.ts';
import { StudentsUi } from './ai/ui.ts';
import { Audio } from './audio.ts';
import { Foley } from './foley.ts';
import { setupUiSounds } from './uiSounds.ts';
import { cueFor } from './director.ts';
import { Hud } from './hud.ts';
import { Keyboard, P1_KEYS, P2_KEYS } from './keyboard.ts';
import { keepAwake, registerServiceWorker, setupFullscreen, setupInstall } from './pwa.ts';
import { Renderer } from './renderer.ts';
import { saveServer, savedServer, serverUrl } from './server.ts';
import { saveHpScale, saveSoundMode, saveVolume, savedHpScale, savedSoundMode, savedVolume } from './settings.ts';
import type { SoundMode } from './settings.ts';
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
audio.listener = () => renderer.camera.x; // sounds are placed left/right of where the camera looks
const foley = new Foley();
const hud = new Hud(app);
const keyboard = new Keyboard();
const touch = new TouchPad($('#touch'));
/** Phones and tablets get on-screen controls. ?touch forces them on (handy for testing). */
const wantsTouch = (): boolean => matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
let awake = false;
const pauseOverlay = $('#pause');
const pauseButton = $('#btn-pause');

/** Everything that reacts to the game subscribes here, whatever the session is. */
const bus = new EventBus();
/** Which seat a person plays in a single-player match (so the announcer can say "You win"). */
const humanSlot = (): 0 | 1 | null => {
  if (mode === 'persona' || mode === 'training') return 0;
  if (session.kind === 'online') {
    const slot = (session as OnlineSession).slot;
    return slot === 0 || slot === 1 ? slot : null;
  }
  return null;
};

bus.onAny((e) => {
  const cue = cueFor(e, { world: session.world, humanSlot: humanSlot() });
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
let mode: 'menu' | 'local' | 'training' | 'online' | 'persona' | 'watch' = 'menu';
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
  // a student match or a watched fight is owned by the AI controller; anything else ends it
  if (label !== 'persona' && label !== 'watch') ai.end();
  const onScreenControls = label !== 'menu' && label !== 'watch' && wantsTouch();
  touch.show(onScreenControls);
  watchbar.hidden = label !== 'watch';
  pauseOverlay.hidden = true;
  pauseButton.hidden = label === 'menu' || label === 'online';
  if (label === 'watch') setSpeedButton(1);
  renderer.camera.anchorShift = onScreenControls ? 95 : 0;
  if (label !== 'menu' && !awake) {
    awake = true;
    keepAwake();
  }
  $('#menu').classList.toggle('closed', label !== 'menu');
}

/** Freeze the match (local ones only) and show the pause screen. */
function setPaused(on: boolean): void {
  if (mode === 'menu' || session.kind === 'online') return;
  session.paused = on;
  pauseOverlay.hidden = !on;
  touch.reset();
  audio.setSuspended(on);
  if (on) $<HTMLButtonElement>('#pause-resume').focus();
}

function openMenu(): void {
  begin(new LocalSession(bus, new NullSource(), new NullSource()), 'menu');
  showPanel('main');
}

/** The menu has two screens: the main one and the Students one. */
function showPanel(which: 'main' | 'students'): void {
  $('#menu > .panel:not(#ai-panel)').hidden = which !== 'main';
  $('#ai-panel').hidden = which !== 'students';
}

function startLocal(training: boolean): void {
  const p1 = merge(keyboard.source(P1_KEYS), touch);
  const p2 = training ? new NullSource() : keyboard.source(P2_KEYS);
  begin(new LocalSession(bus, p1, p2, savedHpScale()), training ? 'training' : 'local');
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

// ── students (AI personas that learn from you) ──
const watchbar = $('#watchbar');
const store = new PersonaStore();
const learner = new Learner(store);
const ai = new AiController(
  {
    bus,
    hud,
    humanInput: () => merge(keyboard.source(P1_KEYS, P2_KEYS), touch),
    hpScale: savedHpScale,
    begin: (next, label) => begin(next, label),
  },
  store,
  learner,
);
const students = new StudentsUi(store, learner, ai);
store
  .ensureDefaults()
  .then(async () => {
    void store.cleanup().catch(() => undefined); // housekeeping at startup
    await students.render();
    // dev shortcuts: ?students opens the screen, ?watch=ember,stone starts a fight between two students
    const q = new URLSearchParams(location.search);
    if (q.has('students')) {
      showPanel('students');
      await students.open(false);
    }
    const watch = q.get('watch');
    if (watch) {
      const names = watch.toLowerCase().split(',');
      const all = await store.list();
      const find = (n: string | undefined, fallback: number) => all.find((p) => p.name.toLowerCase() === n) ?? all[fallback];
      const a = find(names[0], 0);
      const b = find(names[1], 1);
      if (a && b) await ai.watch(a.id, b.id);
      // &ff=N fast-forwards N frames first (to look at a moment mid-fight)
      for (let i = 0; i < Number(q.get('ff') ?? 0) && session instanceof LocalSession; i++) {
        session.game.tick();
        vfx.update(1, 1);
      }
    }
  })
  .catch((e) => {
    console.warn('[hollow] students unavailable', e);
    for (const id of ['#go-ai', '#go-watch']) {
      const b = $<HTMLButtonElement>(id);
      b.disabled = true;
      b.title = 'Students need local storage and the starter brains, which are not available here.';
    }
  });

function setSpeedButton(speed: number): void {
  for (const b of watchbar.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', Number(b.dataset.speed) === speed);
}
watchbar.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-speed]');
  if (!b) return;
  ai.setSpeed(Number(b.dataset.speed));
  setSpeedButton(Number(b.dataset.speed));
});

// ── UI ──
const hpSelect = $<HTMLSelectElement>('#hp-scale');
hpSelect.value = String(savedHpScale());
hpSelect.addEventListener('change', () => saveHpScale(Number(hpSelect.value)));
$('#go-ai').addEventListener('click', () => {
  audio.unlock();
  showPanel('students');
  void students.open(false);
});
$('#go-watch').addEventListener('click', () => {
  audio.unlock();
  showPanel('students');
  void students.open(true);
});
$('#ai-back').addEventListener('click', () => showPanel('main'));
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
pauseButton.addEventListener('click', () => setPaused(true));
$('#pause-resume').addEventListener('click', () => setPaused(false));
$('#pause-menu').addEventListener('click', () => {
  setPaused(false);
  openMenu();
});
$('#pause-restart').addEventListener('click', () => {
  if (session instanceof LocalSession) {
    session.game.restart();
    vfx.clear();
  }
  setPaused(false);
});
// leaving the app (switching tabs or apps on a phone) pauses a match, so nobody gets hit while away
document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode !== 'menu' && mode !== 'online') setPaused(true);
});

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

const soundSelect = $<HTMLSelectElement>('#sound-mode');
const volumeSlider = $<HTMLInputElement>('#volume');

/** Apply Full / No announcer / Off, and show it on the toolbar button. */
function applySound(mode: SoundMode): void {
  audio.setMuted(mode === 'off');
  audio.settings.voice = mode === 'full';
  soundSelect.value = mode;
  $('#btn-sound').style.opacity = mode === 'off' ? '0.4' : '1';
  saveSoundMode(mode);
}
applySound(savedSoundMode());
audio.setVolume(savedVolume() / 100);
volumeSlider.value = String(savedVolume());
soundSelect.addEventListener('change', () => applySound(soundSelect.value as SoundMode));
volumeSlider.addEventListener('input', () => {
  audio.setVolume(Number(volumeSlider.value) / 100);
  saveVolume(Number(volumeSlider.value));
});
function toggleSound(): void {
  applySound(audio.muted ? 'full' : 'off');
}
audio.prepare(); // build the mixer now and start loading the sounds, so they are ready at the first tap
setupUiSounds(audio);

window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (e.repeat) return;
  switch (e.code) {
    case 'Escape':
    case 'KeyP':
      if (mode === 'online') openMenu();
      else if (mode !== 'menu') setPaused(!session.paused);
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
    if (f) f.hp = Math.max(1, Math.round(Number(v) * f.maxHp));
  });
}

// ── main loop ──
let last = performance.now();
function frame(now: number): void {
  const dt = session.paused ? 0 : Math.min(now - last, 100);
  last = now;
  const alpha = session.update(dt, vfx.timeScale);
  const dtF = dt / FRAME_MS;
  const scaled = dtF * vfx.timeScale;
  vfx.update(dtF, scaled);
  renderer.render(session.world, alpha, scaled, vfx);
  hud.update(session.world, scaled);
  foley.update(session.world, scaled, audio);
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
    audio,
    AudioEngine: Audio,
    sfxKeys: SFX,
    ai: { store, learner, controller: ai },
    log: (on = true) => (logging = on),
    onEvent: (fn: (e: GameEvent) => void) => bus.onAny(fn),
  },
});
