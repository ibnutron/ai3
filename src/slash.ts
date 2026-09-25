import type { Interface } from 'node:readline/promises';
import { stdout } from 'node:process';
import type { ChatSession } from './session.js';
import { pick } from './prompt.js';
import { listSessions } from './persistence.js';
import { readAuth } from './config.js';
import {
  PROVIDERS,
  isConnected,
  listProviderModels,
  providerDef,
  resolveProviderModel,
  setActiveSelection,
} from './providers.js';
import { connectFlow, disconnectCommand } from './commands/connect.js';

const HELP = `Commands:
  /connect [provider]   connect aiolah or your own provider key
  /disconnect <provider> remove a provider's key (or sign out of aiolah)
  /provider [id]        switch provider (keeps the conversation)
  /model [id]           switch model (lists the provider's models without an id)
  /models               list the current provider's models
  /sessions             list saved sessions (resume with: aiolah -r <id>)
  /status               show provider, model, session and login
  /help                 this help
  /exit                 quit
`;

/** Handles one `/command` typed in `aiolah chat`. Returns 'exit' to quit. */
export async function handleSlash(line: string, rl: Interface, session: ChatSession): Promise<'handled' | 'exit'> {
  const [command = '', ...args] = line.trim().slice(1).split(/\s+/);
  const arg = args.join(' ').trim() || undefined;

  try {
    switch (command) {
      case 'help':
      case '?':
        stdout.write(HELP);
        return 'handled';

      case 'exit':
      case 'quit':
        return 'exit';

      case 'connect': {
        const result = await connectFlow(rl, arg);
        if (result) {
          switchTo(session, result.provider, result.model ?? (await resolveProviderModel(result.provider)));
        }
        return 'handled';
      }

      case 'disconnect':
        if (!arg) {
          stdout.write('Usage: /disconnect <provider>\n');
        } else {
          await disconnectCommand(arg);
        }
        return 'handled';

      case 'provider': {
        let id = arg;
        if (!id) {
          const connected = PROVIDERS.filter((provider) => isConnected(provider.id));
          const choice = await pick(
            rl,
            'Switch provider:',
            connected.map(
              (provider) => `${provider.id === session.providerId ? '●' : ' '} ${provider.name}  [${provider.id}]`,
            ),
          );
          if (choice === null) return 'handled';
          id = connected[choice]!.id;
        }
        if (!isConnected(id)) {
          stdout.write(`${providerDef(id).name} is not connected. Use /connect ${id}.\n`);
          return 'handled';
        }
        switchTo(session, id, await resolveProviderModel(id));
        return 'handled';
      }

      case 'model': {
        let model = arg;
        if (!model) {
          const models = (await listProviderModels(session.providerId)).slice(0, 60);
          const choice = await pick(
            rl,
            `Models on ${providerDef(session.providerId).name}:`,
            models.map((id) => `${id === session.modelId ? '●' : ' '} ${id}`),
          );
          if (choice === null) return 'handled';
          model = models[choice]!;
        }
        switchTo(session, session.providerId, model);
        return 'handled';
      }

      case 'models': {
        const models = await listProviderModels(session.providerId);
        stdout.write(models.map((id) => `${id === session.modelId ? '●' : ' '} ${id}`).join('\n') + '\n');
        return 'handled';
      }

      case 'sessions': {
        const sessions = listSessions().slice(0, 15);
        stdout.write(
          sessions.length
            ? sessions
                .map((item) => `${item.id}  ${item.updatedAt.slice(0, 16).replace('T', ' ')}  ${item.workspace}`)
                .join('\n') + '\n'
            : 'No saved sessions.\n',
        );
        return 'handled';
      }

      case 'status': {
        const auth = readAuth();
        stdout.write(
          `provider  ${providerDef(session.providerId).name} [${session.providerId}]\n` +
            `model     ${session.modelId}\n` +
            `session   ${session.sessionId}\n` +
            `workspace ${session.workspace}\n` +
            `aiolah    ${auth ? `signed in as ${auth.user.email}` : 'not signed in'}\n`,
        );
        return 'handled';
      }

      default:
        stdout.write(`Unknown command /${command}. Type /help.\n`);
        return 'handled';
    }
  } catch (error) {
    stdout.write(`[error] ${error instanceof Error ? error.message : String(error)}\n`);
    return 'handled';
  }
}

function switchTo(session: ChatSession, provider: string, model: string): void {
  session.useModel(provider, model);
  setActiveSelection(provider, model);
  stdout.write(`Now using ${providerDef(provider).name} · ${model}\n`);
}
