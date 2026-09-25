import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Credentials written by `aiolah auth login`: a Sanctum token with the `cli`
 * ability for the aiolah server. Stored at ~/.aiolah/auth.json with mode 0600.
 */
export interface StoredAuth {
  server: string;
  token: string;
  user: { name: string; email: string };
}

export const DEFAULT_SERVER = 'https://aiolah.com';

const CONFIG_DIR = join(homedir(), '.aiolah');
const AUTH_FILE = join(CONFIG_DIR, 'auth.json');
const MACHINE_ID_FILE = join(CONFIG_DIR, 'machine-id');

export function readAuth(): StoredAuth | null {
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as StoredAuth;
  } catch {
    return null;
  }
}

export function writeAuth(auth: StoredAuth): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { encoding: 'utf8', mode: 0o600 });
  chmodSync(AUTH_FILE, 0o600);
}

export function clearAuth(): void {
  rmSync(AUTH_FILE, { force: true });
}

/** `AIOLAH_SERVER` wins, then the server the user logged in to, then aiolah.com. */
export function serverUrl(auth: StoredAuth | null = readAuth()): string {
  return (process.env.AIOLAH_SERVER || auth?.server || DEFAULT_SERVER).replace(/\/+$/, '');
}

/** Relay endpoint a logged-in `aiolah serve` dials out to. */
export function relayHostUrl(server: string): string {
  const base = process.env.AIOLAH_RELAY_URL || `${server.replace(/^http/i, 'ws')}/cli-relay`;
  return `${base.replace(/\/+$/, '')}/host`;
}

/**
 * Stable id for this machine + workspace, so re-running `aiolah serve` in the
 * same folder updates the same device on /code instead of adding a new one.
 */
export function machineIdFor(workspaceRoot: string): string {
  let machineId: string;
  try {
    machineId = readFileSync(MACHINE_ID_FILE, 'utf8').trim();
  } catch {
    machineId = '';
  }
  if (!machineId) {
    machineId = randomUUID();
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(MACHINE_ID_FILE, machineId, { encoding: 'utf8', mode: 0o600 });
  }
  return createHash('sha256').update(`${machineId}:${workspaceRoot}`).digest('hex').slice(0, 32);
}

/** Small JSON helper for the aiolah API; throws with the server's message on failure. */
export async function apiRequest<T>(
  server: string,
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${server}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text.slice(0, 200) };
  }
  return { status: response.status, data: data as T };
}
