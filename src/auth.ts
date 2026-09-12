import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function generateNonce(): string {
  return randomBytes(24).toString('hex');
}

export function signChallenge(token: string, nonce: string): string {
  return createHmac('sha256', token).update(nonce).digest('hex');
}

export function verifyChallenge(token: string, nonce: string, hmac: string): boolean {
  const expected = Buffer.from(signChallenge(token, nonce), 'hex');
  const actual = Buffer.from(hmac, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
