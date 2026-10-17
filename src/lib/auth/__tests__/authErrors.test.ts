import { describe, it, expect } from 'vitest';
import { isEmailRateLimitError } from '../authErrors';
describe('isEmailRateLimitError', () => {
  it('detecta a mensagem do Supabase', () => expect(isEmailRateLimitError({ message: 'email rate limit exceeded', status: 429 })).toBe(true));
  it('detecta pelo código', () => expect(isEmailRateLimitError({ message: 'x', code: 'over_email_send_rate_limit' })).toBe(true));
  it('ignora outros erros', () => {
    expect(isEmailRateLimitError({ message: 'User already registered' })).toBe(false);
    expect(isEmailRateLimitError(null)).toBe(false);
  });
});
