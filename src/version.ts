import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_NAME = '@aiolah/cli';

/** Directory containing this package's package.json (works from dist/ and from src/ via tsx). */
export function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

export function packageVersion(): string {
  return (JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as { version: string }).version;
}

/** True when running from a global npm install rather than a source checkout / `npm link`. */
export function isNpmInstall(): boolean {
  return realpathSync(packageRoot()).split(sep).includes('node_modules');
}

export interface RegistryInfo {
  latest: string | null;
  versions: string[];
}

export async function fetchRegistryInfo(): Promise<RegistryInfo> {
  const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME.replace('/', '%2F')}`, {
    headers: { Accept: 'application/vnd.npm.install-v1+json' },
  });
  if (response.status === 404) {
    return { latest: null, versions: [] };
  }
  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status}`);
  }
  const data = (await response.json()) as { 'dist-tags'?: { latest?: string }; versions?: Record<string, unknown> };
  return { latest: data['dist-tags']?.latest ?? null, versions: Object.keys(data.versions ?? {}) };
}

/** Numeric semver compare (ignores pre-release tags): <0 if a<b, 0 if equal, >0 if a>b. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .split('-')[0]!
      .split('.')
      .map((part) => Number(part) || 0);
  const [left, right] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
