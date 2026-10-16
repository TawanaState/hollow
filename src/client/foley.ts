import type { World } from '../core/types.ts';
import type { Audio } from './audio.ts';

/**
 * Everyday sounds that no single game event announces: footsteps, the chime when the ultimate is
 * ready, and a heartbeat when someone is nearly beaten. Watches the world once per frame.
 */
export class Foley {
  private lastKey = [-1, -1];
  private lastEnergy = [0, 0];
  private beat = 0;

  update(w: World, dtF: number, audio: Audio): void {
    if (!audio.ready) return;
    const fighting = w.phase === 'fight';
    let low = 1;
    let lowest = 0;
    for (const f of w.fighters) {
      const pan = audio.panFor(f.x);
      // a step sound each time the stride puts a foot down (only once per sim frame)
      const key = f.stateF * 32 + f.state.length;
      if (key !== this.lastKey[f.id] && w.hitstop === 0 && f.y <= 0) {
        if (f.state === 'walk') {
          const period = f.vx * f.facing >= 0 ? 14 : 18;
          if (f.stateF % period === period >> 1) audio.play('step', { pan });
        } else if (f.state === 'dash' && !f.dashEnding && f.stateF % 5 === 2) {
          audio.play('step', { pan, gain: 1.4 });
        }
      }
      this.lastKey[f.id] = key;

      // "ultimate ready"
      if (fighting && this.lastEnergy[f.id] < 50 && f.energy >= 50) audio.play('energyReady', { pan });
      this.lastEnergy[f.id] = f.energy;

      const ratio = f.hp / f.maxHp;
      if (ratio < low) {
        low = ratio;
        lowest = f.id;
      }
    }

    // heartbeat: quickens and grows as health runs out
    if (fighting && low < 0.2) {
      this.beat -= dtF;
      if (this.beat <= 0) {
        const danger = 1 - low / 0.2; // 0 at 20% health, 1 at none
        audio.play('heartbeat', { pan: audio.panFor(w.fighters[lowest].x), gain: 0.5 + 0.7 * danger });
        this.beat = 78 - 30 * danger;
      }
    } else {
      this.beat = 0;
    }
  }
}
