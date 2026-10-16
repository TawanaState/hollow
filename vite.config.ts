import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin, ResolvedConfig } from 'vite';
import { attachGameServer } from './server/gameServer.ts';

/** `npm run dev` also hosts the game WebSocket (at /ws), so online play works with one command. */
const gameServer = (): Plugin => ({
  name: 'hollow-game-server',
  configureServer(server) {
    if (server.httpServer) attachGameServer(server.httpServer);
  },
  configurePreviewServer(server) {
    attachGameServer(server.httpServer);
  },
});

/** Every file under dir, as /paths relative to it. */
function walk(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, root) : ['/' + relative(root, full).replaceAll('\\', '/')];
  });
}

/**
 * Offline support without a dependency: after the build, list every emitted file and write
 * dist/sw.js from scripts/sw.template.js. The version is a hash of the file contents, so a new
 * build means a new cache and old ones are deleted. The dev-only sandbox is left out.
 */
const offline = (): Plugin => {
  let config: ResolvedConfig;
  return {
    name: 'hollow-offline',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    writeBundle() {
      const dist = resolve(config.root, config.build.outDir);
      const files = walk(dist).filter((f) => f !== '/sw.js' && !f.includes('sandbox'));
      const hash = createHash('sha1');
      for (const f of files) hash.update(f).update(readFileSync(join(dist, f)));
      const precache = ['/', ...files];
      const template = readFileSync(resolve(config.root, 'scripts/sw.template.js'), 'utf8');
      writeFileSync(
        join(dist, 'sw.js'),
        template.replace('__VERSION__', `hollow-${hash.digest('hex').slice(0, 10)}`).replace('__PRECACHE__', JSON.stringify(precache)),
      );
    },
  };
};

export default defineConfig({
  plugins: [gameServer(), offline()],
  // host: true exposes the dev server on your LAN so phones can connect.
  server: { host: true },
  preview: { host: true },
  build: {
    rollupOptions: {
      input: { main: 'index.html', sandbox: 'sandbox.html' },
    },
  },
});
