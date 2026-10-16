import { WS_PATH } from '../net/protocol.ts';

/**
 * Where is the game server?
 *
 * By default the page and the WebSocket come from the same place (`npm run dev` / `npm run play`).
 * If the page is hosted somewhere that cannot run a WebSocket server (Vercel, Netlify, GitHub
 * Pages), point it at one that can:
 *   ?server=wss://my-server.example.com          (also remembered for next time)
 *   or type it into the "Online server" box in the menu
 *   or set VITE_SERVER_URL when building
 * Returns undefined for "same place as the page".
 */
const KEY = 'hollow.server';

/** Accepts host, host:port, http(s):// or ws(s):// and returns a ws(s):// URL ending in /ws. */
export function normalizeServer(input: string): string | undefined {
  let v = input.trim();
  if (!v) return undefined;
  if (!/^[a-z]+:\/\//i.test(v)) v = `${/^(localhost|\d|\[)/i.test(v) ? 'ws' : 'wss'}://${v}`;
  v = v.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  try {
    const u = new URL(v);
    if (u.pathname === '/' || u.pathname === '') u.pathname = WS_PATH;
    return u.toString();
  } catch {
    return undefined;
  }
}

export function savedServer(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveServer(value: string): void {
  try {
    if (value.trim()) localStorage.setItem(KEY, value.trim());
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

/** The server to connect to, or undefined to use the page's own origin. */
export function serverUrl(): string | undefined {
  const q = new URLSearchParams(location.search).get('server');
  if (q) saveServer(q);
  const raw = q ?? savedServer() ?? '';
  return normalizeServer(raw || (import.meta.env.VITE_SERVER_URL as string | undefined) || '');
}
