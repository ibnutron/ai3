export type WireMessage =
  | { type: 'challenge'; nonce: string }
  | { type: 'auth'; hmac: string }
  | { type: 'authed' }
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'tool'; name: string; input: unknown }
  | { type: 'error'; text: string };
