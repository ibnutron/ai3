import { spawn } from 'node:child_process';

const MAX_OUTPUT_CHARS = 20_000;
const TIMEOUT_MS = 120_000;
const MAX_BUFFER_CHARS = 10 * 1024 * 1024;

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated]` : text;
}

export function runBash(workspaceRoot: string, command: string, signal?: AbortSignal): Promise<BashResult> {
  return new Promise((resolvePromise) => {
    // Own process group (POSIX), so a timeout or an interrupt stops the whole
    // command — `sh -c "a && b"` children too — not just the shell.
    const posix = process.platform !== 'win32';
    const child = spawn(command, { cwd: workspaceRoot, shell: true, detached: posix });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_BUFFER_CHARS) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_BUFFER_CHARS) stderr += chunk.toString();
    });

    const stop = (): void => {
      try {
        if (posix && child.pid) {
          process.kill(-child.pid, 'SIGTERM');
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        // Already exited.
      }
    };
    const timer = setTimeout(stop, TIMEOUT_MS);
    if (signal?.aborted) {
      stop();
    } else {
      signal?.addEventListener('abort', stop, { once: true });
    }

    const finish = (exitCode: number, error?: string): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      resolvePromise({ stdout: truncate(stdout), stderr: truncate(error ? `${stderr}${error}` : stderr), exitCode });
    };
    child.on('error', (error) => finish(1, error.message));
    child.on('close', (code) => finish(code ?? 1));
  });
}
