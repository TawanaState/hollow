import { SFX } from '../content/sfx.ts';
import type { SampleLayer, SfxLayer, SfxRecipe } from '../content/sfx.ts';
import { FRAME_MS, fToMs } from '../core/time.ts';
import { sfxKeys } from './director.ts';
import type { Cue } from './director.ts';

/** One decoded recording, with the gain that brings its peak to a common level. */
interface Clip {
  buffer: AudioBuffer;
  norm: number;
}

export interface PlayOptions {
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Multiplies every layer's volume. */
  gain?: number;
  /** Combo count of the hit: pitch climbs with it. */
  combo?: number;
}

export interface AudioSettings {
  /** 0..1 master volume. */
  volume: number;
  /** The announcer ("Round 1, Fight!"). */
  voice: boolean;
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

/** Overall level into the compressor. Sounds are balanced against each other in content/sfx.ts. */
const MASTER = 0.95;

/** y = tanh curve, scaled so a full-scale input lands at 0.89 and nothing exceeds 0.95. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = (Math.tanh(x * 1.15) / Math.tanh(1.15)) * 0.95;
  }
  return c;
}

/**
 * The game's sound engine. Plays the recipes in content/sfx.ts through a small mixing desk:
 *
 *   samples + synth layers -> [sfx bus] ---+--> master low-pass -> master gain -> compressor -> soft clip -> out
 *   announcer             -> [voice bus] --+          ^
 *   reverb sends          -> convolver ---+           '-- dips the top end when someone is K.O.'d
 *
 * What makes it sound like a game rather than a beep box:
 *   - every sound is LAYERED (a crisp transient, a body thud, a synthesised sub-bass)
 *   - every play picks a random VARIANT and a random PITCH, and a combo raises the pitch
 *   - sounds are PANNED to where they happen on screen
 *   - heavy hits get a REVERB tail; the K.O. muffles the whole mix like ringing ears
 *   - the announcer DUCKS the effects, and a compressor and a soft clip stop anything clipping
 * If the recordings cannot be loaded the old fully synthesised sounds play instead.
 *
 * It takes any AudioContext, so it can also render offline for tests.
 */
export class Audio {
  /** Master mute. */
  muted = false;
  settings: AudioSettings = { volume: 0.85, voice: true };
  /** World x the camera is looking at, so sounds can be placed left/right of centre. */
  listener: () => number = () => 0;
  /** Half the width, in world units, that maps to full left/right. */
  spread = 800;

  private ctx: BaseAudioContext | null = null;
  private master!: GainNode;
  private lowpass!: BiquadFilterNode;
  private sfxBus!: GainNode;
  private voiceBus!: GainNode;
  private reverbIn!: GainNode;
  private clips = new Map<string, Clip[]>();
  private lastVariant = new Map<string, number>();
  private lastPlayed = new Map<string, number>();
  private noise: AudioBuffer | null = null;
  private active = 0;
  private loading: Promise<void> | null = null;

  constructor(ctx?: BaseAudioContext) {
    if (ctx) this.build(ctx);
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  get samplesLoaded(): number {
    let n = 0;
    for (const list of this.clips.values()) n += list.length;
    return n;
  }

  /** Create the audio context early (it stays suspended until a tap) and start fetching the sounds. */
  prepare(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.build(new Ctor());
    }
    void this.load();
  }

  /** Call from any click or key press: browsers only let sound start after one. */
  unlock(): void {
    this.prepare();
    const ctx = this.ctx as AudioContext | null;
    if (ctx && 'resume' in ctx && ctx.state === 'suspended') void ctx.resume();
  }

  setVolume(v: number): void {
    this.settings.volume = Math.max(0, Math.min(1, v));
    if (this.ctx) this.master.gain.value = this.muted ? 0 : this.settings.volume * MASTER;
  }

  /** Freeze or resume all sound (used by pause). */
  setSuspended(on: boolean): void {
    const ctx = this.ctx as AudioContext | null;
    if (!ctx || !('suspend' in ctx)) return;
    if (on) void ctx.suspend();
    else void ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.setVolume(this.settings.volume);
  }

