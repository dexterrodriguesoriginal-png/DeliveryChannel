// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  caps: vi.fn(),
  access: { enterTable: vi.fn(), joinWithCode: vi.fn(), createInvite: vi.fn(), getInvite: vi.fn(), revokeInvite: vi.fn(), removeGuest: vi.fn(), transferResponsibility: vi.fn(), pingPending: vi.fn() },
  auth: { user: null as null | { id: string; is_anonymous?: boolean; user_metadata?: Record<string, unknown> }, signUp: vi.fn(), signInWithPassword: vi.fn() },
}));
const product = { id: 'p1', name: 'Chopp', description: '', price: 12, imageUrl: '', isActive: true, isAvailable: true, optionGroups: [] };
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ supabaseUser: h.auth.user, signUp: h.auth.signUp, signInWithPassword: h.auth.signInWithPassword }) }));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => h.rpc(...a), auth: { signInAnonymously: vi.fn(), signInWithOAuth: vi.fn() } } }));
vi.mock('../../../repositories/publicStoreRepository', () => ({ publicStoreRepository: { loadPublicStore: async () => ({ status: 'ok', data: { tenant: { id: 'tn', name: 'Loja X' }, products: [product] } }) } }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({ tenantModuleRepository: { getPublicEnabled: async () => new Set(['dine_in']) } }));
vi.mock('../../../repositories/productOptionRepository', () => ({ productOptionRepository: { getPublicForProducts: async () => new Map() } }));
vi.mock('../../../repositories/mesasQrRepository', () => ({ mesasQrRepository: { capabilities: (...a: unknown[]) => h.caps(...a) } }));
vi.mock('../../../repositories/tableAccessRepository', () => ({ tableAccessRepository: h.access, TableAccessError: class extends Error {} }));

import { DineInClientApp } from '../DineInClientApp';

const TOKEN = 'k'.repeat(48);
const V1 = { available: true, version: 1, qrPause: true, tabPix: true, tableAccess: false, waiterApp: false };
const V2 = { ...V1, version: 2, tableAccess: true, waiterApp: true };
const resolved = { available: true, tenantSlug: 'loja-x', storeName: 'Loja X', tableLabel: 'Mesa 03' };
const baseRpc = (extra: Record<string, unknown> = {}) => h.rpc.mockImplementation(async (name: string) => {
  if (name === 'resolve_table_qr') return { data: resolved, error: null };
  if (name === 'get_table_qr_status') return { data: { found: true, paused: false }, error: null };
  if (name in extra) return extra[name];
  return { data: null, error: null };
});
const myTab = (role: 'RESPONSIBLE' | 'GUEST', approved = true) => ({ data: { tabId: 'tb', status: 'OPEN', mode: 'TABLE', tableLabel: 'Mesa 03', serviceFeePercent: 10, serviceFeeRemoved: false, subtotal: 0, rounds: [], me: { sessionId: 's1', role, approved, displayName: 'Ana' }, members: role === 'RESPONSIBLE' ? [{ sessionId: 's1', displayName: 'Ana', role: 'RESPONSIBLE', approved: true }, { sessionId: 's2', displayName: 'Beto', role: 'GUEST', approved: true }] : [], responsibleName: 'Ana' }, error: null });

beforeEach(() => {
  h.rpc.mockReset(); h.caps.mockReset(); Object.values(h.access).forEach(m => m.mockReset()); h.auth.signUp.mockReset(); h.auth.signInWithPassword.mockReset();
  h.auth.user = null; localStorage.clear(); sessionStorage.clear();
  window.history.replaceState(null, '', '/app/loja-x?mesa=' + TOKEN);
});
afterEach(cleanup);

describe('Mesa — modelo de acesso (capabilities v2)', () => {
  it('quem não está identificado vê entrar/criar conta (nunca "continuar como visitante") e a mesa fica guardada para o retorno do e-mail', async () => {
    h.caps.mockResolvedValue(V2); baseRpc();
    render(<DineInClientApp token={TOKEN} />);
    expect(await screen.findByTestId('identity-gate')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Continuar como visitante/ })).toBeNull();
    expect(screen.getByLabelText('Celular')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('dc_pending_mesa') || '{}').token).toBe(TOKEN);
    expect(h.access.enterTable).not.toHaveBeenCalled();
  });
  it('visitante anônimo antigo também precisa se identificar', async () => {
    h.caps.mockResolvedValue(V2); baseRpc(); h.auth.user = { id: 'anon', is_anonymous: true };
    render(<DineInClientApp token={TOKEN} />);
    expect(await screen.findByTestId('identity-gate')).toBeTruthy();
    expect(h.access.enterTable).not.toHaveBeenCalled();
  });
  it('cadastro exige aceite legal, nome e celular válidos; mostra "confirme seu e-mail" e volta para a mesa depois', async () => {
    h.caps.mockResolvedValue(V2); baseRpc();
    h.auth.signUp.mockResolvedValue({ success: true, requiresEmailConfirmation: true });
    render(<DineInClientApp token={TOKEN} />);
    await screen.findByTestId('identity-gate');
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Ana Souza' } });
    fireEvent.change(screen.getByLabelText('Celular'), { target: { value: '11 99999-0000' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@x.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'segredo123' } });
    const submit = screen.getByRole('button', { name: 'Criar conta e continuar' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit);
    await screen.findByTestId('identity-confirm-email');
    const call = h.auth.signUp.mock.calls[0];
    expect(call.slice(0, 4)).toEqual(['ana@x.com', 'segredo123', 'Ana Souza', '+5511999990000']);
    expect(call[4]).toMatchObject({ user_type: 'customer', legal_accepted: true });
    expect(localStorage.getItem('dc_pending_mesa')).toContain(TOKEN);
  });
  it('mesa em uso: mostra "Esta mesa já está em uso", "Fui convidado" e aceita só o código certo', async () => {
    h.caps.mockResolvedValue(V2); baseRpc(); h.auth.user = { id: 'u1', user_metadata: { name: 'Beto Lima' } };
    h.access.enterTable.mockResolvedValue({ state: 'IN_USE', tableLabel: 'Mesa 03' });
    h.access.joinWithCode.mockResolvedValueOnce({ entry: null, invalid: true, free: false })
      .mockResolvedValueOnce({ entry: { state: 'GUEST', sessionId: 's2', approved: true }, invalid: false, free: false });
    render(<DineInClientApp token={TOKEN} />);
    expect((await screen.findByTestId('table-in-use')).textContent).toContain('Esta mesa já está em uso');
    expect(h.access.enterTable).toHaveBeenCalledWith(TOKEN, 'Beto', expect.any(String));
    fireEvent.click(screen.getByRole('button', { name: 'Fui convidado' }));
    const input = screen.getByLabelText('Código do convite');
    fireEvent.change(input, { target: { value: 'zz9 9zz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na mesa' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/inválido ou expirado/);
    fireEvent.change(input, { target: { value: 'ab3k7p' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na mesa' }));
    await waitFor(() => expect(h.access.joinWithCode).toHaveBeenLastCalledWith(TOKEN, 'AB3K7P', 'Beto', expect.any(String)));
    h.rpc.mockImplementation(async (name: string) => name === 'get_my_tab' ? myTab('GUEST') : name === 'resolve_table_qr' ? { data: resolved, error: null } : { data: null, error: null });
    expect((await screen.findByTestId('role-chip')).textContent).toContain('Convidado');
  });
  it('link/QR de convite (&convite=) tenta o código automaticamente depois do login', async () => {
    window.history.replaceState(null, '', `/app/loja-x?mesa=${TOKEN}&convite=ab3k7p`);
    h.caps.mockResolvedValue(V2); baseRpc(); h.auth.user = { id: 'u1' };
    h.access.enterTable.mockResolvedValue({ state: 'IN_USE' });
    h.access.joinWithCode.mockResolvedValue({ entry: { state: 'GUEST', sessionId: 's2', approved: false }, invalid: false, free: false });
    render(<DineInClientApp token={TOKEN} />);
    await waitFor(() => expect(h.access.joinWithCode).toHaveBeenCalledWith(TOKEN, 'AB3K7P', 'Cliente', expect.any(String)));
    expect(window.location.search).not.toContain('convite');
  });
  it('Responsável: vê a faixa, gera código de convite com QR, vê pessoas e remove convidado', async () => {
    h.caps.mockResolvedValue(V2); h.auth.user = { id: 'u1' };
    h.access.enterTable.mockResolvedValue({ state: 'RESPONSIBLE', sessionId: 's1', approved: true });
    h.access.getInvite.mockResolvedValue(null);
    h.access.createInvite.mockResolvedValue({ code: 'AB3K7P', expiresAt: new Date(Date.now() + 15 * 60000).toISOString() });
    h.access.removeGuest.mockResolvedValue(undefined);
    baseRpc({ get_my_tab: myTab('RESPONSIBLE') });
    render(<DineInClientApp token={TOKEN} />);
    expect((await screen.findByTestId('role-chip')).textContent).toContain('responsável');
    fireEvent.click(screen.getByRole('button', { name: 'Ver minha conta' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar código de convite' }));
    expect((await screen.findByTestId('invite-code')).textContent).toBe('AB3 K7P');
    expect(h.access.createInvite).toHaveBeenCalledWith('s1', 15);
    expect(screen.getByTestId('invite-panel').querySelector('svg')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover Beto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(h.access.removeGuest).toHaveBeenCalledWith('s1', 's2'));
  });
  it('convidado não vê "Convidar"; sessão encerrada pelo responsável explica e oferece entrar de novo', async () => {
    h.caps.mockResolvedValue(V2); h.auth.user = { id: 'u2' };
    h.access.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 's2', approved: true });
    baseRpc({ get_my_tab: { data: { ended: true, endedReason: 'REMOVED', me: { sessionId: 's2', ended: true, endedReason: 'REMOVED' } }, error: null } });
    render(<DineInClientApp token={TOKEN} />);
    expect((await screen.findByTestId('dine-in-ended')).textContent).toMatch(/removido desta mesa/);
    expect(screen.queryByTestId('invite-panel')).toBeNull();
  });
  it('mesa aguardando liberação: texto amigável (sem "aprovação do garçom") e aviso ao servidor', async () => {
    h.caps.mockResolvedValue(V2); h.auth.user = { id: 'u1' };
    h.access.enterTable.mockResolvedValue({ state: 'RESPONSIBLE', sessionId: 's1', approved: false });
    baseRpc({ get_my_tab: myTab('RESPONSIBLE', false) });
    render(<DineInClientApp token={TOKEN} />);
    const banner = await screen.findByTestId('awaiting-release');
    expect(banner.textContent).toContain('Avisamos o garçom');
    expect(banner.textContent).not.toMatch(/aprovação do garçom/i);
    await waitFor(() => expect(h.access.pingPending).toHaveBeenCalledWith('s1'));
  });
});

describe('Mesa — modelo antigo (banco sem a migração) continua igual', () => {
  it('botão chama "Fazer pedido" e a espera de liberação usa texto amigável', async () => {
    h.caps.mockResolvedValue(V1); h.auth.user = { id: 'u1' };
    h.rpc.mockImplementation(async (name: string) => {
      if (name === 'resolve_table_qr') return { data: resolved, error: null };
      if (name === 'get_table_qr_status') return { data: { found: true, paused: false }, error: null };
      if (name === 'open_or_join_tab') return { data: { sessionId: 's1' }, error: null };
      if (name === 'submit_round') return { data: null, error: { message: 'SESSION_NOT_APPROVED: aguarde' } };
      return { data: null, error: null };
    });
    render(<DineInClientApp token={TOKEN} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Chopp' }));
    expect(screen.queryByText('Enviar para a cozinha')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fazer pedido' }));
    const note = await screen.findByRole('status');
    expect(note.textContent).toContain('Avisamos o garçom');
    expect(h.access.enterTable).not.toHaveBeenCalled();
    expect(screen.queryByTestId('identity-gate')).toBeNull();
  });
});
