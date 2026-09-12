import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import WebSocket from 'ws';
import type { WireMessage } from '../protocol.js';

export async function attachCommand(address: string): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const token = process.env.AI3_REMOTE_TOKEN ?? (await rl.question('Remote token: '));

  const socket = new WebSocket(address);

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  send(socket, { type: 'auth', token });
  stdout.write(`ai3 attach — connected to ${address}. Type "exit" to quit.\n\n`);

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as WireMessage;
    if (message.type === 'assistant') {
      stdout.write(`\nassistant> ${message.text}\n\n`);
    } else if (message.type === 'error') {
      stdout.write(`\n[error] ${message.text}\n`);
    }
  });

  try {
    while (true) {
      const input = await rl.question('you> ');
      if (input.trim().toLowerCase() === 'exit') {
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
