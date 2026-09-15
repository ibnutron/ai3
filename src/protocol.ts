export type HistoryItem =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { role: 'tool'; name: string; input: unknown; result: string };

export type WireMessage =
  | { type: 'challenge'; nonce: string }
  | { type: 'auth'; hmac: string }
  | { type: 'authed'; sessionId: string; workspace: string; model: string; history: HistoryItem[] }
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'tool'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; result: string }
  | { type: 'confirm'; id: string; description: string }
  | { type: 'confirm_reply'; id: string; allow: boolean }
  | { type: 'busy' }
  | { type: 'idle' }
  | { type: 'error'; text: string };
