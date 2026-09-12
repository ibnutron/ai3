import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export class WorkspaceViolationError extends Error {}

/** Resolves `targetPath` against `workspaceRoot`, refusing anything that escapes it. */
export function resolveInWorkspace(workspaceRoot: string, targetPath: string): string {
  const resolved = isAbsolute(targetPath)
    ? resolve(targetPath)
    : resolve(workspaceRoot, targetPath);
  const rel = relative(workspaceRoot, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new WorkspaceViolationError(`Path "${targetPath}" is outside the workspace`);
  }
  return resolved;
}

export function readFile(workspaceRoot: string, path: string): string {
  return readFileSync(resolveInWorkspace(workspaceRoot, path), 'utf8');
}

export function writeFile(workspaceRoot: string, path: string, content: string): void {
  const absolute = resolveInWorkspace(workspaceRoot, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

export function editFile(
  workspaceRoot: string,
  path: string,
  oldString: string,
  newString: string,
): void {
  const absolute = resolveInWorkspace(workspaceRoot, path);
  const content = readFileSync(absolute, 'utf8');
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) {
    throw new Error(`old_string not found in ${path}`);
  }
  if (occurrences > 1) {
    throw new Error(`old_string is not unique in ${path} (${occurrences} matches)`);
  }
  writeFileSync(absolute, content.replace(oldString, newString), 'utf8');
}

export function listDir(workspaceRoot: string, path: string): string[] {
  const absolute = resolveInWorkspace(workspaceRoot, path);
  return readdirSync(absolute).map((entry) => {
    const isDir = statSync(join(absolute, entry)).isDirectory();
    return isDir ? `${entry}/` : entry;
  });
}

export function pathExists(workspaceRoot: string, path: string): boolean {
  try {
    return existsSync(resolveInWorkspace(workspaceRoot, path));
  } catch {
    return false;
  }
}
