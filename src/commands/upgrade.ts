import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { stdout } from 'node:process';
import {
  PACKAGE_NAME,
  compareVersions,
  fetchRegistryInfo,
  isNpmInstall,
  packageRoot,
  packageVersion,
} from '../version.js';

interface UpgradeOptions {
  check?: boolean;
}

/** `aiolah upgrade [version]` — update the globally installed CLI from npm. */
export async function upgradeCommand(target: string | undefined, options: UpgradeOptions): Promise<void> {
  const current = packageVersion();
  const registry = await fetchRegistryInfo();

  if (!registry.latest) {
    throw new Error(`${PACKAGE_NAME} is not published on npm yet.`);
  }

  const wanted = target?.replace(/^v/, '') ?? registry.latest;
  if (!registry.versions.includes(wanted)) {
    throw new Error(`Version ${wanted} of ${PACKAGE_NAME} does not exist. Latest is ${registry.latest}.`);
  }

  stdout.write(`Installed: ${current}\nLatest:    ${registry.latest}\n`);

  if (wanted === current) {
    stdout.write('Already up to date.\n');
    return;
  }
  if (!target && compareVersions(current, registry.latest) > 0) {
    stdout.write('This build is newer than the latest published version; nothing to do.\n');
    return;
  }
  if (options.check) {
    stdout.write(`Run "aiolah upgrade" to install ${wanted}.\n`);
    return;
  }

  if (!isNpmInstall()) {
    throw new Error(
      `aiolah runs from a source checkout (${realpathSync(packageRoot())}). ` +
        'Update it with "git pull && npm install && npm run build" there instead.',
    );
  }

  stdout.write(`Installing ${PACKAGE_NAME}@${wanted}…\n`);
  const result = spawnSync('npm', ['install', '-g', `${PACKAGE_NAME}@${wanted}`], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error('npm install failed (on Linux/macOS a global install may need sudo).');
  }
  stdout.write(`Updated to ${wanted}.\n`);
}
