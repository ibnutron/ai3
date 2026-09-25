import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { stdout } from 'node:process';
import WebSocket, { WebSocketServer } from 'ws';
import { DEFAULT_SERVER } from '../config.js';
import { SESSION_SELECTOR, type RelayFrame, type WireMessage } from '../protocol.js';

interface RelayOptions {
  port: string;
  api?: string;
}

interface HostEntry {
  socket: WebSocket;
  userId: number;
  clients: Map<string, WebSocket>;
}

const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const PING_INTERVAL_MS = 30_000;
const CLIENT_MESSAGE_TYPES = new Set([
  'user',
  'confirm_reply',
  'open_session',
  'list_models',
  'set_model',
  'interrupt',
]);

/**
 * `aiolah relay` — the rendezvous point that lets a logged-in `aiolah serve`
 * be controlled from aiolah /code, ai6 and ai4 without opening a port on the
 * host (the host dials out).
 *
 * - `/host`: `aiolah serve` connects with its CLI token + host id; verified
 *   against Laravel (`POST /api/cli/relay/host-online`).
 * - `/client?ticket=`: a browser/app connects with a one-time ticket issued
 *   by Laravel for that host; verified locally with CLI_RELAY_SECRET.
 *
 * The relay only forwards JSON frames and keeps no conversation state.
 * Run it behind a TLS reverse proxy (e.g. nginx `location /cli-relay/`).
 */
