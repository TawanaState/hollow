import { SFX } from '../content/sfx.ts';
import type { SfxLayer } from '../content/sfx.ts';
import { fToMs } from '../core/time.ts';
import { sfxKeys } from './director.ts';
import type { Cue } from './director.ts';

/**
 * WebAudio synthesiser that plays the recipes in content/sfx.ts. No audio files.
 * The context is created lazily and resumed on the first user gesture (browser rule).
 */
export class Audio {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Call from any click/keypress so the browser allows sound. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      const comp = this.ctx.createDynamicsCompressor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Play the sounds for a cue from the director. */
  playCue(cue: Cue): void {
    if (this.muted || !this.ctx) return;
    for (const key of sfxKeys(cue, (k) => k in SFX)) this.play(key);
  }

  play(key: string): void {
    const layers = SFX[key];
    if (!layers || !this.ctx || !this.master || this.muted) return;
    for (const layer of layers) this.layer(layer);
  }

  private layer(l: SfxLayer): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const dur = fToMs(l.dur) / 1000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(l.gain, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    gain.connect(this.master!);
    const jitter = 1 + (Math.random() - 0.5) * 0.08;

    if (l.osc) {
      const o = ctx.createOscillator();
      o.type = l.osc.type;
      o.frequency.setValueAtTime(l.osc.from * jitter, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, l.osc.to * jitter), t0 + dur);
      o.connect(gain);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
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
      src.connect(f).connect(gain);
      src.start(t0, Math.random());
      src.stop(t0 + dur + 0.02);
    }
  }
}
