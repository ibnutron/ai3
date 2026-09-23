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

/**
 * Frames between `aiolah serve` (relay mode) and `aiolah relay` only. Clients
 * never see them: the relay unwraps `relay_msg` and forwards the inner
 * WireMessage, so web/mobile/VS Code speak the same protocol as a direct
 * connection (minus the challenge, which the relay's ticket replaces).
 */
export type RelayFrame =
  | { type: 'relay_client_joined'; clientId: string }
  | { type: 'relay_client_left'; clientId: string }
  | { type: 'relay_msg'; from?: string; to?: string; msg: WireMessage };
