import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => true }));
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DriverStatusScreen, DRIVER_STATUS_COPY } from '../DriverStatusScreen';
import { DriverInviteView, INVALID_INVITE_MESSAGE } from '../DriverInvitePage';
import { redeemOutcome, storeInitials, rememberInviteToken, clearInviteToken } from '../../../lib/driverInviteFlow';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => {};

describe('F-C/F5: DriverStatusScreen', () => {
  it.each(['PENDING', 'REJECTED', 'SUSPENDED', 'REMOVED', 'INACTIVE', 'UNAVAILABLE'] as const)('%s mostra o texto e Sair', (v) => {
    const h = html(<DriverStatusScreen variant={v} storeName="Loja A" onSignOut={noop} onRefresh={noop} />);
    expect(h).toContain(DRIVER_STATUS_COPY[v].title);
    expect(h).toContain('Sair');
    if (v === 'PENDING') expect(h).toContain('Atualizar'); else expect(h).not.toContain('Atualizar');
    if (v === 'UNAVAILABLE') expect(h).toContain('Tentar novamente'); else expect(h).not.toContain('Tentar novamente');
  });
  it('UNAVAILABLE: "Indisponível" com Tentar novamente; REMOVED: "Acesso removido"; INACTIVE: "Sem acesso a esta loja"', () => {
    expect(html(<DriverStatusScreen variant="UNAVAILABLE" onSignOut={noop} onRefresh={noop} />)).toContain('Indisponível no momento');
    expect(html(<DriverStatusScreen variant="REMOVED" onSignOut={noop} />)).toContain('Acesso removido');
    expect(html(<DriverStatusScreen variant="INACTIVE" onSignOut={noop} />)).toContain('Sem acesso a esta loja');
  });
  it('REJECTED mostra "Cadastro não aprovado" e não promete reabertura', () => {
    const h = html(<DriverStatusScreen variant="REJECTED" onSignOut={noop} />);
    expect(h).toContain('Cadastro não aprovado');
    expect(h).not.toMatch(/reabr|novamente pelo QR/i);
  });
  it('PENDING mostra o nome da loja', () => {
    expect(html(<DriverStatusScreen variant="PENDING" storeName="Adega X" onSignOut={noop} onRefresh={noop} />)).toContain('Adega X');
  });
});

describe('F-G: página do convite', () => {
  it('inválido mostra mensagem genérica', () => {
    expect(html(<DriverInviteView state="INVALID" hasSession={false} />)).toContain(INVALID_INVITE_MESSAGE);
  });
  it('válido sem sessão: placeholder do logo, nome, Criar conta / Já tenho conta', () => {
    const h = html(<DriverInviteView state="VALID" hasSession={false} preview={{ valid: true, storeName: 'Adega do Zé', storeLogo: null, expiresAt: '2026-10-21T00:00:00Z' }} />);
    expect(h).toContain('store-logo-placeholder'); expect(h).toContain('>AZ<');
    expect(h).toContain('Adega do Zé'); expect(h).toContain('Criar conta'); expect(h).toContain('Já tenho conta');
    expect(h).not.toContain('Entrar na equipe');
  });
  it('válido com sessão: Entrar na equipe; desabilitado durante a chamada', () => {
    const h = html(<DriverInviteView state="VALID" hasSession isRedeeming preview={{ valid: true, storeName: 'L', storeLogo: 'https://img.test/l.png' }} onJoin={noop} />);
    expect(h).toContain('Entrando...'); expect(h).toContain('disabled');
    expect(h).toContain('<img'); expect(h).not.toContain('store-logo-placeholder');
  });
  it('cada resposta do redeem', () => {
    expect(redeemOutcome({ status: 'INVALID', consumed: false })).toEqual({ kind: 'INVALID' });
    expect(redeemOutcome({ status: 'PENDING', consumed: true })).toEqual({ kind: 'PENDING' });
    expect(redeemOutcome({ status: 'PENDING', consumed: false })).toEqual({ kind: 'PENDING' });
    expect(redeemOutcome({ status: 'APPROVED', consumed: false })).toEqual({ kind: 'GO_APP' });
    for (const s of ['SUSPENDED', 'REJECTED', 'REMOVED'] as const) {
      expect(redeemOutcome({ status: s, consumed: false })).toEqual({ kind: 'STATUS', variant: s });
    }
  });
  it('token só em sessionStorage e removido depois do redeem (também da barra)', () => {
    const store = new Map<string, string>();
    const session = { setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), getItem: (k: string) => store.get(k) ?? null };
    const local = { setItem: vi.fn() };
    const history = { replaceState: vi.fn() };
    rememberInviteToken(session, 'TOK');
    expect(store.get('driver_invite_token')).toBe('TOK');
    expect(local.setItem).not.toHaveBeenCalled();
    clearInviteToken(session, history);
    expect(store.has('driver_invite_token')).toBe(false);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/entregador');
  });
  it('iniciais', () => {
    expect(storeInitials('Loja')).toBe('L');
    expect(storeInitials('')).toBe('?');
  });
});
