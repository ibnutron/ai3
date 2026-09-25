import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { hostname } from 'node:os';
import { basename, resolve } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { ChatSession } from '../session.js';
import { generateNonce, verifyChallenge } from '../auth.js';
import { apiRequest, machineIdFor, readAuth, relayHostUrl, serverUrl, type StoredAuth } from '../config.js';
import { findLatestSession } from '../persistence.js';
import { ask } from '../prompt.js';
import { resolveModel } from '../models.js';
import type { RelayFrame, WireMessage } from '../protocol.js';
import { applyPermissionMode, resolvePermissionMode, type PermissionOptions } from '../permissions.js';

interface ServeOptions extends PermissionOptions {
  port?: string;
  name?: string;
  model?: string;
  workspace: string;
  resume?: string;
  continue?: boolean;
  cert?: string;
  key?: string;
}

/** A connected, authenticated client — a direct WebSocket or one relayed through aiolah. */
interface Peer {
  send(message: WireMessage): void;
}

const MAX_AUTH_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const CONFIRM_TIMEOUT_MS = 5 * 60_000;
const RELAY_BACKOFF_MAX_MS = 30_000;
const RELAY_SILENCE_TIMEOUT_MS = 75_000;

/**
 * Two ways to be reachable:
 * - relay (default after `aiolah auth login`): dial out to the aiolah relay,
 *   no open port, no certificate, no token; the machine shows up on /code
 *   automatically.
 * - direct (`--port`): listen for WebSocket clients that authenticate with
 *   AIOLAH_REMOTE_TOKEN (LAN, self-hosting, or no aiolah account).
 */
export async function serveCommand(options: ServeOptions): Promise<void> {
  const workspaceRoot = resolve(options.workspace);
  const resumeId = options.resume ?? (options.continue ? findLatestSession()?.id : undefined);
  const auth = readAuth();

  if (options.port === undefined && !auth) {
    throw new Error(
      'Not logged in. Run `aiolah auth login` to control this machine from aiolah, ' +
        'or pass --port to accept direct connections with AIOLAH_REMOTE_TOKEN.',
    );
  }

  const peers = new Set<Peer>();
  const pendingConfirms = new Map<string, (allow: boolean) => void>();
  let busy = false;

  // Confirmation is answered by whoever responds first: an attached client
  // (`confirm_reply`) or the host operator typing y/n at the main prompt.
  // A single readline prompt is kept so we never stack two `question()`s.
  const confirm = applyPermissionMode(
    resolvePermissionMode(options),
    (description: string) =>
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
      }),
  );

  const session = new ChatSession({
    model: await resolveModel(options.model),
    workspaceRoot,
    confirm,
    resumeId,
  });

  session.on('tool', ({ name, input }) => {
    stdout.write(`\n[tool] ${name} ${JSON.stringify(input)}\n`);
    broadcast({ type: 'tool', name, input });
  });
  session.on('tool_result', ({ name, result }) => {
    broadcast({ type: 'tool_result', name, result });
  });

  function addPeer(peer: Peer): void {
    peers.add(peer);
    peer.send({
      type: 'authed',
      sessionId: session.sessionId,
      workspace: workspaceRoot,
      model: session.modelId,
      history: session.renderHistory(),
    });
    if (busy) {
      peer.send({ type: 'busy' });
    }
    stdout.write('\n[remote client connected]\n');
  }

  async function handlePeerMessage(peer: Peer, message: WireMessage): Promise<void> {
    if (message.type === 'confirm_reply') {
      pendingConfirms.get(message.id)?.(message.allow);
      return;
    }

    if (message.type === 'user') {
      if (busy) {
        peer.send({ type: 'error', text: 'busy' });
        return;
      }
      stdout.write(`\nremote> ${message.text}\n`);
      broadcast({ type: 'user', text: message.text }, peer);
      await runTurn(message.text);
    }
  }

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

  function broadcast(message: WireMessage, except?: Peer): void {
    for (const peer of peers) {
      if (peer !== except) {
        peer.send(message);
      }
    }
  }

  const banner =
    options.port === undefined
      ? await startRelay(auth as StoredAuth, workspaceRoot, options.name, {
          peers,
          addPeer,
          handlePeerMessage,
        })
      : startDirect(options, {
          addPeer,
          handlePeerMessage,
          removePeer: (peer) => peers.delete(peer),
        });

  stdout.write(
    `aiolah serve — ${banner}\nworkspace ${workspaceRoot}, session ${session.sessionId}\n` +
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

interface DirectHooks {
  addPeer(peer: Peer): void;
  removePeer(peer: Peer): void;
  handlePeerMessage(peer: Peer, message: WireMessage): Promise<void>;
}

/** Direct mode: listen on --port, clients answer an HMAC challenge with AIOLAH_REMOTE_TOKEN. */
function startDirect(options: ServeOptions, hooks: DirectHooks): string {
  const token = process.env.AIOLAH_REMOTE_TOKEN || randomBytes(16).toString('hex');
  const port = Number(options.port);
  const attemptsByIp = new Map<string, number[]>();

  const wss =
    options.cert && options.key
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
    const peer: Peer = { send: (message) => send(socket, message) };
    let attempts = 0;
    let authed = false;
    send(socket, { type: 'challenge', nonce });

    socket.on('message', (raw) => {
      void handleIncoming(raw.toString());
    });

    socket.on('close', () => hooks.removePeer(peer));

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
        hooks.addPeer(peer);
        return;
      }

      await hooks.handlePeerMessage(peer, message);
    }
  });

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
  return (
    `direct mode, listening on ${scheme}://localhost:${port}\n` +
    `Share this token with attach clients (never sent over the wire): ${token}`
  );
}

