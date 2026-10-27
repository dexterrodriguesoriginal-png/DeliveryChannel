// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  signIn: vi.fn(),
  user: { value: null as null | { id: string } },
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ supabaseUser: h.user.value }) }));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => h.rpc(...a), auth: { signInAnonymously: (...a: unknown[]) => h.signIn(...a) }, from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) }) } }));
vi.mock('../../../repositories/publicStoreRepository', () => ({ publicStoreRepository: { loadPublicStore: async () => ({ status: 'ok', data: { tenant: { id: 'tn', name: 'Loja X' }, products: [] } }) } }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({ tenantModuleRepository: { getPublicEnabled: async () => new Set(['dine_in']) } }));
vi.mock('../../../repositories/productOptionRepository', () => ({ productOptionRepository: { getPublicForProducts: async () => new Map() } }));

import { DineInClientApp, guestDisplayName, mesaTitle } from '../DineInClientApp';

const TOKEN = 'k'.repeat(48);
const resolved = { available: true, tenantSlug: 'loja-x', storeName: 'Loja X', tableLabel: 'Mesa 03' };
const route = (paused: boolean | 'missing') => h.rpc.mockImplementation(async (name: string) => {
  if (name === 'resolve_table_qr') return { data: resolved, error: null };
  if (name === 'get_table_qr_status') return paused === 'missing' ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } : { data: { found: true, paused }, error: null };
  return { data: null, error: null };
});

beforeEach(() => { h.rpc.mockReset(); h.signIn.mockReset(); h.user.value = null; localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);

describe('DineInClientApp — QR da mesa', () => {
  it('QR pausado pela loja: mostra aviso e nunca pede nome nem entra na comanda', async () => {
    route(true);
    render(<DineInClientApp token={TOKEN} />);
    expect((await screen.findByTestId('dine-in-paused')).textContent).toContain('Pedidos pelo QR pausados');
    expect(screen.queryByLabelText('Seu primeiro nome')).toBeNull();
    expect(h.signIn).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith('get_table_qr_status', { p_qr_token: TOKEN });
  });
  it('banco antigo (sem get_table_qr_status) segue o fluxo normal: falha aberta, só informativo', async () => {
    route('missing');
    render(<DineInClientApp token={TOKEN} />);
    expect(await screen.findByLabelText('Seu primeiro nome')).toBeTruthy();
    expect(screen.queryByTestId('dine-in-paused')).toBeNull();
  });
  it('nome é opcional: entra como visitante sem digitar, sem gravar nada no aparelho', async () => {
    route(false);
    h.signIn.mockResolvedValue({ error: null });
    render(<DineInClientApp token={TOKEN} />);
    const button = await screen.findByRole('button', { name: /Continuar como visitante/ });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(h.signIn).toHaveBeenCalledTimes(1));
    expect(h.signIn.mock.calls[0][0]).toEqual({ options: { data: { display_name: 'Cliente' } } });
    expect(localStorage.getItem('adegafood_cust_name')).toBeNull();
  });
  it('só o primeiro nome é enviado quando informado', async () => {
    route(false);
    h.signIn.mockResolvedValue({ error: null });
    render(<DineInClientApp token={TOKEN} />);
    fireEvent.change(await screen.findByLabelText('Seu primeiro nome'), { target: { value: '  Maria da Silva ' } });
    fireEvent.click(screen.getByRole('button', { name: /Continuar como visitante/ }));
    await waitFor(() => expect(h.signIn).toHaveBeenCalled());
    expect(h.signIn.mock.calls[0][0].options.data.display_name).toBe('Maria');
  });
  it('guestDisplayName: vazio vira "Cliente", só 1ª palavra, máximo 40', () => {
    expect(guestDisplayName('')).toBe('Cliente');
    expect(guestDisplayName('   ')).toBe('Cliente');
    expect(guestDisplayName('Ana Paula')).toBe('Ana');
    expect(guestDisplayName('x'.repeat(100))).toHaveLength(40);
  });
  it('mesaTitle não duplica a palavra Mesa', () => {
    expect(mesaTitle('Mesa 03')).toBe('Mesa 03');
    expect(mesaTitle('mesa 3')).toBe('mesa 3');
    expect(mesaTitle('7')).toBe('Mesa 7');
    expect(mesaTitle('Varanda 1')).toBe('Mesa Varanda 1');
    expect(mesaTitle(undefined)).toBe('Mesa');
  });
  it('pausa detectada ao abrir a comanda (corrida): mensagem amigável', async () => {
    route(false);
    h.user.value = { id: 'u1' };
    h.rpc.mockImplementation(async (name: string) => {
      if (name === 'resolve_table_qr') return { data: resolved, error: null };
      if (name === 'get_table_qr_status') return { data: { found: true, paused: false }, error: null };
      if (name === 'open_or_join_tab') return { data: null, error: { message: 'QR_PAUSED: pedidos pausados' } };
      return { data: null, error: null };
    });
    render(<DineInClientApp token={TOKEN} />);
    expect((await screen.findByTestId('dine-in-paused'))).toBeTruthy();
  });
});