export async function relayCommand(options: RelayOptions): Promise<void> {
  const secret = process.env.CLI_RELAY_SECRET;
  if (!secret) {
    throw new Error('CLI_RELAY_SECRET is not set (must match the Laravel app).');
  }
  const api = (options.api || process.env.AIOLAH_SERVER || DEFAULT_SERVER).replace(/\/+$/, '');
  const port = Number(options.port);

  const hosts = new Map<number, HostEntry>();
  const usedNonces = new Map<string, number>();
  const alive = new WeakMap<WebSocket, boolean>();

  const httpServer = createServer((request, response) => {
    const healthy = request.url?.endsWith('/health');
    response.writeHead(healthy ? 200 : 404, { 'Content-Type': 'text/plain' });
    response.end(healthy ? 'ok' : 'not found');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  httpServer.on('upgrade', (request, socket, head) => {
    void handleUpgrade(request, socket, head).catch((error: unknown) => {
      stdout.write(`[relay] upgrade failed: ${error instanceof Error ? error.message : String(error)}\n`);
      reject(socket, 502);
    });
  });

  async function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://relay');
    const path = url.pathname.replace(/\/+$/, '');

    if (path.endsWith('/host')) {
      const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')?.[1];
      const hostId = Number(request.headers['x-host-id']);
      if (!token || !Number.isInteger(hostId) || hostId <= 0) {
        reject(socket, 401);
        return;
      }
      const verified = await callApi('/api/cli/relay/host-online', { token, host_id: hostId });
      if (verified.status !== 200) {
        reject(socket, verified.status === 404 ? 403 : 401);
        return;
      }
      const userId = Number((verified.data as { user_id: number }).user_id);
      wss.handleUpgrade(request, socket, head, (ws) => attachHost(ws, hostId, userId));
      return;
    }

    if (path.endsWith('/client')) {
      const ticket = verifyTicket(url.searchParams.get('ticket') ?? '');
      if (!ticket) {
        reject(socket, 401);
        return;
      }
      const session = url.searchParams.get('session') ?? undefined;
      if (session !== undefined && !SESSION_SELECTOR.test(session)) {
        reject(socket, 404);
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => attachClient(ws, ticket.hostId, ticket.userId, session));
      return;
    }

    reject(socket, 404);
  }

  function attachHost(ws: WebSocket, hostId: number, userId: number): void {
    const previous = hosts.get(hostId);
    if (previous) {
      closeClients(previous, 'host reconnected');
      previous.socket.close(4000, 'replaced by a newer connection');
    }
    const entry: HostEntry = { socket: ws, userId, clients: new Map() };
    hosts.set(hostId, entry);
    track(ws);
    stdout.write(`[relay] host ${hostId} connected\n`);

    ws.on('message', (raw) => {
      let frame: RelayFrame;
      try {
        frame = JSON.parse(raw.toString()) as RelayFrame;
      } catch {
        return;
      }
      if (frame.type !== 'relay_msg') {
        return;
      }
      const payload = JSON.stringify(frame.msg);
      if (frame.to) {
        sendRaw(entry.clients.get(frame.to), payload);
      } else {
        for (const client of entry.clients.values()) {
          sendRaw(client, payload);
        }
      }
    });

    ws.on('close', () => {
      if (hosts.get(hostId) !== entry) {
        return;
      }
      hosts.delete(hostId);
      closeClients(entry, 'host disconnected');
      stdout.write(`[relay] host ${hostId} disconnected\n`);
      void callApi('/api/cli/relay/host-offline', { host_id: hostId }).catch(() => {});
    });
  }

  function attachClient(ws: WebSocket, hostId: number, userId: number, session?: string): void {
    const entry = hosts.get(hostId);
    if (!entry || entry.userId !== userId) {
      sendMessage(ws, { type: 'error', text: 'host offline' });
      ws.close(4404, 'host offline');
      return;
    }

    const clientId = randomBytes(8).toString('hex');
    entry.clients.set(clientId, ws);
    track(ws);
    sendFrame(entry.socket, { type: 'relay_client_joined', clientId, ...(session ? { session } : {}) });

    ws.on('message', (raw) => {
      let message: WireMessage;
      try {
        message = JSON.parse(raw.toString()) as WireMessage;
      } catch {
        sendMessage(ws, { type: 'error', text: 'invalid message' });
        return;
      }
      if (!CLIENT_MESSAGE_TYPES.has(message.type)) {
        return;
      }
      sendFrame(entry.socket, { type: 'relay_msg', from: clientId, msg: message });
    });

    ws.on('close', () => {
      if (entry.clients.delete(clientId)) {
        sendFrame(entry.socket, { type: 'relay_client_left', clientId });
      }
    });
  }

  function closeClients(entry: HostEntry, reason: string): void {
    for (const client of entry.clients.values()) {
      sendMessage(client, { type: 'error', text: reason });
      client.close(4410, reason);
    }
    entry.clients.clear();
  }

  /** Mirrors App\Services\CliRelayTicket: "{host}.{user}.{exp}.{nonce}.{hmac}", single use. */
  function verifyTicket(ticket: string): { hostId: number; userId: number } | null {
    const parts = ticket.split('.');
    if (parts.length !== 5) {
      return null;
    }
    const [hostId, userId, expires, nonce, signature] = parts as [string, string, string, string, string];
    const expected = Buffer.from(
      createHmac('sha256', secret as string)
        .update([hostId, userId, expires, nonce].join('.'))
        .digest('hex'),
    );
    const actual = Buffer.from(signature);
    const now = Math.floor(Date.now() / 1000);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual) || Number(expires) < now) {
      return null;
    }
    if (usedNonces.has(nonce)) {
      return null;
    }
    usedNonces.set(nonce, Number(expires));
    return { hostId: Number(hostId), userId: Number(userId) };
  }

  async function callApi(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
    const response = await fetch(`${api}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Relay-Secret': secret as string,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: response.status, data };
  }

  function track(ws: WebSocket): void {
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
  }

  setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
    const now = Math.floor(Date.now() / 1000);
    for (const [nonce, expires] of usedNonces) {
      if (expires < now) {
        usedNonces.delete(nonce);
      }
    }
  }, PING_INTERVAL_MS).unref();

  await new Promise<void>((resolveListen) => httpServer.listen(port, '127.0.0.1', resolveListen));
  stdout.write(`aiolah relay — listening on ws://127.0.0.1:${port} (verifying hosts against ${api})\n`);
  await new Promise<never>(() => {});
}

function reject(socket: Duplex, status: number): void {
  const text = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 502: 'Bad Gateway' }[status] ?? 'Error';
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function sendRaw(ws: WebSocket | undefined, payload: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(payload);
  }
}

function sendMessage(ws: WebSocket, message: WireMessage): void {
  sendRaw(ws, JSON.stringify(message));
}

function sendFrame(ws: WebSocket, frame: RelayFrame): void {
  sendRaw(ws, JSON.stringify(frame));
}
