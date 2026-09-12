import Anthropic from '@anthropic-ai/sdk';

type MessageParam = Anthropic.MessageParam;

export interface ChatTurnResult {
  reply: string;
}

/**
 * Holds the running conversation for one chat session and talks to the
 * Anthropic API. Shared by the local `chat` command and the `serve` command
 * so a remote `attach` client sees the exact same conversation state.
 */
export class ChatSession {
  private readonly client: Anthropic;
  private readonly history: MessageParam[] = [];

  constructor(
    private readonly model: string,
    apiKey = process.env.ANTHROPIC_API_KEY,
  ) {
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
    }
    this.client = new Anthropic({ apiKey });
  }

  async send(userMessage: string): Promise<ChatTurnResult> {
    this.history.push({ role: 'user', content: userMessage });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: this.history,
    });

    const reply = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    this.history.push({ role: 'assistant', content: reply });

    return { reply };
  }
}
