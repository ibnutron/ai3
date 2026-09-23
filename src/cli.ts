#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { Command } from 'commander';
import { chatCommand } from './commands/chat.js';
import { serveCommand } from './commands/serve.js';
import { attachCommand } from './commands/attach.js';
import { sessionsListCommand } from './commands/sessions.js';
import { loginCommand, logoutCommand, statusCommand } from './commands/login.js';
import { relayCommand } from './commands/relay.js';

loadPackageEnv();

const program = new Command();

program.name('aiolah').description('Terminal AI CLI with remote control support').version('0.2.0');

// `aiolah auth login|logout|status` — device-code sign-in to aiolah.
const auth = program.command('auth').description('Manage your aiolah login');
auth
  .command('login')
  .description('Sign in to aiolah in your browser (no API key needed; usage is billed to your plan)')
  .option('--server <url>', 'aiolah server URL (default https://aiolah.com or $AIOLAH_SERVER)')
  .option('--no-browser', 'only print the URL, do not try to open a browser')
  .action(loginCommand);
auth.command('logout').description('Sign out and revoke this machine\'s token').action(logoutCommand);
auth.command('status').alias('list').description('Show which account and credentials are in use').action(statusCommand);

program
  .command('login')
  .description('Shortcut for "aiolah auth login"')
  .option('--server <url>', 'aiolah server URL')
  .option('--no-browser', 'only print the URL, do not try to open a browser')
  .action(loginCommand);
program.command('logout').description('Shortcut for "aiolah auth logout"').action(logoutCommand);

program
  .command('chat')
  .description('Start an interactive chat session in this terminal')
  .option('-m, --model <model>', 'Anthropic model id', 'claude-sonnet-5')
  .option('-w, --workspace <dir>', 'workspace root for file/bash tools', '.')
  .option('--resume <id>', 'resume a saved session by id')
  .option('--continue', 'resume the most recently updated session')
  .option('--yolo', 'skip confirmation prompts for write_file/edit_file/run_bash')
  .action(chatCommand);

program
  .command('serve')
  .description(
    'Let this machine be controlled remotely: via aiolah (/code, app, VS Code) after "aiolah auth login", ' +
      'or directly with --port and AIOLAH_REMOTE_TOKEN',
  )
  .option('-p, --port <port>', 'direct mode: listen on this port instead of connecting to the aiolah relay')
  .option('-n, --name <name>', 'relay mode: device name shown on /code')
  .option('-m, --model <model>', 'Anthropic model id', 'claude-sonnet-5')
  .option('-w, --workspace <dir>', 'workspace root for file/bash tools', '.')
  .option('--resume <id>', 'resume a saved session by id')
  .option('--continue', 'resume the most recently updated session')
  .option('--yolo', 'skip confirmation prompts for write_file/edit_file/run_bash')
  .option('--cert <path>', 'TLS certificate path (enables wss)')
  .option('--key <path>', 'TLS private key path (enables wss)')
  .action(serveCommand);

// `aiolah remote-control` / `aiolah rc`: serve this folder through the
// aiolah relay only (never opens a port), under an optional device name.
program
  .command('remote-control')
  .alias('rc')
  .description('Control this folder from aiolah /code, the app or VS Code (needs "aiolah auth login")')
  .argument('[name]', 'device name shown on /code (default: "<hostname> · <folder>")')
  .option('-n, --name <name>', 'device name shown on /code')
  .option('-m, --model <model>', 'Anthropic model id', 'claude-sonnet-5')
  .option('-w, --workspace <dir>', 'workspace root for file/bash tools', '.')
  .option('--resume <id>', 'resume a saved session by id')
  .option('--continue', 'resume the most recently updated session')
  .option('--yolo', 'skip confirmation prompts for write_file/edit_file/run_bash')
  .action((name: string | undefined, options: Parameters<typeof serveCommand>[0]) =>
    serveCommand({ ...options, name: options.name ?? name, port: undefined }),
  );

program
  .command('attach <address>')
  .description('Attach to a running "aiolah serve" session, e.g. aiolah attach ws://host:4317')
  .action(attachCommand);

program
  .command('relay')
  .description('Run the aiolah relay server (operators only; needs CLI_RELAY_SECRET)')
  .option('-p, --port <port>', 'port to listen on (127.0.0.1)', '4320')
  .option('--api <url>', 'aiolah Laravel base URL used to verify hosts (default $AIOLAH_SERVER)')
  .action(relayCommand);

const sessions = program.command('sessions').description('Manage saved chat sessions');
sessions.command('list').description('List saved sessions').action(sessionsListCommand);

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

/**
 * Loads the `.env` that sits next to this package (not the caller's cwd, so
 * `aiolah serve` launched from another repo's npm script still finds the key).
 * Variables already present in the environment win over the file.
 */
function loadPackageEnv(): void {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  let contents: string;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseEnv(contents))) {
    process.env[key] ??= value;
  }
}
