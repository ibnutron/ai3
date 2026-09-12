import { stdout } from 'node:process';
import { listSessions } from '../persistence.js';

export function sessionsListCommand(): void {
  const sessions = listSessions();
  if (sessions.length === 0) {
    stdout.write('No saved sessions.\n');
    return;
  }

  for (const session of sessions) {
    const firstUserMessage = session.history.find((message) => message.role === 'user');
    const snippet =
      typeof firstUserMessage?.content === 'string'
        ? firstUserMessage.content.slice(0, 60)
        : '(tool result)';
    stdout.write(
      `${session.id}  ${session.updatedAt}  ${session.workspace}\n  ${snippet}\n`,
    );
  }
}
