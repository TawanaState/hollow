import type { World } from '../core/types.ts';

/**
 * The SVG viewBox the whole game is drawn into. `anchorY` is the screen line the camera looks
 * at: whatever world point the camera targets is drawn there (a little below the middle, so
 * there is headroom for jumps and launches).
 */
export const VIEW = { w: 1600, h: 900, anchorY: 500 } as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** What the effects layer asks of the camera this frame (see Vfx). */
export interface CameraFx {
  /** Extra zoom as a fraction (0.1 = 10% closer). Can be negative to pull back. */
  zoom: number;
  /** Pull the view toward a world point, 0..1. */
  focus: { x: number; y: number; w: number } | null;
  /** Roll in degrees. */
  roll: number;
  shakeX: number;
  shakeY: number;
}

/**
 * A moving camera, not a fixed side view. It:
 *   - closes in as the fighters get near (up to 2.1x), pulls back as they separate
 *   - rises to follow jumps and launches
 *   - takes dolly-in, roll and shake from effects (heavy hits, parry, K.O.)
 * All smoothing is per-F so it behaves the same at any frame rate.
 */
export class Camera {
  /** World point the camera looks at (y is a height above the ground). */
  x = 0;
  y = 70;
  zoom = 1.6;
  /**
   * How much of the stage width the screen actually shows, in view units. Narrower screens
   * (4:3 tablets) crop the sides of the 16:9 view, so the camera zooms out to keep both fighters in.
   */
  visibleW: number = VIEW.w;
  /** Raise the whole scene by this many view units (room for on-screen controls underneath). */
  anchorShift = 0;
  /** What the transform used last (after effects). */
  private fx: CameraFx = { zoom: 0, focus: null, roll: 0, shakeX: 0, shakeY: 0 };
  private cx = 0;
  private cy = 70;

  snap(w: World): void {
    const t = this.target(w);
    this.x = t.x;
    this.y = t.y;
    this.zoom = t.zoom;
    this.cx = t.x;
    this.cy = t.y;
  }

  update(w: World, dtF: number, fx: CameraFx): void {
    const t = this.target(w);
    const kx = 1 - Math.pow(0.84, dtF);
    const kz = 1 - Math.pow(0.9, dtF);
    const ky = 1 - Math.pow(0.88, dtF);
    this.x += (t.x - this.x) * kx;
    this.y += (t.y - this.y) * ky;
    this.zoom += (t.zoom - this.zoom) * kz;
    this.fx = fx;
    const f = fx.focus;
    this.cx = f ? this.x + (f.x - this.x) * f.w : this.x;
    this.cy = f ? this.y + (f.y - this.y) * f.w : this.y;
  }

  private target(w: World): { x: number; y: number; zoom: number } {
    const [a, b] = w.fighters;
    const dx = Math.abs(a.x - b.x);
    // Height to look at: chest level, rising when someone is airborne.
    let y = 70 + Math.max(a.y, b.y) * 0.5;
    // Very close: look a touch higher, at faces.
    if (dx < 160) y += ((160 - dx) / 160) * 12;
    return {
      x: (a.x + b.x) / 2,
      y,
      zoom: clamp(this.visibleW / (dx + 420), 0.45, 2.1),
    };
  }

  /** SVG transform for the world group. */
  transform(): string {
    const z = this.zoom * (1 + this.fx.zoom);
    return (
      `translate(${(VIEW.w / 2 + this.fx.shakeX).toFixed(2)} ${(VIEW.anchorY - this.anchorShift + this.fx.shakeY).toFixed(2)}) ` +
      `rotate(${this.fx.roll.toFixed(3)}) scale(${z.toFixed(4)}) ` +
      `translate(${(-this.cx).toFixed(2)} ${this.cy.toFixed(2)})`
    );
  }

  /** Where the ground line is on screen (for parallax). */
  get groundScreenY(): number {
    return VIEW.anchorY - this.anchorShift + this.cy * this.zoom * (1 + this.fx.zoom);
  }
}
