import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readAuth } from './config.js';
import { fetchModels } from './models.js';

/**
 * How the CLI talks to a provider:
 * - `aiolah`: your aiolah account (`aiolah auth login`), billed to your plan;
 * - `anthropic`: Anthropic Messages API with your own key;
 * - `openai`: any OpenAI-compatible Chat Completions API with your own key
 *   (translated to/from the CLI's internal Anthropic format, tools included).
 */
export type ProviderKind = 'aiolah' | 'anthropic' | 'openai';

export interface ProviderDef {
  id: string;
  name: string;
  kind: ProviderKind;
  baseURL?: string;
  /** Environment variable that also supplies the key. */
  envKey?: string;
  /** False for providers that need no key (aiolah login, a local Ollama). */
  needsKey: boolean;
  /** Where to create a key. */
  keyUrl?: string;
  /** Model used when none is chosen (only where the id is stable). */
  defaultModel?: string;
  popular?: boolean;
}

export const PROVIDERS: ProviderDef[] = [
  { id: 'aiolah', name: 'aiolah (your plan)', kind: 'aiolah', needsKey: false, popular: true },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    envKey: 'ANTHROPIC_API_KEY',
    needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-sonnet-5',
    popular: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseURL: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    popular: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseURL: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/settings/keys',
    popular: true,
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'openai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envKey: 'GEMINI_API_KEY',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    popular: true,
  },
  { id: 'xai', name: 'xAI', kind: 'openai', baseURL: 'https://api.x.ai/v1', envKey: 'XAI_API_KEY', needsKey: true },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    needsKey: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseURL: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    needsKey: true,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai',
    baseURL: 'https://api.mistral.ai/v1',
    envKey: 'MISTRAL_API_KEY',
    needsKey: true,
  },
  { id: 'ollama', name: 'Ollama (local)', kind: 'openai', baseURL: 'http://localhost:11434/v1', needsKey: false },
  { id: 'custom', name: 'Custom (OpenAI-compatible URL)', kind: 'openai', needsKey: false },
];

interface StoredProvider {
  apiKey?: string;
  baseURL?: string;
}

interface ProvidersFile {
  providers: Record<string, StoredProvider>;
  active?: { provider: string; model?: string };
}

const CONFIG_DIR = join(homedir(), '.aiolah');
const PROVIDERS_FILE = join(CONFIG_DIR, 'providers.json');

function readFile(): ProvidersFile {
  try {
    const data = JSON.parse(readFileSync(PROVIDERS_FILE, 'utf8')) as ProvidersFile;
    return { providers: data.providers ?? {}, active: data.active };
  } catch {
    return { providers: {} };
  }
}

function writeFile(data: ProvidersFile): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(PROVIDERS_FILE, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  chmodSync(PROVIDERS_FILE, 0o600);
}

export function providerDef(id: string): ProviderDef {
  const def = PROVIDERS.find((provider) => provider.id === id);
  if (!def) {
    throw new Error(`Unknown provider "${id}". Known: ${PROVIDERS.map((provider) => provider.id).join(', ')}.`);
  }
  return def;
}

/** Credentials for a provider: stored key/URL first, then its environment variable. */
export function providerCredentials(id: string): { apiKey?: string; baseURL?: string } {
  const def = providerDef(id);
  const stored = readFile().providers[id] ?? {};
  return {
    apiKey: stored.apiKey || (def.envKey ? process.env[def.envKey] || undefined : undefined),
    baseURL: (stored.baseURL || def.baseURL)?.replace(/\/+$/, ''),
  };
}

export function isConnected(id: string): boolean {
  const def = providerDef(id);
  if (def.kind === 'aiolah') {
    return readAuth() !== null;
  }
  // Keyless providers (Ollama, a custom URL) count once they were connected.
  return def.needsKey ? Boolean(providerCredentials(id).apiKey) : Boolean(readFile().providers[id]);
}

export function saveProvider(id: string, stored: StoredProvider): void {
  const data = readFile();
  data.providers[id] = { ...data.providers[id], ...stored };
  writeFile(data);
}

export function removeProvider(id: string): void {
  const data = readFile();
  delete data.providers[id];
  if (data.active?.provider === id) {
    delete data.active;
  }
  writeFile(data);
}

export function activeSelection(): { provider: string; model?: string } | undefined {
  return readFile().active;
}

export function setActiveSelection(provider: string, model?: string): void {
  const data = readFile();
  data.active = { provider, ...(model ? { model } : {}) };
  writeFile(data);
}

/** `--provider`, else the saved choice, else Anthropic when ANTHROPIC_API_KEY is set, else aiolah. */
export function resolveProvider(explicit?: string): string {
  if (explicit) {
    providerDef(explicit);
    return explicit;
  }
  const active = activeSelection();
  if (active) {
    return active.provider;
  }
  return process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'aiolah';
}

/** `--model`, else the saved model for that provider, else the provider's default. */
export async function resolveProviderModel(provider: string, explicit?: string): Promise<string> {
  if (explicit) {
    return explicit;
  }
  const active = activeSelection();
  if (active?.provider === provider && active.model) {
    return active.model;
  }
  const def = providerDef(provider);
  if (def.kind === 'aiolah') {
    const { default: fallback } = await fetchModels();
    if (!fallback) {
      throw new Error('No coding model is available for your aiolah plan right now.');
    }
    return fallback;
  }
  if (def.defaultModel) {
    return def.defaultModel;
  }
  throw new Error(
    `Choose a model for ${def.name}: run \`aiolah models --provider ${provider}\`, then pass --model <id> (or use /model in chat).`,
  );
}

/** Provider + model for a command, from its flags and the saved choice. */
export async function resolveSelection(options: {
  provider?: string;
  model?: string;
}): Promise<{ provider: string; model: string }> {
  const provider = resolveProvider(options.provider);
  return { provider, model: await resolveProviderModel(provider, options.model) };
}

/** Model ids offered by a provider (live from its API). */
export async function listProviderModels(provider: string): Promise<string[]> {
  const def = providerDef(provider);
  if (def.kind === 'aiolah') {
    return (await fetchModels()).data.map((model) => model.id);
  }

  const { apiKey, baseURL } = providerCredentials(provider);
  if (!baseURL) {
    throw new Error(`${def.name} has no base URL. Run \`aiolah connect ${provider}\`.`);
  }
  const headers: Record<string, string> =
    def.kind === 'anthropic'
      ? { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' }
      : apiKey
        ? { Authorization: `Bearer ${apiKey}` }
        : {};
  const url = def.kind === 'anthropic' ? `${baseURL}/v1/models?limit=100` : `${baseURL}/models`;
  const response = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${def.name} rejected the API key (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(`Could not list ${def.name} models (HTTP ${response.status}).`);
  }
  const data = (await response.json()) as { data?: { id: string }[]; models?: { name?: string; id?: string }[] };
  const ids = (data.data ?? []).map((model) => model.id);
  return ids.sort();
}
