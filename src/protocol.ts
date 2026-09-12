export type WireMessage =
  | { type: 'auth'; token: string }
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'error'; text: string };
