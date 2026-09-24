import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest();

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Constant-time comparison for secrets of possibly different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ha = sha256(a);
  const hb = sha256(b);
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
export function randomCode(len: number, alphabet = ALPHABET): string {
  const out: string[] = [];
  // rejection sampling to avoid modulo bias
  const max = 256 - (256 % alphabet.length);
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < max && out.length < len) out.push(alphabet[b % alphabet.length]!);
    }
  }
  return out.join('');
}
