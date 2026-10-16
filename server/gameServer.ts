import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Http2SecureServer } from 'node:http2';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { Emitter } from '../src/net/transport.ts';
import type { Transport } from '../src/net/transport.ts';
import { decodeClient, encode, WS_PATH } from '../src/net/protocol.ts';
import type { ClientMsg, ServerMsg } from '../src/net/protocol.ts';
import { RoomManager } from './room.ts';

/** Adapt a `ws` socket to the game's Transport interface (JSON text frames, validated). */
export function wsTransport(ws: WebSocket): Transport<ServerMsg, ClientMsg> {
  const messages = new Emitter<ClientMsg>();
  const closes = new Emitter<void>();
  ws.on('message', (data) => {
    const msg = decodeClient(data.toString());
    if (msg) messages.emit(msg);
  });
  ws.on('close', () => closes.emit());
  ws.on('error', () => ws.terminate());
  return {
    get isOpen() {
      return ws.readyState === ws.OPEN;
    },
    send: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(encode(msg));
    },
    onMessage: (fn) => messages.on(fn),
    onClose: (fn) => closes.on(fn),
    close: () => ws.close(),
  };
}

export interface GameServer {
  rooms: RoomManager;
  close(): void;
}

/**
 * Attach the game server to any Node http server (the production server or Vite's dev
 * server). It only claims WebSocket upgrades on WS_PATH, so Vite's own HMR socket is untouched.
 */
export function attachGameServer(server: HttpServer | Http2SecureServer): GameServer {
  const http = server as HttpServer; // only the 'upgrade' event is used, which both share
  const rooms = new RoomManager();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  wss.on('connection', (ws: WebSocket) => rooms.accept(wsTransport(ws)));

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== WS_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  http.on('upgrade', onUpgrade);

  return {
    rooms,
    close() {
      http.off('upgrade', onUpgrade);
      rooms.closeAll();
      for (const c of wss.clients) c.terminate();
      wss.close();
    },
  };
}
