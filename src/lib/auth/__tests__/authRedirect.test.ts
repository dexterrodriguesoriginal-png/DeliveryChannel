import { describe, it, expect } from 'vitest';
import { emailRedirectUrl, driverInvitePathFromPath, storeSlugFromPath, rememberLastStoreSlug, readLastStoreSlug, LAST_STORE_SLUG_KEY, DEFAULT_APP_ORIGIN } from '../authRedirect';
import { isEmailNotConfirmedError } from '../authErrors';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};

describe('emailRedirectUrl', () => {
  it('cadastro na vitrine volta para a loja', () => {
    expect(emailRedirectUrl({ origin: 'https://deliverychannel.ai.studio', pathname: '/app/mercado-teste-dc' }))
      .toBe('https://deliverychannel.ai.studio/app/mercado-teste-dc');
    expect(emailRedirectUrl({ origin: 'https://deliverychannel.ai.studio', pathname: '/app/mercado-teste-dc/produto/1' }))
      .toBe('https://deliverychannel.ai.studio/app/mercado-teste-dc');
  });
  it('fora da vitrine volta para a origem; sem navegador usa a origem pública Delivery Channel', () => {
    expect(emailRedirectUrl({ origin: 'https://deliverychannel.ai.studio', pathname: '/' })).toBe('https://deliverychannel.ai.studio');
    expect(emailRedirectUrl(null)).toBe(DEFAULT_APP_ORIGIN);
    expect(DEFAULT_APP_ORIGIN).not.toMatch(/adegafood/);
  });
  it('slug inválido não entra na URL', () => {
    expect(storeSlugFromPath('/app/<script>')).toBeNull();
    expect(storeSlugFromPath('/entregador')).toBeNull();
  });
});

describe('emailRedirectUrl: convite de entregador', () => {
  const tok = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
  it('cadastro no convite volta para o próprio convite', () => {
    expect(emailRedirectUrl({ origin: 'https://deliverychannel.ai.studio', pathname: `/entregador/convite/${tok}` }))
      .toBe(`https://deliverychannel.ai.studio/entregador/convite/${tok}`);
    expect(driverInvitePathFromPath(`/entregador/convite/${tok}/`)).toBe(`/entregador/convite/${tok}`);
  });
  it('token com formato inválido não entra na URL', () => {
    expect(driverInvitePathFromPath('/entregador/convite/curto')).toBeNull();
    expect(driverInvitePathFromPath('/entregador/convite/%3Cscript%3Eaaaaaaaaaaaaaaaaaaaa')).toBeNull();
    expect(driverInvitePathFromPath('/entregador')).toBeNull();
    expect(emailRedirectUrl({ origin: 'https://deliverychannel.ai.studio', pathname: '/entregador/convite/curto' }))
      .toBe('https://deliverychannel.ai.studio');
  });
});

describe('última loja visitada', () => {
  it('grava e lê o slug', () => {
    const s = mem();
    rememberLastStoreSlug(s, 'mercado-teste-dc');
    expect(s.m.get(LAST_STORE_SLUG_KEY)).toBe('mercado-teste-dc');
    expect(readLastStoreSlug(s)).toBe('mercado-teste-dc');
  });
  it('ignora valores inválidos', () => {
    const s = mem();
    rememberLastStoreSlug(s, '../x');
    expect(readLastStoreSlug(s)).toBeNull();
    s.setItem(LAST_STORE_SLUG_KEY, 'javascript:alert(1)');
    expect(readLastStoreSlug(s)).toBeNull();
    expect(readLastStoreSlug(null)).toBeNull();
  });
});

describe('isEmailNotConfirmedError', () => {
  it('reconhece code e mensagem do Supabase', () => {
    expect(isEmailNotConfirmedError({ code: 'email_not_confirmed' })).toBe(true);
    expect(isEmailNotConfirmedError({ message: 'Email not confirmed' })).toBe(true);
    expect(isEmailNotConfirmedError({ message: 'Invalid login credentials' })).toBe(false);
    expect(isEmailNotConfirmedError(null)).toBe(false);
  });
});
