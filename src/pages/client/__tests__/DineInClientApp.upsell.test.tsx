// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product, ProductOptionGroup } from '../../../types';
import { DEFAULT_MENU_THEME } from '../../../lib/theme/menuTheme';
import { dineInCartStorageKey } from '../../../lib/customer/dineInCartStorage';

const h = vi.hoisted(() => ({
  rpc: vi.fn(), enterTable: vi.fn(), loadStore: vi.fn(), recommend: vi.fn(),
  user: null as null | { id: string; is_anonymous?: boolean },
  channels: new Map<string, { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }>(),
  removeChannel: vi.fn(),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ supabaseUser: h.user }) }));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {
  rpc: (...args: unknown[]) => h.rpc(...args),
  channel: (name: string) => {
    const existing = h.channels.get(name);
    if (existing) return existing;
    const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) };
    h.channels.set(name, channel); return channel;
  }, removeChannel: (...args: unknown[]) => h.removeChannel(...args),
} }));
vi.mock('../../../lib/pwa/applyStoreIdentity', () => ({ applyStoreIdentity: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../lib/pwa/installState', () => ({ getDeferredPrompt: () => null, clearDeferredPrompt: vi.fn() }));
vi.mock('../../../repositories/publicStoreRepository', () => ({ publicStoreRepository: { loadPublicStore: (...args: unknown[]) => h.loadStore(...args) } }));
vi.mock('../../../repositories/menuOutdoorRepository', () => ({ menuOutdoorRepository: { getPublicSlides: async () => [] } }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({ tenantModuleRepository: { getPublicEnabled: async () => new Set(['dine_in', 'addons']) } }));
vi.mock('../../../repositories/productOptionRepository', () => ({ productOptionRepository: { getPublicForProducts: async () => new Map([['burger', [requiredGroup]]]) } }));
vi.mock('../../../repositories/mesasQrRepository', () => ({ mesasQrRepository: { capabilities: async () => ({ tableAccess: true }) } }));
vi.mock('../../../repositories/tableAccessRepository', () => ({ tableAccessRepository: {
  enterTable: (...args: unknown[]) => h.enterTable(...args), listFreeTables: async () => [], pingPending: vi.fn(),
} }));
vi.mock('../../../repositories/waiterV2Repository', () => ({ waiterV2Repository: { myTableWaiter: async () => null } }));

import { DineInClientApp, SESSION_KEY_PREFIX } from '../DineInClientApp';

const TOKEN = 'u'.repeat(48);
const requiredGroup: ProductOptionGroup = {
  id: 'point', tenantId: 'tn', name: 'Ponto da carne', type: 'STANDARD', minSelect: 1, maxSelect: 1,
  allowRepeat: false, pricingRule: 'SUM', active: true, sort: 0,
  options: [{ id: 'medium', tenantId: 'tn', groupId: 'point', name: 'Ao ponto', extraPriceCents: 250, active: true, soldOut: false, sort: 0 }],
};
const product = (id: string, name: string, price = 8): Product => ({
  id, tenantId: 'tn', categoryId: 'drinks', name, price, description: '', imageUrl: '', isActive: true, isAvailable: true, stockQuantity: 20, unit: 'un',
});
const products = [product('juice', 'Suco da casa', 30), product('water', 'Água mineral'), product('dessert', 'Sobremesa'), product('coffee', 'Café'), product('burger', 'Hambúrguer especial', 20)];
const offer = (ids = ['water', 'dessert', 'coffee', 'burger']) => ({ offerToken: 'offer-token', suggestions: ids.map(productId => ({ productId, reason: 'Combina com seu pedido' })) });
const rpcCalls = (name: string) => h.rpc.mock.calls.filter(call => call[0] === name);
const openMenu = async () => {
  return screen.findByTestId('dinein-premium-kiosk');
};
const openBag = () => {
  fireEvent.click(screen.getByTestId('kiosk-nav-cart'));
  return screen.getByRole('dialog', { name: 'Sua sacola' });
};
function setup() {
  localStorage.clear(); sessionStorage.clear(); h.channels.clear(); vi.clearAllMocks();
  h.user = { id: 'customer' }; sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 'session-3');
  window.history.replaceState(null, '', '/app/slug-sem-autoridade?mesa=' + TOKEN);
  h.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 'session-3', approved: true });
  h.loadStore.mockResolvedValue({ status: 'ok', data: {
    tenant: { id: 'tn', name: 'Café da Praça' }, theme: { storeName: 'Café da Praça', logoUrl: '' }, menuTheme: DEFAULT_MENU_THEME,
    categories: [{ id: 'drinks', tenantId: 'tn', name: 'Cardápio da casa', isActive: true, order: 0 }], products,
  } });
  h.recommend.mockResolvedValue(offer());
  h.rpc.mockImplementation(async (name: string, params: unknown) => {
    if (name === 'resolve_table_qr') return { data: { available: true, tenantSlug: 'cafe-da-praca', storeName: 'Café da Praça', tableLabel: 'Mesa 03' }, error: null };
    if (name === 'get_my_tab') return { data: { tabId: 'tb', status: 'OPEN', mode: 'TABLE', tableLabel: 'Mesa 03', serviceFeePercent: 0, serviceFeeRemoved: false,
      subtotal: 0, rounds: [], me: { sessionId: 'session-3', role: 'GUEST', approved: true, displayName: 'Ana' } }, error: null };
    if (name === 'list_my_table_move_requests') return { data: [], error: null };
    if (name === 'recommend_upsell') return { data: await h.recommend(params), error: null };
    if (['record_upsell_impression', 'accept_upsell', 'record_upsell_conversion'].includes(name)) return { data: true, error: null };
    if (name === 'submit_round') return { data: { orderId: 'order-created' }, error: null };
    return { data: null, error: null };
  });
}
beforeEach(setup);
afterEach(cleanup);

describe('Leve também na mesa e no totem', () => {
  it('mostra até três complementos, adiciona por um toque e atribui só à rodada criada para a sessão', async () => {
    render(<DineInClientApp token={TOKEN} />); await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
    const sheet = await screen.findByRole('dialog', { name: 'Leve também' });
    expect(within(sheet).getAllByRole('button', { name: /^Levar / })).toHaveLength(3);
    expect(rpcCalls('recommend_upsell')[0][1]).toEqual({ p_slug: 'cafe-da-praca', p_source_product_id: 'juice', p_cart_items: [{ productId: 'juice', quantity: 1 }], p_channel: 'TOTEM' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Levar Água mineral' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Leve também' })).toBeNull());
    expect(screen.getByTestId('dinein-bag-counter').textContent).toBe('2');
    expect(rpcCalls('recommend_upsell')).toHaveLength(1);
    expect(rpcCalls('record_upsell_conversion')).toHaveLength(0);
    fireEvent.click(within(openBag()).getByRole('button', { name: 'Finalizar pedido' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Confirmar pedido na mesa' });
    fireEvent.click(within(confirmation).getByTestId('confirm-order-submit'));
    await waitFor(() => expect(rpcCalls('record_upsell_conversion')).toHaveLength(1));
    expect(rpcCalls('record_upsell_conversion')[0][1]).toEqual({ p_offer_token: 'offer-token', p_order_id: 'order-created' });
    expect(rpcCalls('submit_round')[0][1]).toEqual(expect.objectContaining({ p_session_id: 'session-3', p_items: [
      { productId: 'juice', quantity: 1, notes: '', options: [] }, { productId: 'water', quantity: 1, notes: '', options: [] },
    ] }));
  });

  it('não pula os adicionais obrigatórios ao aceitar uma sugestão nem dispara oferta recursiva', async () => {
    h.recommend.mockResolvedValue(offer(['burger']));
    render(<DineInClientApp token={TOKEN} />); await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
    const sheet = await screen.findByRole('dialog', { name: 'Leve também' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Levar Hambúrguer especial' }));
    const options = await screen.findByRole('dialog', { name: 'Personalizar Hambúrguer especial' });
    const add = within(options).getByRole('button', { name: 'Adicionar à rodada' });
    expect(add.hasAttribute('disabled')).toBe(true); expect(screen.getByTestId('dinein-bag-counter').textContent).toBe('1');
    fireEvent.click(within(options).getByRole('button', { name: 'Escolher' }));
    fireEvent.click(add);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Personalizar Hambúrguer especial' })).toBeNull());
    expect(screen.getByTestId('dinein-bag-counter').textContent).toBe('2');
    expect(rpcCalls('recommend_upsell')).toHaveLength(1);
    expect(within(openBag()).getByText('Ponto da carne: Ao ponto')).toBeTruthy();
  });

  it('oferece completar a sacola restaurada uma vez antes da revisão e nunca envia automaticamente', async () => {
    localStorage.setItem(dineInCartStorageKey(TOKEN), JSON.stringify({ at: Date.now(), checkoutPending: false, lines: [{ productId: 'juice', quantity: 1, options: [] }] }));
    render(<DineInClientApp token={TOKEN} />); await openMenu();
    expect(rpcCalls('recommend_upsell')).toHaveLength(0);
    fireEvent.click(within(openBag()).getByRole('button', { name: 'Finalizar pedido' }));
    const complete = await screen.findByRole('dialog', { name: 'Que tal completar?' });
    expect(screen.queryByRole('dialog', { name: 'Confirmar pedido na mesa' })).toBeNull();
    expect(rpcCalls('submit_round')).toHaveLength(0);
    fireEvent.click(within(complete).getByRole('button', { name: 'Continuar para o pedido' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Confirmar pedido na mesa' });
    expect(rpcCalls('submit_round')).toHaveLength(0);
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Voltar e editar' }));
    fireEvent.click(within(openBag()).getByRole('button', { name: 'Finalizar pedido' }));
    await screen.findByRole('dialog', { name: 'Confirmar pedido na mesa' });
    expect(rpcCalls('recommend_upsell')).toHaveLength(1); expect(rpcCalls('submit_round')).toHaveLength(0);
  });

  it('abrir a sacola cancela uma recomendação pendente e não registra uma exibição invisível', async () => {
    let finish!: (value: ReturnType<typeof offer>) => void;
    h.recommend.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<DineInClientApp token={TOKEN} />); await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
    await waitFor(() => expect(rpcCalls('recommend_upsell')).toHaveLength(1));
    openBag();
    await act(async () => finish(offer()));
    expect(screen.queryByRole('dialog', { name: 'Leve também' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Sua sacola' })).toBeTruthy();
    expect(rpcCalls('record_upsell_impression')).toHaveLength(0);
  });

  it('descarta sugestões pendentes ao trocar de identidade ou de QR', async () => {
    for (const change of ['identity', 'token']) {
      cleanup(); setup();
      let finish!: (value: ReturnType<typeof offer>) => void;
      h.recommend.mockReturnValue(new Promise(resolve => { finish = resolve; }));
      const view = render(<DineInClientApp token={TOKEN} />); await openMenu();
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
      await waitFor(() => expect(rpcCalls('recommend_upsell')).toHaveLength(1));
      if (change === 'identity') h.user = { id: 'other-customer' };
      view.rerender(<DineInClientApp token={change === 'token' ? 'v'.repeat(48) : TOKEN} />);
      await screen.findByTestId('confirm-logged-user-gate');
      await act(async () => finish(offer()));
      expect(screen.queryByRole('dialog', { name: 'Leve também' })).toBeNull();
      expect(rpcCalls('record_upsell_impression')).toHaveLength(0);
      expect(rpcCalls('record_upsell_conversion')).toHaveLength(0);
    }
  });
});