interface RelayHooks {
  peers: Set<Peer>;
  addPeer(peer: Peer): void;
  handlePeerMessage(peer: Peer, message: WireMessage): Promise<void>;
}

/**
 * Relay mode: register this machine as a device, then keep one outbound
 * WebSocket to the aiolah relay open (reconnecting with backoff). Each client
 * the relay pairs with us becomes a Peer addressed by its clientId.
 */
async function startRelay(
  auth: StoredAuth,
  workspaceRoot: string,
  customName: string | undefined,
  hooks: RelayHooks,
): Promise<string> {
  const server = serverUrl(auth);
  const name = customName?.trim() || `${hostname()} · ${basename(workspaceRoot) || workspaceRoot}`;

  const registration = await apiRequest<{ host_id?: number }>(server, '/api/v1/app/cli/hosts', {
    method: 'POST',
    token: auth.token,
    body: {
      machine_id: machineIdFor(workspaceRoot),
      name,
      workspace: workspaceRoot,
    },
  });
  if (registration.status === 401 || registration.status === 403) {
    throw new Error('Your aiolah login is no longer valid. Run `aiolah auth login` again.');
  }
  if (!registration.data.host_id) {
    throw new Error(`Could not register this machine with ${server} (HTTP ${registration.status}).`);
  }
  const hostId = registration.data.host_id;

  const relayPeers = new Map<string, Peer>();
  let backoff = 1000;

  const connect = (): void => {
    const socket = new WebSocket(relayHostUrl(server), {
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'X-Host-Id': String(hostId),
      },
    });
    let silenceTimer: NodeJS.Timeout | undefined;
    const resetSilenceTimer = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => socket.terminate(), RELAY_SILENCE_TIMEOUT_MS);
    };

    socket.on('open', () => {
      backoff = 1000;
      resetSilenceTimer();
      stdout.write('\n[connected to aiolah relay — open /code on aiolah to control this machine]\n');
    });
    socket.on('ping', resetSilenceTimer);

    socket.on('unexpected-response', (_request, response) => {
      if (response.statusCode === 401 || response.statusCode === 403) {
        stdout.write('\n[relay rejected this login — run `aiolah auth login` again]\n');
        process.exit(1);
      }
      socket.terminate();
    });

    socket.on('message', (raw) => {
      resetSilenceTimer();
      let frame: RelayFrame;
      try {
        frame = JSON.parse(raw.toString()) as RelayFrame;
      } catch {
        return;
      }

      if (frame.type === 'relay_client_joined') {
        const clientId = frame.clientId;
        const peer: Peer = {
          send: (message) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(
                JSON.stringify({
                  type: 'relay_msg',
                  to: clientId,
                  msg: message,
                } satisfies RelayFrame),
              );
            }
          },
        };
        relayPeers.set(clientId, peer);
        hooks.addPeer(peer);
      } else if (frame.type === 'relay_client_left') {
        const peer = relayPeers.get(frame.clientId);
        if (peer) {
          relayPeers.delete(frame.clientId);
          hooks.peers.delete(peer);
        }
      } else if (frame.type === 'relay_msg' && frame.from) {
        const peer = relayPeers.get(frame.from);
        if (peer) {
          void hooks.handlePeerMessage(peer, frame.msg);
        }
      }
    });

    socket.on('error', () => {
      // 'close' follows and schedules the reconnect.
    });

    socket.on('close', () => {
      clearTimeout(silenceTimer);
      for (const peer of relayPeers.values()) {
        hooks.peers.delete(peer);
      }
      relayPeers.clear();
      stdout.write(`\n[relay connection lost — retrying in ${Math.round(backoff / 1000)}s]\n`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, RELAY_BACKOFF_MAX_MS);
    });
  };

  connect();

  return `relay mode via ${server} as "${name}" (logged in as ${auth.user.email})`;
}

function send(socket: WebSocket, message: WireMessage): void {
  socket.send(JSON.stringify(message));
}
