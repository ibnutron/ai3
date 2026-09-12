import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { ChatSession } from '../session.js';
import type { WireMessage } from '../protocol.js';

interface ServeOptions {
  port: string;
  model: string;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const token = process.env.AI3_REMOTE_TOKEN ?? randomBytes(16).toString('hex');
  const port = Number(options.port);
  const session = new ChatSession(options.model);
  const clients = new Set<WebSocket>();

  const wss = new WebSocketServer({ port });

  wss.on('connection', (socket) => {
    let authed = false;

    socket.on('message', (raw, isBinary) => {
      void handleIncoming(isBinary ? raw.toString() : raw.toString('utf8'));
    });

    socket.on('close', () => clients.delete(socket));

    async function handleIncoming(raw: string): Promise<void> {
      let message: WireMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: 'error', text: 'invalid message' });
        return;
      }

      if (!authed) {
        if (message.type === 'auth' && message.token === token) {
          authed = true;
          clients.add(socket);
          stdout.write('\n[remote client connected]\n');
        } else {
          send(socket, { type: 'error', text: 'unauthorized' });
          socket.close();
        }
        return;
      }

      if (message.type === 'user') {
        stdout.write(`\nremote> ${message.text}\n`);
        await runTurn(message.text);
      }
    }
  });

  async function runTurn(text: string): Promise<void> {
    const { reply } = await session.send(text);
    broadcast({ type: 'assistant', text: reply });
    stdout.write(`\nassistant> ${reply}\n\n`);
  }

  function broadcast(message: WireMessage): void {
    for (const client of clients) {
      send(client, message);
    }
  }

  stdout.write(`ai3 serve — listening on ws://localhost:${port}\n`);
  stdout.write(`Share this token with attach clients: ${token}\n`);
  stdout.write(`Type here to chat locally too. Ctrl+C to stop.\n\n`);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  while (true) {
    const input = await rl.question('you> ');
    if (!input.trim()) {
      continue;
    }
    broadcast({ type: 'user', text: input });
    await runTurn(input);
  }
}

function send(socket: WebSocket, message: WireMessage): void {
  socket.send(JSON.stringify(message));
}
