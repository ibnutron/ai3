import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { ChatSession } from '../session.js';
import { SessionSync } from '../sessionSync.js';
import { findLatestSession } from '../persistence.js';
import { ask } from '../prompt.js';
import { handleSlash } from '../slash.js';
import { resolveProvider, resolveProviderModel } from '../providers.js';
import { applyPermissionMode, resolvePermissionMode, type PermissionOptions } from '../permissions.js';

interface ChatOptions extends PermissionOptions {
  model?: string;
  provider?: string;
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

  // A provider without a chosen model still opens the chat, so /model can pick one.
  const provider = resolveProvider(options.provider);
  let model = '';
  let modelHint: string | undefined;
  try {
    model = await resolveProviderModel(provider, options.model);
  } catch (error) {
    modelHint = error instanceof Error ? error.message : String(error);
  }
  const session = new ChatSession({ provider, model, workspaceRoot, confirm, resumeId });

  session.on('tool', ({ name, input }) => {
    stdout.write(`\n[tool] ${name} ${JSON.stringify(input)}\n`);
  });
  const sync = SessionSync.attach(session, { origin: 'terminal' });

  stdout.write(
    `aiolah chat — ${session.providerId} · ${session.modelId || 'no model'}, workspace ${workspaceRoot}, session ${session.sessionId}\n` +
      `Type /help for commands, "exit" to quit.\n`,
  );
  if (modelHint) {
    stdout.write(`${modelHint}\n`);
  }

  try {
    while (true) {
      const input = await ask(rl, 'you> ');
      if (input === null || input.trim().toLowerCase() === 'exit') {
        break;
      }
      if (!input.trim()) {
        continue;
      }
      if (input.trim().startsWith('/')) {
        if ((await handleSlash(input, rl, session)) === 'exit') break;
        continue;
      }

      if (!session.modelId) {
        stdout.write('Choose a model first: /model\n');
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
