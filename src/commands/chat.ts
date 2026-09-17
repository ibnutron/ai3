import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { ChatSession } from '../session.js';
import { findLatestSession } from '../persistence.js';
import { ask } from '../prompt.js';

interface ChatOptions {
  model: string;
  workspace: string;
  resume?: string;
  continue?: boolean;
  yolo?: boolean;
}

export async function chatCommand(options: ChatOptions): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const workspaceRoot = resolve(options.workspace);

  const resumeId = options.resume ?? (options.continue ? findLatestSession()?.id : undefined);

  const confirm = options.yolo
    ? async () => true
    : async (description: string) => {
        const answer = await ask(rl, `Allow ${description}? [y/N] `);
        return answer?.trim().toLowerCase() === 'y';
      };

  const session = new ChatSession({ model: options.model, workspaceRoot, confirm, resumeId });

  session.on('tool', ({ name, input }) => {
    stdout.write(`\n[tool] ${name} ${JSON.stringify(input)}\n`);
  });

  stdout.write(
    `aiocli chat — model ${options.model}, workspace ${workspaceRoot}, session ${session.sessionId}\n` +
      `Type "exit" to quit.\n`,
  );

  try {
    while (true) {
      const input = await ask(rl, 'you> ');
      if (input === null || input.trim().toLowerCase() === 'exit') {
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
