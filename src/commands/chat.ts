import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ChatSession } from '../session.js';

interface ChatOptions {
  model: string;
}

export async function chatCommand(options: ChatOptions): Promise<void> {
  const session = new ChatSession(options.model);
  const rl = readline.createInterface({ input: stdin, output: stdout });

  stdout.write(`ai3 chat — model ${options.model}. Type "exit" to quit.\n`);

  try {
    while (true) {
      const input = await rl.question('you> ');
      if (input.trim().toLowerCase() === 'exit') {
        break;
      }
      if (!input.trim()) {
        continue;
      }

      const { reply } = await session.send(input);
      stdout.write(`\nassistant> ${reply}\n\n`);
    }
  } finally {
    rl.close();
  }
}
