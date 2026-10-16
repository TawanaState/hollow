import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { DEFAULT_PORT } from '../src/net/protocol.ts';
import { attachGameServer } from './gameServer.ts';

/**
 * Production server: serves the built client (dist/) and the game WebSocket on one port.
 *   npm run build && npm run server        (or: npm run play)
 * Phones on the same WiFi open http://<this machine's IP>:3000
 */
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const DIST = resolve(process.cwd(), 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const http = createServer((req, res) => {
  if (!existsSync(DIST)) {
    res.writeHead(503, { 'content-type': 'text/plain' });
    res.end('No build found. Run `npm run build` first (or use `npm run play`).');
    return;
  }
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = normalize(join(DIST, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': file.includes('assets') ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(file.endsWith('sw.js') ? { 'service-worker-allowed': '/' } : {}),
  });
  createReadStream(file).pipe(res);
});

const game = attachGameServer(http);

http.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  hollow server listening on port ${PORT}\n`);
  console.log(`  this machine:  http://localhost:${PORT}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  on your WiFi:  http://${a.address}:${PORT}`);
    }
  }
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    game.close();
    http.close();
    process.exit(0);
  });
}
