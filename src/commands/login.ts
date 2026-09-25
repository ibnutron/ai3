import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { stdout } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { apiRequest, clearAuth, readAuth, serverUrl, writeAuth } from '../config.js';
import { PROVIDERS, activeSelection, isConnected, resolveProvider } from '../providers.js';

interface LoginOptions {
  server?: string;
  browser?: boolean;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  token?: string;
  user?: { name: string; email: string };
  error?: string;
}

/**
 * Device authorization flow: print a code, the user approves it in a browser
 * where they are already signed in to aiolah, and we receive a token scoped to
 * the CLI. No password or API key ever touches the terminal.
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
  const server = (options.server ?? serverUrl(null)).replace(/\/+$/, '');

  const start = await apiRequest<DeviceCodeResponse>(server, '/api/v1/app/cli/device-codes', {
    method: 'POST',
    body: { machine_name: hostname() },
  });
  if (start.status !== 200) {
    throw new Error(`Could not start login on ${server} (HTTP ${start.status}).`);
  }
  const codes = start.data;

  stdout.write(
    `\nTo sign in, open:\n\n  ${codes.verification_uri_complete}\n\n` +
      `and confirm this code: ${codes.user_code}\n\nWaiting for approval… (Ctrl+C to cancel)\n`,
  );
  if (options.browser !== false) {
    openBrowser(codes.verification_uri_complete);
  }

  const deadline = Date.now() + codes.expires_in * 1000;
  let interval = codes.interval * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    const poll = await apiRequest<TokenResponse>(server, '/api/v1/app/cli/device-codes/token', {
      method: 'POST',
      body: { device_code: codes.device_code },
    });

    if (poll.status === 200 && poll.data.token && poll.data.user) {
      writeAuth({ server, token: poll.data.token, user: poll.data.user });
      stdout.write(`\nLogged in as ${poll.data.user.name} <${poll.data.user.email}> on ${server}.\n`);
      return;
    }
    if (poll.status === 428) {
      continue;
    }
    if (poll.status === 429) {
      interval += 5000;
      continue;
    }
    if (poll.status === 403) {
      throw new Error('Login was denied in the browser.');
    }
    if (poll.status === 410) {
      break;
    }
    throw new Error(`Unexpected response while waiting for approval (HTTP ${poll.status}).`);
  }

  throw new Error('The login code expired. Run `aiolah auth login` again.');
}

export async function logoutCommand(): Promise<void> {
  const auth = readAuth();
  if (!auth) {
    stdout.write('Not logged in.\n');
    return;
  }
  try {
    await apiRequest(auth.server, '/api/v1/app/cli/token', { method: 'DELETE', token: auth.token });
  } catch {
    // Offline: still forget the token locally; it can be revoked from the web app.
  }
  clearAuth();
  stdout.write(`Logged out from ${auth.server}.\n`);
}

export async function statusCommand(): Promise<void> {
  const auth = readAuth();
  const active = activeSelection();
  const connected = PROVIDERS.filter((provider) => provider.kind !== 'aiolah' && isConnected(provider.id));
  stdout.write(
    `Active provider: ${resolveProvider()}${active?.model ? ` · ${active.model}` : ''}\n` +
      `Own keys: ${connected.length ? connected.map((provider) => provider.id).join(', ') : 'none (aiolah connect <provider>)'}\n`,
  );
  if (process.env.ANTHROPIC_API_KEY) {
    stdout.write('Model calls: ANTHROPIC_API_KEY is set, so chat uses your own Anthropic key.\n');
  }
  if (!auth) {
    stdout.write('Not logged in to aiolah. Run `aiolah auth login`.\n');
    process.exitCode = 1;
    return;
  }
  const me = await apiRequest<{ user?: { name: string; email: string } }>(auth.server, '/api/v1/app/cli/me', {
    token: auth.token,
  });
  if (me.status !== 200 || !me.data.user) {
    stdout.write(
      `Stored login for ${auth.server} is no longer valid (HTTP ${me.status}). Run \`aiolah auth login\`.\n`,
    );
    process.exitCode = 1;
    return;
  }
  stdout.write(`Logged in as ${me.data.user.name} <${me.data.user.email}> on ${auth.server}.\n`);
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  try {
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Headless machine: the URL above is enough.
  }
}
