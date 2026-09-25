import type { Interface } from 'node:readline/promises';

interface LineBuffer {
  lines: string[];
  closed: boolean;
}

const buffers = new WeakMap<Interface, LineBuffer>();

/**
 * Lines that arrive while no question is pending (piped input read ahead of a
 * slow model reply) are emitted as 'line' events, which readline drops unless
 * someone listens. Keep them for the next `ask`.
 */
function bufferFor(rl: Interface): LineBuffer {
  let buffer = buffers.get(rl);
  if (!buffer) {
    const created: LineBuffer = { lines: [], closed: false };
    rl.on('line', (line) => created.lines.push(line));
    rl.on('close', () => (created.closed = true));
    buffers.set(rl, created);
    buffer = created;
  }
  return buffer;
}

/**
 * `rl.question()` throws ERR_USE_AFTER_CLOSE once stdin hits EOF (Ctrl+D, or a
 * piped script that ran out of lines). Treat that as "no more input" so the
 * command loops can exit cleanly instead of crashing.
 */
export async function ask(rl: Interface, prompt: string): Promise<string | null> {
  const buffer = bufferFor(rl);
  if (buffer.lines.length) {
    const line = buffer.lines.shift() as string;
    process.stdout.write(`${prompt}${line}\n`);
    return line;
  }
  if (buffer.closed) {
    return null;
  }
  try {
    return await rl.question(prompt);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') {
      return null;
    }
    throw error;
  }
}

/** Like `ask`, but doesn't echo what is typed (API keys). */
export async function askSecret(rl: Interface, prompt: string): Promise<string | null> {
  const output = rl as unknown as { _writeToOutput?: (text: string) => void; output?: NodeJS.WritableStream };
  const original = output._writeToOutput;
  output._writeToOutput = (text: string) => {
    // Show the prompt itself and line breaks, hide the characters typed.
    if (text.startsWith(prompt) || text === '\r\n' || text === '\n') {
      output.output?.write(text);
    }
  };
  try {
    return await ask(rl, prompt);
  } finally {
    output._writeToOutput = original;
    output.output?.write('\n');
  }
}

/** Numbered picker on a readline; returns the chosen index or null (empty/invalid answer). */
export async function pick(rl: Interface, title: string, options: string[]): Promise<number | null> {
  process.stdout.write(`\n${title}\n`);
  options.forEach((option, index) => process.stdout.write(`  ${String(index + 1).padStart(2)}. ${option}\n`));
  const answer = await ask(rl, 'Number (Enter to cancel): ');
  const index = Number(answer?.trim()) - 1;
  return Number.isInteger(index) && index >= 0 && index < options.length ? index : null;
}
