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

import { isInvalidCredentialsError, INVALID_CREDENTIALS_MSG, isMembershipLoadFailure } from '../authErrors';
import { readFileSync } from 'node:fs';

describe('login com credenciais erradas', () => {
  it('detecta o erro do Supabase (mensagem e código)', () => {
    expect(isInvalidCredentialsError({ message: 'Invalid login credentials' })).toBe(true);
    expect(isInvalidCredentialsError({ message: 'x', code: 'invalid_credentials' })).toBe(true);
    expect(isInvalidCredentialsError({ message: 'Email not confirmed' })).toBe(false);
    expect(isInvalidCredentialsError(null)).toBe(false);
  });

  it('mensagem exata', () => expect(INVALID_CREDENTIALS_MSG).toBe('E-mail ou senha incorretos.'));

  it('tela "Falha ao Conectar" só para falha real ao carregar permissões', () => {
    expect(isMembershipLoadFailure('MEMBERSHIP_ERROR')).toBe(true);
    for (const s of ['AUTH_LOADING', 'UNAUTHENTICATED', 'MEMBERSHIP_LOADING', 'MEMBERSHIP_RESOLVED_EMPTY', null, undefined]) {
      expect(isMembershipLoadFailure(s as any)).toBe(false);
    }
    // authState não usa mais authError (erro de login) para entrar em AUTH_ERROR.
    const src = readFileSync('src/context/AuthContext.tsx', 'utf8');
    const memo = src.slice(src.indexOf('const authState: AuthState = useMemo'), src.indexOf("return 'AUTH_ERROR'"));
    expect(memo).toContain('isMembershipLoadFailure(membershipStatus)');
    expect(memo).not.toMatch(/\|\|\s*authError/);
  });
});
