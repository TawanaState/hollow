// Renders the PNG app icons from the logo SVGs, using any installed Chromium browser
// (Edge, Chrome, Chromium). No npm dependency needed.
//   npm run icons        (run `npm run logo` first if you changed the logo)
//   BROWSER=/path/to/chrome npm run icons     to choose a browser
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
].filter(Boolean);

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('No Chromium-based browser found. Set BROWSER=/path/to/browser and retry.');
  process.exit(1);
}

// [source svg, output png, size, transparent corners?]
const JOBS = [
  ['public/favicon.svg', 'public/icon-192.png', 192, true],
  ['public/favicon.svg', 'public/icon-512.png', 512, true],
  ['public/icon-maskable.svg', 'public/icon-maskable-512.png', 512, false],
  ['public/icon-maskable.svg', 'public/apple-touch-icon.png', 180, false],
];

const tmp = mkdtempSync(join(tmpdir(), 'hollow-icons-'));
for (const [svg, out, size, transparent] of JOBS) {
  const html = join(tmp, `${size}-${Math.random().toString(36).slice(2)}.html`);
  const src = pathToFileURL(resolve(svg)).href;
  writeFileSync(
    html,
    `<!doctype html><body style="margin:0;background:${transparent ? 'transparent' : '#f6f6f8'}"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`,
  );
  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--default-background-color=${transparent ? '00000000' : 'fff6f6f8'}`,
      `--screenshot=${resolve(out)}`,
      `--window-size=${size},${size}`,
      pathToFileURL(html).href,
    ],
    { stdio: 'ignore' },
  );
  console.log('wrote', out);
}
