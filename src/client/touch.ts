import { Btn } from '../core/input.ts';
import type { InputFrame, InputSource } from '../core/index.ts';

/** Thumb-stick dead zone and thresholds, in CSS pixels. */
const STICK = { radius: 58, deadX: 16, jumpY: 26, crouchY: 26 };

/**
 * On-screen controls for phones, laid over the game view:
 *   - a floating thumb-stick: touch anywhere on the left half, drag to move, flick up to jump,
 *     down to crouch. Diagonals work (jump forward) because it is one finger.
 *   - action buttons on the right: data-btn="LIGHT|HEAVY|SKILL|GUARD|DASH".
 * Pointer events with capture, so any number of fingers work at once and nothing scrolls.
 */
export class TouchPad implements InputSource {
  readonly kind = 'touch';
  private stickBits = 0;
  private buttonBits = 0;
  private readonly cleanups: (() => void)[] = [];
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    const zone = root.querySelector<HTMLElement>('.stick-zone');
    if (zone) this.bindStick(zone);
    for (const el of root.querySelectorAll<HTMLElement>('[data-btn]')) this.bindButton(el);
    const stop = (e: Event): void => e.preventDefault();
    root.addEventListener('contextmenu', stop);
    this.cleanups.push(() => root.removeEventListener('contextmenu', stop));
  }

  private bindButton(el: HTMLElement): void {
    const bit = Btn[el.dataset.btn as keyof typeof Btn];
    if (!bit) return;
    const press = (e: PointerEvent): void => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.buttonBits |= bit;
      el.classList.add('down');
      navigator.vibrate?.(8);
    };
    const release = (): void => {
      this.buttonBits &= ~bit;
      el.classList.remove('down');
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    this.cleanups.push(() => {
      el.removeEventListener('pointerdown', press);
      el.removeEventListener('pointerup', release);
      el.removeEventListener('pointercancel', release);
      el.removeEventListener('lostpointercapture', release);
    });
  }

  private bindStick(zone: HTMLElement): void {
    const base = zone.querySelector<HTMLElement>('.stick-base')!;
    const knob = base.querySelector<HTMLElement>('i')!;
    let id = -1;
    let ox = 0;
    let oy = 0;

    const move = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox;
      let dy = e.clientY - oy;
      const len = Math.hypot(dx, dy);
      if (len > STICK.radius) {
        dx = (dx / len) * STICK.radius;
        dy = (dy / len) * STICK.radius;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      let bits = 0;
      if (dx > STICK.deadX) bits |= Btn.RIGHT;
      else if (dx < -STICK.deadX) bits |= Btn.LEFT;
      if (dy < -STICK.jumpY) bits |= Btn.UP;
      else if (dy > STICK.crouchY) bits |= Btn.DOWN;
      this.stickBits = bits;
    };
    const down = (e: PointerEvent): void => {
      if (id !== -1) return;
      e.preventDefault();
      id = e.pointerId;
      zone.setPointerCapture(id);
      const r = zone.getBoundingClientRect();
      ox = e.clientX;
      oy = e.clientY;
      base.style.left = `${ox - r.left}px`;
      base.style.top = `${oy - r.top}px`;
      zone.classList.add('active');
      knob.style.transform = 'translate(0px, 0px)';
      this.stickBits = 0;
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      id = -1;
      this.stickBits = 0;
      zone.classList.remove('active');
    };
    zone.addEventListener('pointerdown', down);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', up);
    zone.addEventListener('pointercancel', up);
    this.cleanups.push(() => {
      zone.removeEventListener('pointerdown', down);
      zone.removeEventListener('pointermove', move);
      zone.removeEventListener('pointerup', up);
      zone.removeEventListener('pointercancel', up);
    });
  }

  poll(): InputFrame {
    return this.stickBits | this.buttonBits;
  }

  /** Let go of everything (used when the game is paused, so nothing is left held). */
  reset(): void {
    this.stickBits = 0;
    this.buttonBits = 0;
    for (const el of this.root.querySelectorAll('.down')) el.classList.remove('down');
    this.root.querySelector('.stick-zone')?.classList.remove('active');
  }

  show(visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) {
      this.stickBits = 0;
      this.buttonBits = 0;
    }
  }

  dispose(): void {
    for (const off of this.cleanups) off();
    this.stickBits = 0;
    this.buttonBits = 0;
  }
}
