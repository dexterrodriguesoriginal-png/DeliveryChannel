import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PaymentError } from './types';

export function equalHex(actual: string | undefined, expected: string): boolean {
  if (!actual || !/^[a-f0-9]{64}$/i.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export function encryptionKey(value: string | undefined): Buffer {
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new PaymentError('PAYMENTS_UNAVAILABLE', 503, 'Pagamentos online em breve.');
  return Buffer.from(value, 'hex');
}
export function seal(value: unknown, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64url')).join('.');
}
export function unseal<T>(value: string, key: Buffer, context: string): T {
  const [iv, tag, ciphertext] = value.split('.').map(s => Buffer.from(s, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8'));
}
export function signedState(secret: string): string {
  const nonce = randomBytes(32).toString('hex');
  return nonce + createHmac('sha256', secret).update(nonce).digest('hex');
}
export function validState(state: string, secret: string): boolean {
  return /^[a-f0-9]{128}$/.test(state) && equalHex(state.slice(64), createHmac('sha256', secret).update(state.slice(0, 64)).digest('hex'));
}
/** Bounded per-process ingress limiter. Persistent per-order creation/confirmation is enforced in SQL. */
export class RateLimiter {
  private entries = new Map<string, { count: number; until: number }>();
  constructor(private limit = 60, private windowMs = 60_000, private maxKeys = 10_000) {}
  allow(key: string, now = Date.now()): boolean {
    for (const [k, v] of this.entries) if (v.until <= now) this.entries.delete(k);
    let v = this.entries.get(key);
    if (!v) {
      if (this.entries.size >= this.maxKeys) return false;
      v = { count: 0, until: now + this.windowMs }; this.entries.set(key, v);
    }
    return ++v.count <= this.limit;
  }
}
