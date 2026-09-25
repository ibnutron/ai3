import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { ChatSession } from '../session.js';
import { SessionSync } from '../sessionSync.js';
import { findLatestSession } from '../persistence.js';
import { ask } from '../prompt.js';
import { resolveModel } from '../models.js';
import { applyPermissionMode, resolvePermissionMode, type PermissionOptions } from '../permissions.js';

interface ChatOptions extends PermissionOptions {
  model?: string;
  workspace: string;
  resume?: string;
  continue?: boolean;
}

export async function chatCommand(options: ChatOptions): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const workspaceRoot = resolve(options.workspace);

  const resumeId = options.resume ?? (options.continue ? findLatestSession()?.id : undefined);

  const confirm = applyPermissionMode(resolvePermissionMode(options), async (description) => {
    const answer = await ask(rl, `Allow ${description}? [y/N] `);
    return answer?.trim().toLowerCase() === 'y';
  });

  const session = new ChatSession({ model: await resolveModel(options.model), workspaceRoot, confirm, resumeId });

  session.on('tool', ({ name, input }) => {
    stdout.write(`\n[tool] ${name} ${JSON.stringify(input)}\n`);
  });
  const sync = SessionSync.attach(session, { origin: 'terminal' });

  stdout.write(
    `aiolah chat — model ${session.modelId}, workspace ${workspaceRoot}, session ${session.sessionId}\n` +
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

      try {
        const { reply } = await session.send(input);
        stdout.write(`\nassistant> ${reply}\n\n`);
      } catch (error) {
        stdout.write(`\n[error] ${error instanceof Error ? error.message : String(error)}\n\n`);
      }
    }
  } finally {
    rl.close();
    await sync?.flush();
  }
}
