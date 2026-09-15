import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { ChatSession } from '../session.js';
import { generateNonce, verifyChallenge } from '../auth.js';
import { findLatestSession } from '../persistence.js';
import { ask } from '../prompt.js';
import type { WireMessage } from '../protocol.js';

interface ServeOptions {
  port: string;
  model: string;
  workspace: string;
  resume?: string;
  continue?: boolean;
  yolo?: boolean;
  cert?: string;
  key?: string;
}

const MAX_AUTH_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const CONFIRM_TIMEOUT_MS = 5 * 60_000;

export async function serveCommand(options: ServeOptions): Promise<void> {
  const token = process.env.AI3_REMOTE_TOKEN ?? randomBytes(16).toString('hex');
  const port = Number(options.port);
  const workspaceRoot = resolve(options.workspace);
  const resumeId = options.resume ?? (options.continue ? findLatestSession()?.id : undefined);

  const clients = new Set<WebSocket>();
  const attemptsByIp = new Map<string, number[]>();
  const pendingConfirms = new Map<string, (allow: boolean) => void>();
  let busy = false;

  // Confirmation is answered by whoever responds first: an attached client
  // (`confirm_reply`) or the host operator typing y/n at the main prompt.
  // A single readline prompt is kept so we never stack two `question()`s.
  const confirm = options.yolo
    ? async () => true
    : (description: string) =>
        new Promise<boolean>((resolveConfirm) => {
          const id = randomBytes(6).toString('hex');
          const timer = setTimeout(() => settle(false), CONFIRM_TIMEOUT_MS);
          const settle = (allow: boolean) => {
            if (!pendingConfirms.has(id)) {
              return;
            }
            clearTimeout(timer);
            pendingConfirms.delete(id);
            resolveConfirm(allow);
          };
          pendingConfirms.set(id, settle);
          broadcast({ type: 'confirm', id, description });
          stdout.write(`\n[confirm] Allow ${description}? Type y or n here, or answer from a client.\n`);
        });

  const session = new ChatSession({ model: options.model, workspaceRoot, confirm, resumeId });

  session.on('tool', ({ name, input }) => {
    stdout.write(`\n[tool] ${name} ${JSON.stringify(input)}\n`);
    broadcast({ type: 'tool', name, input });
  });
  session.on('tool_result', ({ name, result }) => {
    broadcast({ type: 'tool_result', name, result });
  });

  const wss = options.cert && options.key
    ? new WebSocketServer({
        server: createHttpsServer({
          cert: readFileSync(options.cert),
          key: readFileSync(options.key),
        }).listen(port),
      })
    : new WebSocketServer({ port });

  wss.on('connection', (socket, request) => {
    const ip = request.socket.remoteAddress ?? 'unknown';
    if (isRateLimited(ip)) {
      send(socket, { type: 'error', text: 'rate limited' });
      socket.close();
      return;
    }

    const nonce = generateNonce();
    let attempts = 0;
    let authed = false;
    send(socket, { type: 'challenge', nonce });

    socket.on('message', (raw, isBinary) => {
      void handleIncoming(isBinary ? raw.toString() : raw.toString('utf8'));
    });

    socket.on('close', () => clients.delete(socket));

    async function handleIncoming(raw: string): Promise<void> {
      let message: WireMessage;
      try {
        message = JSON.parse(raw);
      } catch {
        send(socket, { type: 'error', text: 'invalid message' });
        return;
      }

      if (!authed) {
        if (message.type !== 'auth') {
          send(socket, { type: 'error', text: 'expected auth' });
          return;
        }
        attempts += 1;
        recordAttempt(ip);
        if (attempts > MAX_AUTH_ATTEMPTS || !verifyChallenge(token, nonce, message.hmac)) {
          send(socket, { type: 'error', text: 'unauthorized' });
          socket.close();
          return;
        }
        authed = true;
        clients.add(socket);
        send(socket, {
          type: 'authed',
          sessionId: session.sessionId,
          workspace: workspaceRoot,
          model: session.modelId,
          history: session.renderHistory(),
        });
        if (busy) {
          send(socket, { type: 'busy' });
        }
        stdout.write('\n[remote client connected]\n');
        return;
      }

      if (message.type === 'confirm_reply') {
        pendingConfirms.get(message.id)?.(message.allow);
        return;
      }

      if (message.type === 'user') {
        if (busy) {
          send(socket, { type: 'error', text: 'busy' });
          return;
        }
        stdout.write(`\nremote> ${message.text}\n`);
        broadcast({ type: 'user', text: message.text }, socket);
        await runTurn(message.text);
      }
    }
  });

  async function runTurn(text: string): Promise<void> {
    busy = true;
    broadcast({ type: 'busy' });
    try {
      const { reply } = await session.send(text);
      broadcast({ type: 'assistant', text: reply });
      stdout.write(`\nassistant> ${reply}\n\n`);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      broadcast({ type: 'error', text });
      stdout.write(`\n[error] ${text}\n\n`);
    } finally {
      busy = false;
      broadcast({ type: 'idle' });
    }
  }

  function broadcast(message: WireMessage, except?: WebSocket): void {
    for (const client of clients) {
      if (client !== except) {
        send(client, message);
      }
    }
  }

  function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const attempts = (attemptsByIp.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    attemptsByIp.set(ip, attempts);
    return attempts.length >= RATE_LIMIT_MAX_ATTEMPTS;
  }

  function recordAttempt(ip: string): void {
    const attempts = attemptsByIp.get(ip) ?? [];
    attempts.push(Date.now());
    attemptsByIp.set(ip, attempts);
  }

  const scheme = options.cert && options.key ? 'wss' : 'ws';
  stdout.write(
    `ai3 serve — listening on ${scheme}://localhost:${port}, workspace ${workspaceRoot}, session ${session.sessionId}\n` +
      `Share this token with attach clients (never sent over the wire): ${token}\n` +
      `Type here to chat locally too. Ctrl+C to stop.\n\n`,
  );

  const hostRl = readline.createInterface({ input: stdin, output: stdout });
  while (true) {
    const input = await ask(hostRl, 'you> ');
    if (input === null) {
      // stdin closed (e.g. launched from a non-interactive npm script) — keep
      // serving remote clients; the process ends on Ctrl+C or when killed.
      stdout.write('[local stdin closed — serving remote clients only]\n');
      return new Promise<never>(() => {});
    }
    const trimmed = input.trim();
    if (!trimmed) {
      continue;
    }
    const [pendingId] = pendingConfirms.keys();
    if (pendingId !== undefined && /^[yn]$/i.test(trimmed)) {
      pendingConfirms.get(pendingId)?.(trimmed.toLowerCase() === 'y');
      continue;
    }
    if (busy) {
      stdout.write('[busy — wait for the current turn to finish]\n');
      continue;
    }
    broadcast({ type: 'user', text: input });
    await runTurn(input);
  }
}

function send(socket: WebSocket, message: WireMessage): void {
  socket.send(JSON.stringify(message));
}
