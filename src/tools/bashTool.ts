import { exec } from 'node:child_process';

const MAX_OUTPUT_CHARS = 20_000;
const TIMEOUT_MS = 120_000;

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated]`
    : text;
}

export function runBash(workspaceRoot: string, command: string): Promise<BashResult> {
  return new Promise((resolvePromise) => {
    exec(
      command,
      { cwd: workspaceRoot, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolvePromise({
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          exitCode: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
        });
      },
    );
  });
}
