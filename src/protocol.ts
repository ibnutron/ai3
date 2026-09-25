export type HistoryItem =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string }
  | { role: 'tool'; name: string; input: unknown; result: string };

export type WireMessage =
  | { type: 'challenge'; nonce: string }
  | { type: 'auth'; hmac: string }
  | {
      type: 'authed';
      sessionId: string;
      /** aiolah session uuid when the host reports sessions (signed in); null otherwise. */
      sessionUuid?: string | null;
      workspace: string;
      model: string;
      history: HistoryItem[];
    }
  /** Direct mode: switch this connection to another session (`new` starts one). */
  | { type: 'open_session'; session: string }
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
  /** `session`: id of a host session to join, `new` for a fresh one, absent = the host's main session. */
  | { type: 'relay_client_joined'; clientId: string; session?: string }
  | { type: 'relay_client_left'; clientId: string }
  | { type: 'relay_msg'; from?: string; to?: string; msg: WireMessage };

/** Session selector accepted from clients: a local session id or `new`. */
export const SESSION_SELECTOR = /^(new|[A-Za-z0-9._-]{1,64})$/;
