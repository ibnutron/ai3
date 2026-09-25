import type Anthropic from '@anthropic-ai/sdk';
import { editFile, listDir, readFile, writeFile } from './fileTools.js';
import { runBash } from './bashTool.js';

/** Asks whether a mutating tool may run; `tool` is the tool name (write_file, edit_file, run_bash). */
export type ConfirmFn = (description: string, tool: string) => Promise<boolean>;

export const TOOL_SCHEMAS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a text file from the workspace.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the workspace root' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file in the workspace. Requires user confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace a unique occurrence of old_string with new_string in an existing file. Requires user confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root' },
        old_string: { type: 'string', description: 'Exact text to find (must be unique in the file)' },
        new_string: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_dir',
    description: 'List the contents of a directory in the workspace.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the workspace root, "." for root' } },
      required: ['path'],
    },
  },
  {
    name: 'run_bash',
    description: 'Run a shell command in the workspace root. Requires user confirmation.',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Shell command to execute' } },
      required: ['command'],
    },
  },
];

export interface ToolExecutionContext {
  workspaceRoot: string;
  confirm: ConfirmFn;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<string> {
  const { workspaceRoot, confirm } = context;

  switch (name) {
    case 'read_file':
      return readFile(workspaceRoot, String(input.path));

    case 'list_dir':
      return listDir(workspaceRoot, String(input.path)).join('\n');

    case 'write_file': {
      const path = String(input.path);
      if (!(await confirm(`write_file: ${path}`, 'write_file'))) {
        return 'User declined this action.';
      }
      writeFile(workspaceRoot, path, String(input.content));
      return `Wrote ${path}`;
    }

    case 'edit_file': {
      const path = String(input.path);
      if (!(await confirm(`edit_file: ${path}`, 'edit_file'))) {
        return 'User declined this action.';
      }
      editFile(workspaceRoot, path, String(input.old_string), String(input.new_string));
      return `Edited ${path}`;
    }

    case 'run_bash': {
      const command = String(input.command);
      if (!(await confirm(`run_bash: ${command}`, 'run_bash'))) {
        return 'User declined this action.';
      }
      const result = await runBash(workspaceRoot, command);
      return `exit code: ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
