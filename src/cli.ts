#!/usr/bin/env node
import { Command } from 'commander';
import { chatCommand } from './commands/chat.js';
import { serveCommand } from './commands/serve.js';
import { attachCommand } from './commands/attach.js';
import { sessionsListCommand } from './commands/sessions.js';

const program = new Command();

program.name('ai3').description('Terminal AI CLI with remote control support').version('0.1.0');

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
  .description('Host the current chat session so a remote "ai3 attach" client can join')
  .option('-p, --port <port>', 'port to listen on', '4317')
  .option('-m, --model <model>', 'Anthropic model id', 'claude-sonnet-5')
  .option('-w, --workspace <dir>', 'workspace root for file/bash tools', '.')
  .option('--resume <id>', 'resume a saved session by id')
  .option('--continue', 'resume the most recently updated session')
  .option('--yolo', 'skip confirmation prompts for write_file/edit_file/run_bash')
  .option('--cert <path>', 'TLS certificate path (enables wss)')
  .option('--key <path>', 'TLS private key path (enables wss)')
  .action(serveCommand);

program
  .command('attach <address>')
  .description('Attach to a running "ai3 serve" session, e.g. ai3 attach ws://host:4317')
  .action(attachCommand);

const sessions = program.command('sessions').description('Manage saved chat sessions');
sessions.command('list').description('List saved sessions').action(sessionsListCommand);

program.parse();
