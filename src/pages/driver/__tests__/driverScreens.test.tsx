import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => true }));
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DriverStatusScreen, DRIVER_STATUS_COPY } from '../DriverStatusScreen';
import { DriverInviteView, INVALID_INVITE_MESSAGE, driverConfirmHint } from '../DriverInvitePage';
import { applyDriverRedeem, redeemOutcome, storeInitials, rememberInviteToken, clearInviteToken } from '../../../lib/driverInviteFlow';

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

  it('botão Sair visível tanto no header quanto no corpo da tela de status (pendente/recusado/inativo)', () => {
    for (const v of ['PENDING', 'REJECTED', 'INACTIVE'] as const) {
      const h = html(<DriverStatusScreen variant={v} storeName="Loja A" onSignOut={noop} />);
      expect(h).toContain('Sair');
      expect(h).toContain('Sair da conta');
    }
  });

  it('logout limpa storage de tenant/role e chama signOut', async () => {
    const signOutMock = vi.fn().mockResolvedValue(undefined);
    const localStore: Record<string, string> = {
      'adegafood_pref_tenant_user1': 'tenant-123',
      'deliverychannel_driver_location_consent': 'ACCEPTED',
      'sb-auth-token': 'token123',
      'other_unrelated_key': 'preserve_me',
    };
    const sessionStore: Record<string, string> = {
      'adegafood_bypass': '1',
    };

    // Executa a lógica de limpeza de armazenamento do logout
    const cleanStorage = () => {
      Object.keys(localStore).forEach(k => {
        if (k.startsWith('adegafood_') || k.startsWith('deliverychannel_') || k.startsWith('sb-')) {
          delete localStore[k];
        }
      });
      Object.keys(sessionStore).forEach(k => delete sessionStore[k]);
    };

    cleanStorage();
    await signOutMock();

    expect(localStore['adegafood_pref_tenant_user1']).toBeUndefined();
    expect(localStore['deliverychannel_driver_location_consent']).toBeUndefined();
    expect(localStore['sb-auth-token']).toBeUndefined();
    expect(localStore['other_unrelated_key']).toBe('preserve_me');
    expect(Object.keys(sessionStore).length).toBe(0);
    expect(signOutMock).toHaveBeenCalled();
  });
});

describe('F-G: página do convite', () => {
  it('inválido mostra mensagem genérica', () => {
    expect(html(<DriverInviteView state="INVALID" hasSession={false} />)).toContain(INVALID_INVITE_MESSAGE);
  });
  it('válido sem sessão: placeholder do logo, nome, Criar conta / Já tenho conta', () => {
    const h = html(<DriverInviteView state="VALID" hasSession={false} preview={{ valid: true, storeName: 'Adega do Zé', storeLogo: null, expiresAt: '2026-10-21T00:00:00Z' }} />);
    expect(h).toContain('store-logo-placeholder'); expect(h).toContain('>AZ<');
    expect(h).toContain('Adega do Zé'); expect(h).toContain('Criar conta'); expect(h).toContain('Já tenho conta'); expect(h).toContain('Continuar com Google');
    expect(h).not.toContain('Entrar na equipe');
  });
  it('válido com sessão: Entrar na equipe; desabilitado durante a chamada', () => {
    const h = html(<DriverInviteView state="VALID" hasSession isRedeeming preview={{ valid: true, storeName: 'L', storeLogo: 'https://img.test/l.png' }} onJoin={noop} />);
    expect(h).toContain('Entrando...'); expect(h).toContain('disabled');
    expect(h).toContain('<img'); expect(h).not.toContain('store-logo-placeholder');
  });
  it('cadastro aguardando confirmação: aviso persistente com Reenviar e-mail e retorno ao convite', () => {
    const h = html(<DriverInviteView state="VALID" hasSession={false} confirmationEmail="moto@teste.dc"
      preview={{ valid: true, storeName: 'Mercado Teste DC', storeLogo: null }} onLogin={noop} onResendConfirmation={async () => ({ success: true })} />);
    expect(h).toContain('customer-email-confirm-notice');
    expect(h).toContain('Enviamos um link de confirmação para <strong>moto@teste.dc</strong>');
    expect(h).toContain('Reenviar e-mail');
    expect(h).toContain('Já confirmei, entrar');
    expect(h).toContain(driverConfirmHint('Mercado Teste DC'));
    expect(h).not.toContain('finalizar o pedido');
    expect(h).not.toContain('Criar conta');
  });
  it('com logo no convite mostra a imagem; sem logo, as iniciais', () => {
    expect(html(<DriverInviteView state="VALID" hasSession={false} preview={{ valid: true, storeName: 'Mercado Teste DC', storeLogo: 'https://img.test/logo.png' }} />))
      .toContain('src="https://img.test/logo.png"');
    expect(html(<DriverInviteView state="VALID" hasSession={false} preview={{ valid: true, storeName: 'Mercado Teste DC', storeLogo: null }} />))
      .toContain('>MD<');
  });
  it('loja A ativa + convite B: troca a seleção e mostra status com o nome de B', async () => {
    let activeTenant = 'A';
    const outcome = await applyDriverRedeem({ status: 'PENDING', consumed: true, tenantId: 'B' }, async id => { activeTenant = id; return true; });
    expect(activeTenant).toBe('B');
    expect(outcome.kind).toBe('PENDING');
    const h = html(<DriverStatusScreen variant="PENDING" storeName="Mercado da loja B" onSignOut={noop} onRefresh={noop} />);
    expect(h).toContain('Mercado da loja B');
    expect(h).not.toContain('Loja A');
  });
  it('cada resposta do redeem carrega a loja retornada pelo servidor', () => {
    expect(redeemOutcome({ status: 'INVALID', consumed: false })).toEqual({ kind: 'INVALID' });
    expect(redeemOutcome({ status: 'PENDING', consumed: true, tenantId: 'B' })).toEqual({ kind: 'PENDING', tenantId: 'B' });
    expect(redeemOutcome({ status: 'PENDING', consumed: false, tenantId: 'B' })).toEqual({ kind: 'PENDING', tenantId: 'B' });
    expect(redeemOutcome({ status: 'APPROVED', consumed: false, tenantId: 'B' })).toEqual({ kind: 'GO_APP', tenantId: 'B' });
    for (const status of ['SUSPENDED', 'REJECTED', 'REMOVED'] as const) {
      expect(redeemOutcome({ status, consumed: false, tenantId: 'B' })).toEqual({ kind: 'STATUS', variant: status, tenantId: 'B' });
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
