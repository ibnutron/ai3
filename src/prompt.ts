import type { Interface } from 'node:readline/promises';

/**
 * `rl.question()` throws ERR_USE_AFTER_CLOSE once stdin hits EOF (Ctrl+D, or a
 * piped script that ran out of lines). Treat that as "no more input" so the
 * command loops can exit cleanly instead of crashing.
 */
export async function ask(rl: Interface, prompt: string): Promise<string | null> {
  try {
    return await rl.question(prompt);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') {
      return null;
    }
    throw error;
  }
}
