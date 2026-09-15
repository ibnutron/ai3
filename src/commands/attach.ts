import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import WebSocket from 'ws';
import { signChallenge } from '../auth.js';
import { ask } from '../prompt.js';
import type { WireMessage } from '../protocol.js';

export async function attachCommand(address: string): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const token = process.env.AI3_REMOTE_TOKEN ?? (await rl.question('Remote token: '));

  const socket = new WebSocket(address);

  await new Promise<void>((resolveOpen, reject) => {
    socket.once('open', resolveOpen);
    socket.once('error', reject);
  });

  const authed = new Promise<void>((resolveAuthed, reject) => {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as WireMessage;

      if (message.type === 'challenge') {
        send(socket, { type: 'auth', hmac: signChallenge(token, message.nonce) });
        return;
      }
      if (message.type === 'authed') {
        resolveAuthed();
        return;
      }
      if (message.type === 'error') {
        reject(new Error(message.text));
        return;
      }
      if (message.type === 'assistant') {
        stdout.write(`\nassistant> ${message.text}\n\n`);
      } else if (message.type === 'tool') {
        stdout.write(`\n[tool] ${message.name} ${JSON.stringify(message.input)}\n`);
      }
    });
  });

  await authed;
  stdout.write(`ai3 attach — connected to ${address}. Type "exit" to quit.\n\n`);

  try {
    while (true) {
      const input = await ask(rl, 'you> ');
      if (input === null || input.trim().toLowerCase() === 'exit') {
        break;
      }
      if (!input.trim()) {
        continue;
      }
      send(socket, { type: 'user', text: input });
    }
  } finally {
    rl.close();
    socket.close();
  }
}

function send(socket: WebSocket, message: WireMessage): void {
  socket.send(JSON.stringify(message));
}
