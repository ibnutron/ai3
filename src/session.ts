import { EventEmitter } from 'node:events';
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_SCHEMAS, executeTool, type ConfirmFn } from './tools/index.js';
import { generateSessionId, loadSession, saveSession, type SessionRecord } from './persistence.js';
import type { HistoryItem } from './protocol.js';

type MessageParam = Anthropic.MessageParam;

export interface ChatTurnResult {
  reply: string;
}

export interface ChatSessionOptions {
  model: string;
  workspaceRoot: string;
  confirm: ConfirmFn;
  apiKey?: string;
  resumeId?: string;
}

/**
 * Holds the running conversation for one chat session, drives the
 * tool-call loop against the Anthropic API, and persists history to disk
 * after every turn. Shared by the local `chat` command and the `serve`
 * command so a remote `attach` client sees the exact same conversation.
 *
 * Emits a `'tool'` event `{ name, input }` when a tool call starts and a
 * `'tool_result'` event `{ name, result }` when it finishes, so a host UI (or
 * a `serve` broadcaster) can show tool activity as it happens.
 */
export class ChatSession extends EventEmitter {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly workspaceRoot: string;
  private readonly confirm: ConfirmFn;
  private readonly id: string;
  private readonly createdAt: string;
  private history: MessageParam[];

  constructor(options: ChatSessionOptions) {
    super();
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
    }

    this.client = new Anthropic({ apiKey });
    this.model = options.model;
    this.workspaceRoot = options.workspaceRoot;
    this.confirm = options.confirm;

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
              : (block.content ?? [])
                  .map((part) => (part.type === 'text' ? part.text : ''))
                  .join('');
          items.push({ role: 'tool', name: call?.name ?? 'unknown', input: call?.input, result });
          pendingTools.delete(block.tool_use_id);
        }
      }
    }

    return items;
  }

  async send(userMessage: string): Promise<ChatTurnResult> {
    this.history.push({ role: 'user', content: userMessage });

    while (true) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        tools: TOOL_SCHEMAS,
        messages: this.history,
      });

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
      history: this.history,
    };
    saveSession(record);
  }
}
