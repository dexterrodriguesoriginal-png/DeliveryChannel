import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => true }));

const authMock = {
  currentUser: null, activeRole: null, activeTenant: null, availableTenants: [], switchTenant: async () => true,
  hasTenantMembership: false, isAccountSuspended: false, supabaseUser: null, isSupabaseAuth: false,
  authState: 'UNAUTHENTICATED', signInWithPassword: async () => ({ success: true }), signUp: async () => ({ success: true }),
  signInWithGoogle: async () => {}, signOut: async () => {}, resetPassword: async () => ({ success: true }),
};
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => authMock }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }));

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoleTenantSwitcher } from '../RoleTenantSwitcher';
import { viewModeFor, authModalCopy, passwordMatchStatus } from '../switcherViewMode';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => {};
const OWNER_LOGIN = 'Acesse seu estabelecimento e gerencie seu negócio.';
const OWNER_BUTTON = 'Entrar no Estabelecimento';
const OWNER_SIGNUP = 'Cadastre-se para começar a gerenciar seu estabelecimento.';

describe('convite do entregador: tela inicial do modal', () => {
  it('"Criar conta" abre direto o cadastro; "Já tenho conta" abre o login; autenticado segue em ACCOUNT', () => {
    expect(viewModeFor(false, 'SIGNUP')).toBe('SIGNUP');
    expect(viewModeFor(false, 'LOGIN')).toBe('LOGIN');
    expect(viewModeFor(false)).toBe('LOGIN');
    expect(viewModeFor(true, 'SIGNUP')).toBe('ACCOUNT');
  });
  it('initialView SIGNUP renderiza o formulário de cadastro (não o login)', () => {
    const h = html(<RoleTenantSwitcher isOpen onClose={noop} initialView="SIGNUP" audience="driver" storeName="Mercado Teste DC" />);
    expect(h).toContain('Criar minha conta');
    expect(h).toContain('Confirmar Senha');
    expect(h).toContain('Continuar com Google');
    expect(h).not.toContain('Entre na sua conta');
  });
  it('initialView LOGIN renderiza o login', () => {
    const h = html(<RoleTenantSwitcher isOpen onClose={noop} initialView="LOGIN" audience="driver" storeName="Mercado Teste DC" />);
    expect(h).toContain('Entre na sua conta');
    expect(h).not.toContain('Confirmar Senha');
  });
});

describe('convite do entregador: textos', () => {
  it('login do entregador usa o texto do convite e o botão "Entrar"', () => {
    const h = html(<RoleTenantSwitcher isOpen onClose={noop} initialView="LOGIN" audience="driver" storeName="Mercado Teste DC" />);
    expect(h).toContain('Entre para aceitar o convite de entregador da Mercado Teste DC.');
    expect(h).toContain('<span>Entrar</span>');
    expect(h).not.toContain(OWNER_LOGIN);
    expect(h).not.toContain(OWNER_BUTTON);
  });
  it('cadastro do entregador usa o texto do entregador', () => {
    const h = html(<RoleTenantSwitcher isOpen onClose={noop} initialView="SIGNUP" audience="driver" storeName="Mercado Teste DC" />);
    expect(h).toContain('Crie sua conta de entregador para começar a fazer entregas pela Mercado Teste DC.');
    expect(h).not.toContain(OWNER_SIGNUP);
  });
  it('fluxo do dono não muda', () => {
    const login = html(<RoleTenantSwitcher isOpen onClose={noop} />);
    expect(login).toContain(OWNER_LOGIN);
    expect(login).toContain(OWNER_BUTTON);
    const signup = html(<RoleTenantSwitcher isOpen onClose={noop} initialView="SIGNUP" />);
    expect(signup).toContain(OWNER_SIGNUP);
    expect(authModalCopy()).toEqual({ loginSubtitle: OWNER_LOGIN, loginButton: OWNER_BUTTON, signupSubtitle: OWNER_SIGNUP });
  });
  it('sem nome da loja usa "loja"', () => {
    expect(authModalCopy('driver', '  ').loginSubtitle).toBe('Entre para aceitar o convite de entregador da loja.');
  });
});

describe('confirmação de senha', () => {
  it('calculada só pelos valores atuais', () => {
    expect(passwordMatchStatus('', '')).toBe('idle');
    expect(passwordMatchStatus('abc123', '')).toBe('idle');
    expect(passwordMatchStatus('abc123', 'abc12')).toBe('mismatch');
    expect(passwordMatchStatus('abc123', 'abc123')).toBe('match');
  });
  it('campos de senha com autocomplete new-password e aviso sem valores ainda', () => {
    const h = html(<RoleTenantSwitcher isOpen onClose={noop} initialView="SIGNUP" audience="driver" />);
    expect((h.match(/autoComplete="new-password"|autocomplete="new-password"/g) || []).length).toBe(2);
    expect(h).not.toContain('Senhas não conferem');
  });
});
