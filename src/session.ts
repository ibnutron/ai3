import { EventEmitter } from 'node:events';
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_SCHEMAS, executeTool, type ConfirmFn } from './tools/index.js';
import { generateSessionId, loadSession, saveSession, type SessionRecord } from './persistence.js';
import { createModelClient, type ModelClient } from './modelClient.js';
import { packageVersion } from './version.js';
import type { HistoryItem } from './protocol.js';

type MessageParam = Anthropic.MessageParam;

export interface ChatTurnResult {
  reply: string;
}

/**
 * Where a prompt came from, sent to aiolah (which logs every prompt it
 * processes): typed on the host, sent from /code / the app / VS Code, or
 * `aiolah run`.
 */
export type PromptOrigin = 'terminal' | 'remote' | 'script';

export interface ChatSessionOptions {
  /** Provider id (see providers.ts), e.g. `aiolah`, `anthropic`, `openrouter`. */
  provider: string;
  model: string;
  workspaceRoot: string;
  confirm: ConfirmFn;
  resumeId?: string;
}

/**
 * Holds the running conversation for one chat session, drives the
 * tool-call loop against the Anthropic API, and persists history to disk
 * after every turn. Shared by the local `chat` command and the `serve`
 * command so a remote `attach` client sees the exact same conversation.
 *
 * Events, so a host UI, a `serve` broadcaster or the aiolah session sync can
 * follow along: `turn_start` { text, origin }, `tool` { name, input },
 * `tool_result` { name, result }, `confirm_wait` / `confirm_done` (an
 * Allow/Deny prompt is open / answered), `turn_end` { reply } and
 * `turn_error` { message }.
 */
export class ChatSession extends EventEmitter {
  private client: ModelClient;
  /** Device id on aiolah once `serve`/`rc` has registered it; sent with each prompt. */
  hostId?: number;
  private model: string;
  private readonly workspaceRoot: string;
  private readonly confirm: ConfirmFn;
  private readonly id: string;
  private readonly createdAt: string;
  private history: MessageParam[];

  constructor(options: ChatSessionOptions) {
    super();
    this.client = createModelClient(options.provider);
    this.model = options.model;
    this.workspaceRoot = options.workspaceRoot;
    this.confirm = async (description, tool) => {
      this.emit('confirm_wait', { description, tool });
      try {
        return await options.confirm(description, tool);
      } finally {
        this.emit('confirm_done', { description, tool });
      }
    };

    if (options.resumeId) {
      const record = loadSession(options.resumeId);
      this.id = record.id;
      this.createdAt = record.createdAt;
      this.history = record.history;
    } else {
      this.id = generateSessionId();
      this.createdAt = new Date().toISOString();
      this.history = [];
    }
  }

  get sessionId(): string {
    return this.id;
  }

  get modelId(): string {
    return this.model;
  }

  get providerId(): string {
    return this.client.provider;
  }

  /** Switch provider/model mid-session; the history carries over (it is provider-neutral). */
  useModel(provider: string, model: string): void {
    this.client = createModelClient(provider);
    this.model = model;
  }

  get workspace(): string {
    return this.workspaceRoot;
  }

  /** Conversation flattened to what a client renders (tool_use/tool_result pairs joined by id). */
  renderHistory(): HistoryItem[] {
    const items: HistoryItem[] = [];
    const pendingTools = new Map<string, { name: string; input: unknown }>();

    for (const message of this.history) {
      if (typeof message.content === 'string') {
        items.push({ role: message.role, text: message.content });
        continue;
      }

      for (const block of message.content) {
        if (block.type === 'text' && block.text.trim()) {
          items.push({ role: message.role, text: block.text });
        } else if (block.type === 'tool_use') {
          pendingTools.set(block.id, { name: block.name, input: block.input });
        } else if (block.type === 'tool_result') {
          const call = pendingTools.get(block.tool_use_id);
          const result =
            typeof block.content === 'string'
              ? block.content
              : (block.content ?? []).map((part) => (part.type === 'text' ? part.text : '')).join('');
          items.push({ role: 'tool', name: call?.name ?? 'unknown', input: call?.input, result });
          pendingTools.delete(block.tool_use_id);
        }
      }
    }

    return items;
  }

  async send(userMessage: string, origin: PromptOrigin = 'terminal'): Promise<ChatTurnResult> {
    this.emit('turn_start', { text: userMessage, origin });
    try {
      const result = await this.runTurn(userMessage, origin);
      this.emit('turn_end', { reply: result.reply });
      return result;
    } catch (error) {
      this.emit('turn_error', { message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async runTurn(userMessage: string, origin: PromptOrigin): Promise<ChatTurnResult> {
    this.history.push({ role: 'user', content: userMessage });

    // Context for aiolah's prompt log; never sent to Anthropic directly.
    const headers = this.client.viaAiolah
      ? {
          'X-Aiolah-Session': this.id,
          'X-Aiolah-Origin': origin,
          'X-Aiolah-Version': packageVersion(),
          ...(this.hostId ? { 'X-Aiolah-Host': String(this.hostId) } : {}),
        }
      : undefined;

    while (true) {
      const response = await this.client.create(
        {
          model: this.model,
          max_tokens: 4096,
          tools: TOOL_SCHEMAS,
          messages: this.history,
        },
        headers,
      );

      this.history.push({ role: 'assistant', content: response.content });
      this.persist();

      if (response.stop_reason !== 'tool_use') {
        const reply = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n');
        return { reply };
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') {
          continue;
        }
        this.emit('tool', { name: block.name, input: block.input });
        let content: string;
        try {
          content = await executeTool(block.name, block.input as Record<string, unknown>, {
            workspaceRoot: this.workspaceRoot,
            confirm: this.confirm,
          });
        } catch (error) {
          content = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
        this.emit('tool_result', { name: block.name, result: content });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
      }

      this.history.push({ role: 'user', content: toolResults });
      this.persist();
    }
  }

  private persist(): void {
    const record: SessionRecord = {
      id: this.id,
      model: this.model,
      workspace: this.workspaceRoot,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      provider: this.client.provider,
      history: this.history,
    };
    saveSession(record);
  }
}