  private build(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.settings.volume * MASTER;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;
    // glue the mix together, but slowly enough (12 ms attack) that the punch of each hit gets through
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.012;
    comp.release.value = 0.2;
    this.sfxBus = ctx.createGain();
    this.voiceBus = ctx.createGain();
    this.sfxBus.connect(this.lowpass);
    this.voiceBus.connect(this.master); // the announcer is never muffled
    this.lowpass.connect(this.master);
    // a soft clip as the last stage: transparent for normal levels, rounds off a pile-up of big sounds
    // instead of letting it clip (a compressor set to "limit" misbehaves in some browsers, so it is not used)
    const softClip = ctx.createWaveShaper();
    softClip.curve = softClipCurve();
    softClip.oversample = '2x';
    this.master.connect(comp).connect(softClip).connect(ctx.destination);

    // reverb: a generated impulse response (noise with a smooth decay), no files needed
    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(ctx, 1.4);
    this.reverbIn = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    this.reverbIn.connect(convolver).connect(wet).connect(this.lowpass);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  private makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        const fadeIn = Math.min(1, t / 0.012);
        smooth = smooth * 0.55 + (Math.random() * 2 - 1) * 0.45; // takes the harshness off the tail
        d[i] = smooth * Math.exp(-t / 0.3) * fadeIn;
      }
    }
    return buf;
  }

  // ── loading the recordings ──

  /** Fetch and decode every sound in public/audio. Safe to call twice. Never throws: missing sounds fall back to synth. */
  load(base = '/audio/'): Promise<void> {
    this.loading ??= this.doLoad(base);
    return this.loading;
  }

  private async doLoad(base: string): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    let manifest: Record<string, string[]>;
    try {
      const res = await fetch(`${base}manifest.json`);
      if (!res.ok) return;
      manifest = (await res.json()) as Record<string, string[]>;
    } catch {
      return;
    }
    const jobs = Object.entries(manifest).flatMap(([group, files]) => files.map((file) => ({ group, file })));
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length) {
        const { group, file } = jobs[next++];
        try {
          const res = await fetch(`${base}${file}`);
          if (!res.ok) continue;
          const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
          this.addClip(group, buffer);
        } catch {
          /* a file this browser cannot decode: that variant is simply absent */
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  /** Register a decoded buffer under a group name (also used by tests). */
  addClip(group: string, buffer: AudioBuffer): void {
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
    const norm = peak > 0 ? Math.max(0.5, Math.min(4, 0.9 / peak)) : 1;
    const list = this.clips.get(group) ?? [];
    list.push({ buffer, norm });
    this.clips.set(group, list);
  }

  // ── playing ──

  /** Play the sounds for an event, placed where it happened. */
  playCue(cue: Cue): void {
    if (!this.ctx || this.muted) return;
    const pan = cue.ctx.global ? 0 : this.panFor(cue.ctx.x);
    for (const key of sfxKeys(cue, (k) => k in SFX)) this.play(key, { pan, combo: cue.ctx.combo });
    if (cue.announce) this.announce(cue.announce.line, cue.announce.delayF);
  }

  panFor(x: number): number {
    return Math.max(-1, Math.min(1, (x - this.listener()) / this.spread)) * 0.6;
  }

  play(key: string, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    const recipe = SFX[key];
    if (!ctx || !recipe || this.muted) return;
    const now = ctx.currentTime;
    const minGap = (recipe.limit ?? 1) * (FRAME_MS / 1000);
    if (now - (this.lastPlayed.get(key) ?? -1) < minGap) return;
    this.lastPlayed.set(key, now);
    // crowded? the small stuff gives way
    if (this.active > 44 && (key.startsWith('ui.') || key === 'step')) return;

    const out = this.panned(opts.pan ?? 0, this.sfxBus);
    const comboGain = recipe.combo && opts.combo && opts.combo > 1 ? Math.min(1.3, 1 + 0.035 * (opts.combo - 1)) : 1;
    const gain = (opts.gain ?? 1) * comboGain;
    const rateBoost = recipe.combo && opts.combo && opts.combo > 1 ? Math.min(1.35, 1 + 0.035 * (opts.combo - 1)) : 1;

    const haveSamples = recipe.samples?.some((l) => (this.clips.get(l.sample)?.length ?? 0) > 0) ?? false;
    if (haveSamples) {
      for (const layer of recipe.samples!) this.playSample(layer, recipe, out, now, gain, rateBoost);
      for (const layer of recipe.body ?? []) this.playSynth(layer, out, now, gain, recipe);
    } else {
      for (const layer of recipe.fallback ?? recipe.body ?? []) this.playSynth(layer, out, now, gain, recipe);
    }

    if (recipe.duck) this.duck(recipe.duck.amount, fToMs(recipe.duck.dur) / 1000);
    if (recipe.muffle) this.muffle(recipe.muffle.to, fToMs(recipe.muffle.dur) / 1000);
  }

  /** A route to the bus, through a stereo panner if there is one and it matters. */
  private panned(pan: number, bus: AudioNode): AudioNode {
    const ctx = this.ctx!;
    if (Math.abs(pan) < 0.02 || typeof ctx.createStereoPanner !== 'function') return bus;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(bus);
    return p;
  }

  private playSample(layer: SampleLayer, recipe: SfxRecipe, out: AudioNode, now: number, gain: number, rateBoost: number): void {
    const ctx = this.ctx!;
    const clips = this.clips.get(layer.sample);
    if (!clips?.length) return;
    // a random variant, never the same one twice in a row
    let i = Math.floor(Math.random() * clips.length);
    if (clips.length > 1 && i === this.lastVariant.get(layer.sample)) i = (i + 1) % clips.length;
    this.lastVariant.set(layer.sample, i);
    const clip = clips[i];

    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    const [lo, hi] = layer.rate ?? [1, 1];
    src.playbackRate.value = rand(lo, hi) * rateBoost;
    const g = ctx.createGain();
    g.gain.value = layer.gain * clip.norm * gain;
    src.connect(g).connect(out);
    const send = layer.reverb ?? recipe.reverb ?? 0;
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverbIn);
    }
    const at = now + (layer.delay ?? 0) * (FRAME_MS / 1000);
    src.start(at);
    this.active++;
    src.onended = () => this.active--;
  }

  /** A synthesised layer: an oscillator and/or filtered noise with a pitch sweep and a decay. */
  private playSynth(l: SfxLayer, out: AudioNode, now: number, gain: number, recipe: SfxRecipe): void {
    const ctx = this.ctx!;
    const t0 = now + (l.delay ?? 0) * (FRAME_MS / 1000);
    const dur = fToMs(l.dur) / 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, l.gain * gain), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(out);
    if (recipe.reverb) {
      const s = ctx.createGain();
      s.gain.value = recipe.reverb * 0.6;
      g.connect(s).connect(this.reverbIn);
    }
    const jitter = 1 + (Math.random() - 0.5) * 0.08;
    if (l.osc) {
      const o = ctx.createOscillator();
      o.type = l.osc.type;
      o.frequency.setValueAtTime(l.osc.from * jitter, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, l.osc.to * jitter), t0 + dur);
      o.connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    }
    if (l.noise && this.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = l.noise.filter;
      f.Q.value = l.noise.q ?? 0.8;
      f.frequency.setValueAtTime(l.noise.from, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, l.noise.to), t0 + dur);
      src.connect(f).connect(g);
      src.start(t0, Math.random());
      src.stop(t0 + dur + 0.03);
    }
  }

  // ── the announcer ──

  private lastLine = new Map<string, number>();

  /** Say a line after a delay (in F). Lines are the 'say-<line>' sample groups. */
  announce(line: string, delayF = 0): void {
    if (!this.settings.voice || this.muted) return;
    const gap = line === 'combo' ? 9000 : 500;
    const at = performance.now();
    if (at - (this.lastLine.get(line) ?? -1e9) < gap) return;
    this.lastLine.set(line, at);
    const go = (): void => this.say(line);
    if (delayF > 0) setTimeout(go, fToMs(delayF));
    else go();
  }

  private voice: AudioBufferSourceNode | null = null;

  /** Play a voice line now, ducking the effects underneath it. A new line cuts off the previous one. */
  say(line: string): void {
    const ctx = this.ctx;
    const clips = this.clips.get(`say-${line}`);
    if (!ctx || !clips?.length || this.muted || !this.settings.voice) return;
    const clip = clips[0];
    const t = ctx.currentTime;
    if (this.voice) {
      try {
        this.voice.stop(t + 0.04); // a short fade-free cut: the lines end in silence anyway
      } catch {
        /* already finished */
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    // round numbers run a little long for the intro, so they are said slightly faster
    const rate = line.startsWith('round-') ? 1.1 : 1;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = 1.1 * clip.norm;
    src.connect(g).connect(this.voiceBus);
    const s = ctx.createGain();
    s.gain.value = 0.12;
    g.connect(s).connect(this.reverbIn);
    src.start(t);
    this.voice = src;
    this.duck(0.6, (clip.buffer.duration / rate) * 0.9);
  }

  // ── mix automation ──

  /** Make the effects quieter for `seconds`. */
  duck(amount: number, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.sfxBus.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(amount, t + 0.02);
    g.linearRampToValueAtTime(1, t + 0.02 + Math.max(0.05, seconds));
  }

  /** Close the top end of the whole mix to `hz`, then open it again over `seconds`. */
  muffle(hz: number, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const f = this.lowpass.frequency;
    const t = ctx.currentTime;
    f.cancelScheduledValues(t);
    f.setValueAtTime(hz, t);
    f.setValueAtTime(hz, t + seconds * 0.25);
    f.exponentialRampToValueAtTime(20000, t + seconds);
  }
}
