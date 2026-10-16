// Generates the hollow logo: a ring sketched in dark pencil.
//   npm run logo        -> src/assets/logo.svg (themeable, inlined by the menu) and public/favicon.svg
// Deterministic (seeded), so the output only changes when this file changes.
import { mkdirSync, writeFileSync } from 'node:fs';

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260916);
const between = (a, b) => a + (b - a) * rnd();
const f = (n) => n.toFixed(1);

const CX = 200;
const CY = 200;
const R = 128;
const parts = [];

// ── pencil ring: several wobbly passes that overshoot and miss each other ──
function ringPass({ width, opacity, wobble, offset }) {
  const start = between(0, Math.PI * 2);
  const sweep = Math.PI * 2 * between(0.97, 1.1);
  const p1 = between(0, 6.28), p2 = between(0, 6.28), p3 = between(0, 6.28);
  const ox = between(-offset, offset), oy = between(-offset, offset);
  const n = 140;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = start + (sweep * i) / n;
    const r = R + wobble * (Math.sin(2 * th + p1) * 1.2 + Math.sin(3 * th + p2) * 0.8 + Math.sin(7 * th + p3) * 0.35) + between(-0.5, 0.5);
    pts.push(`${f(CX + ox + Math.cos(th) * r)},${f(CY + oy + Math.sin(th) * r)}`);
  }
  return `<polyline points="${pts.join(' ')}" fill="none" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
const ring = [];
ring.push(ringPass({ width: 7, opacity: 0.92, wobble: 2.4, offset: 1.5 }));
ring.push(ringPass({ width: 4.2, opacity: 0.85, wobble: 3, offset: 2.5 }));
for (let i = 0; i < 4; i++) ring.push(ringPass({ width: between(1.1, 2.6), opacity: between(0.4, 0.8), wobble: between(2.5, 4.5), offset: 3.5 }));

// ── pencil hatching around the ring ──
const hatch = [];
for (let i = 0; i < 46; i++) {
  const th = between(0, Math.PI * 2);
  const r = R + between(-12, 12);
  const len = between(6, 15);
  const ang = th + between(-0.9, 0.9) + Math.PI / 2;
  const x = CX + Math.cos(th) * r;
  const y = CY + Math.sin(th) * r;
  hatch.push(`M${f(x)},${f(y)} l${f(Math.cos(ang) * len)},${f(Math.sin(ang) * len)}`);
}

function build({ themed, maskable = false }) {
  const ink = themed ? 'var(--logo-ink,#0e0e12)' : '#0e0e12';
  const paper = themed ? 'var(--logo-paper,#f6f6f8)' : '#f6f6f8';
  // maskable = full-bleed square with the ring shrunk into the safe zone (the OS crops it to a circle/squircle)
  const bg = themed ? '' : `<rect width="400" height="400" ${maskable ? '' : 'rx="70"'} fill="${paper}"/>`;
  const open = maskable ? '<g transform="translate(200 200) scale(0.85) translate(-200 -200)">' : '<g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img" aria-label="hollow">
  <defs>
    <filter id="pencil" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2"/>
    </filter>
  </defs>
  ${bg}
  ${open}<g filter="url(#pencil)">
    <g stroke="${ink}">${ring.join('')}</g>
    <path d="${hatch.join(' ')}" fill="none" stroke="${ink}" stroke-opacity="0.5" stroke-width="1.1" stroke-linecap="round"/>
  </g></g>
</svg>
`;
}

mkdirSync('src/assets', { recursive: true });
mkdirSync('public', { recursive: true });
writeFileSync('src/assets/logo.svg', build({ themed: true }));
writeFileSync('public/favicon.svg', build({ themed: false }));
writeFileSync('public/icon-maskable.svg', build({ themed: false, maskable: true }));
console.log('wrote src/assets/logo.svg, public/favicon.svg, public/icon-maskable.svg');
