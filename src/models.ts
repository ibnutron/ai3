import { apiRequest, readAuth, serverUrl } from './config.js';

/** Default when calling Anthropic directly with the user's own ANTHROPIC_API_KEY. */
export const DIRECT_DEFAULT_MODEL = 'claude-sonnet-5';

export interface CliModel {
  id: string;
  name: string;
  provider: string;
  developer: string | null;
  tier: string;
  featured: boolean;
}

/**
 * Coding models the logged-in account's plan may use, read live from aiolah —
 * models activated by an admin (or a plan upgrade) show up without a CLI release.
 */
export async function fetchModels(): Promise<{ default: string | null; data: CliModel[] }> {
  const auth = readAuth();
  if (!auth) {
    throw new Error('Not logged in. Run `aiolah auth login` (or set ANTHROPIC_API_KEY to use your own key).');
  }
  const response = await apiRequest<{ default: string | null; data: CliModel[] }>(serverUrl(auth), '/api/cli/models', {
    token: auth.token,
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Your aiolah login is no longer valid. Run `aiolah auth login` again.');
  }
  if (response.status !== 200) {
    throw new Error(`Could not load models from aiolah (HTTP ${response.status}).`);
  }
  return response.data;
}

/** `--model` wins; otherwise Claude on a personal key, or the account's default model on aiolah. */
export async function resolveModel(explicit?: string): Promise<string> {
  if (explicit) {
    return explicit;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return DIRECT_DEFAULT_MODEL;
  }
  const { default: fallback } = await fetchModels();
  if (!fallback) {
    throw new Error('No coding model is available for your aiolah plan right now.');
  }
  return fallback;
}
