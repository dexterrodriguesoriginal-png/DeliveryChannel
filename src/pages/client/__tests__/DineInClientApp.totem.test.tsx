// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product, ProductOptionGroup } from '../../../types';
import { DEFAULT_MENU_THEME } from '../../../lib/theme/menuTheme';

const h = vi.hoisted(() => ({
  rpc: vi.fn(), enterTable: vi.fn(), loadStore: vi.fn(), outdoor: vi.fn(),
  user: null as null | { id: string; is_anonymous?: boolean },
  subscriptions: [] as Array<{ table: string; callback: () => void }>,
  channels: new Map<string, { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }>(),
  removeChannel: vi.fn(),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ supabaseUser: h.user }) }));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {
  rpc: (...args: unknown[]) => h.rpc(...args),
  channel: (name: string) => {
    // The real client returns the same object for repeated channel names.
    const existing = h.channels.get(name);
    if (existing) return existing;
    const channel = {
      on: vi.fn((_event: unknown, filter: { table: string }, callback: () => void) => {
        h.subscriptions.push({ table: filter.table, callback }); return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    h.channels.set(name, channel); return channel;
  },
  removeChannel: (...args: unknown[]) => h.removeChannel(...args),
} }));
vi.mock('../../../lib/pwa/applyStoreIdentity', () => ({ applyStoreIdentity: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../lib/pwa/installState', () => ({ getDeferredPrompt: () => null, clearDeferredPrompt: vi.fn() }));
vi.mock('../../../repositories/publicStoreRepository', () => ({ publicStoreRepository: { loadPublicStore: (...args: unknown[]) => h.loadStore(...args) } }));
vi.mock('../../../repositories/menuOutdoorRepository', () => ({ menuOutdoorRepository: { getPublicSlides: (...args: unknown[]) => h.outdoor(...args) } }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({ tenantModuleRepository: { getPublicEnabled: async () => new Set(['dine_in', 'addons']) } }));
vi.mock('../../../repositories/productOptionRepository', () => ({ productOptionRepository: { getPublicForProducts: async () => new Map([['burger', [requiredGroup]]]) } }));
vi.mock('../../../repositories/mesasQrRepository', () => ({ mesasQrRepository: { capabilities: async () => ({ tableAccess: true }) } }));
vi.mock('../../../repositories/tableAccessRepository', () => ({ tableAccessRepository: {
  enterTable: (...args: unknown[]) => h.enterTable(...args), listFreeTables: async () => [], pingPending: vi.fn(),
} }));
vi.mock('../../../repositories/waiterV2Repository', () => ({ waiterV2Repository: { myTableWaiter: async () => null } }));

import { DineInClientApp, SESSION_KEY_PREFIX } from '../DineInClientApp';

const TOKEN = 't'.repeat(48);
const requiredGroup: ProductOptionGroup = {
  id: 'point', tenantId: 'tn', name: 'Ponto da carne', type: 'STANDARD', minSelect: 1, maxSelect: 1,
  allowRepeat: false, pricingRule: 'SUM', active: true, sort: 0,
  options: [{ id: 'medium', tenantId: 'tn', groupId: 'point', name: 'Ao ponto', extraPriceCents: 250, active: true, soldOut: false, sort: 0 }],
};
const products: Product[] = [
  { id: 'juice', tenantId: 'tn', categoryId: 'drinks', name: 'Suco da casa', description: 'Frutas frescas', price: 12,
    imageUrl: 'https://example.com/suco.webp', isActive: true, isAvailable: true, stockQuantity: 0, unit: 'copo' },
  { id: 'burger', tenantId: 'tn', categoryId: 'snacks', name: 'Hambúrguer especial', description: 'Feito na hora', price: 30, promotionalPrice: 20,
    imageUrl: 'https://example.com/burger.webp', isActive: true, isAvailable: true, stockQuantity: 0, unit: 'un' },
];
const menuTheme = { ...DEFAULT_MENU_THEME, accent: '#166534', categoryActiveBg: '#166534', radius: 24 };
const round = (status = 'PENDING', orderId = 'o1', deliveryCode: string | null = '4821') => ({
  orderId, orderNumber: 18, roundNo: orderId === 'o1' ? 1 : 2, status, customerName: 'Ana', mine: true,
  subtotal: 12, createdAt: '2026-11-04T18:00:00Z', queuePosition: 2, deliveryCode,
  deliveryConfirmedWithCode: status === 'DELIVERED', deliveredAt: status === 'DELIVERED' ? '2026-11-04T18:10:00Z' : null,
  items: [{ name: 'Suco da casa', quantity: 1 }],
});
const tab = (rounds: ReturnType<typeof round>[] = [], approved = true) => ({
  tabId: 'tb', status: 'OPEN', mode: 'TABLE', tableLabel: 'Mesa 03', serviceFeePercent: 0, serviceFeeRemoved: false,
  subtotal: rounds.reduce((sum, order) => sum + order.subtotal, 0), rounds,
  me: { sessionId: 'session-3', role: 'GUEST', approved, displayName: 'Ana' },
});
let account = tab();
const openMenu = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Cardápio' }));
  return screen.findByTestId('totem-menu-view');
};
const signedSession = () => {
  h.user = { id: 'customer' };
  sessionStorage.setItem(SESSION_KEY_PREFIX + TOKEN, 'session-3');
};
const refreshTracking = async () => {
  const subscription = h.subscriptions.find(item => item.table === 'dining_tracking_revisions');
  expect(subscription).toBeTruthy();
  await act(async () => subscription!.callback());
};

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); h.user = null; account = tab();
  h.channels.clear(); h.subscriptions.length = 0;
  h.rpc.mockReset(); h.enterTable.mockReset(); h.loadStore.mockReset(); h.outdoor.mockReset(); h.removeChannel.mockReset();
  window.history.replaceState(null, '', '/app/slug-sem-autoridade?mesa=' + TOKEN);
  h.enterTable.mockResolvedValue({ state: 'GUEST', sessionId: 'session-3', approved: true });
  h.loadStore.mockResolvedValue({ status: 'ok', data: {
    tenant: { id: 'tn', name: 'Café da Praça' },
    theme: { storeName: 'Café da Praça', primaryColor: '#FF00FF', logoUrl: '' }, menuTheme,
    categories: [{ id: 'drinks', tenantId: 'tn', name: 'Bebidas', isActive: true, order: 0 }, { id: 'snacks', tenantId: 'tn', name: 'Lanches', isActive: true, order: 1 }],
    products,
  } });
  h.outdoor.mockResolvedValue([{ id: 'outdoor', imageUrl: 'https://example.com/outdoor.webp', title: 'Experimente o especial', productId: 'burger' }]);
  h.rpc.mockImplementation(async (name: string) => {
    if (name === 'resolve_table_qr') return { data: { available: true, tenantSlug: 'cafe-da-praca', storeName: 'Café da Praça', tableLabel: 'Mesa 03' }, error: null };
    if (name === 'get_my_tab') return { data: account, error: null };
    if (name === 'list_my_table_move_requests') return { data: [], error: null };
    if (name === 'submit_round') return { data: { orderId: 'o1' }, error: null };
    return { data: null, error: null };
  });
});
afterEach(cleanup);

describe('QR → cardápio totem → pedido na mesa', () => {
  it.each(['/mesa/' + TOKEN, '/app/slug-sem-autoridade?mesa=' + TOKEN])('abre o totem usando somente a loja resolvida pelo token: %s', async route => {
    window.history.replaceState(null, '', route);
    render(<DineInClientApp token={TOKEN} />);
    expect(await screen.findByTestId('dinein-home')).toBeTruthy();
    expect(screen.queryByTestId('totem-menu-view')).toBeNull();
    const menu = await openMenu();
    await screen.findByTestId('totem-outdoor-area');
    expect(h.loadStore).toHaveBeenCalledWith('cafe-da-praca');
    expect(h.outdoor).toHaveBeenCalledWith('cafe-da-praca');
    expect(h.enterTable).not.toHaveBeenCalled();
    const categories = within(menu).getByTestId('totem-categories-sidebar');
    expect(within(categories).getByRole('tab', { name: 'Bebidas' })).toBeTruthy();
    expect(within(categories).getByRole('tab', { name: 'Lanches' })).toBeTruthy();
    expect(within(within(menu).getByTestId('product-card-juice')).getByRole('img', { name: 'Suco da casa' }).getAttribute('src')).toBe(products[0].imageUrl);
    expect(menu.style.getPropertyValue('--totem-accent')).toBe('#166534');
    expect(menu.style.getPropertyValue('--totem-radius')).toBe('24px');
    expect(menu.style.getPropertyValue('--totem-accent')).not.toBe('#FF00FF');
  });

  it.each(['botão', 'outdoor'])('exige os adicionais antes de adicionar pelo %s e envia opções para a sessão da mesa', async source => {
    signedSession(); render(<DineInClientApp token={TOKEN} />); await openMenu();
    if (source === 'outdoor') fireEvent.click(await screen.findByRole('button', { name: 'Experimente o especial' }));
    else fireEvent.click(screen.getByRole('button', { name: 'Adicionar Hambúrguer especial' }));
    const options = await screen.findByRole('dialog', { name: 'Personalizar Hambúrguer especial' });
    const add = within(options).getByRole('button', { name: 'Adicionar à rodada' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByTestId('dinein-bag-counter').textContent).toContain('0');
    fireEvent.click(within(options).getByRole('button', { name: 'Escolher' }));
    expect(add.disabled).toBe(false); fireEvent.click(add);
    fireEvent.click(screen.getByTestId('totem-cart-button'));
    const bag = screen.getByRole('dialog', { name: 'Sua sacola' });
    expect(bag.textContent).toContain('Ao ponto');
    expect(bag.textContent).toContain('22,50');
    fireEvent.click(within(bag).getByRole('button', { name: 'Finalizar pedido' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Confirmar pedido na mesa' });
    expect(confirmation.textContent).toContain('Mesa 03'); expect(confirmation.textContent).toContain('Ao ponto');
    fireEvent.click(within(confirmation).getByTestId('confirm-order-submit'));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('submit_round', expect.objectContaining({
      p_session_id: 'session-3', p_items: [{ productId: 'burger', quantity: 1, notes: '', options: [{ group_id: 'point', option_id: 'medium', qty: 1, fraction: null }] }],
    })));
    await waitFor(() => expect(screen.getByTestId('totem-cart-badge').textContent).toBe('0'));
  });

  it('mantém a sacola entre totem, início e Adicionar mais itens', async () => {
    render(<DineInClientApp token={TOKEN} />); await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
    expect(screen.getByTestId('totem-cart-badge').textContent).toBe('1');
    fireEvent.click(screen.getByTestId('totem-cart-button'));
    const bag = screen.getByRole('dialog', { name: 'Sua sacola' });
    fireEvent.click(within(bag).getByRole('button', { name: 'Aumentar Suco da casa' }));
    fireEvent.click(within(bag).getByRole('button', { name: 'Adicionar mais itens' }));
    expect(screen.queryByRole('dialog', { name: 'Sua sacola' })).toBeNull();
    expect(screen.getByTestId('totem-cart-badge').textContent).toBe('2');
    fireEvent.click(screen.getByTestId('totem-back-button'));
    await screen.findByTestId('dinein-home');
    fireEvent.click(screen.getByTestId('dinein-bag-counter'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Sua sacola' })).getByRole('button', { name: 'Adicionar mais itens' }));
    expect(await screen.findByTestId('totem-menu-view')).toBeTruthy();
    expect(screen.getByTestId('totem-cart-badge').textContent).toBe('2');
  });

  it('abre os detalhes ao tocar na foto e só adiciona o produto simples após confirmação', async () => {
    render(<DineInClientApp token={TOKEN} />); await openMenu();
    fireEvent.click(within(screen.getByTestId('product-card-juice')).getByRole('img', { name: 'Suco da casa' }));
    const details = await screen.findByRole('dialog', { name: 'Detalhes de Suco da casa' });
    expect(details.textContent).toContain('Frutas frescas');
    expect(screen.getByTestId('totem-cart-badge').textContent).toBe('0');
    fireEvent.click(within(details).getByRole('button', { name: 'Adicionar à rodada' }));
    expect(screen.queryByRole('dialog', { name: 'Detalhes de Suco da casa' })).toBeNull();
    expect(screen.getByTestId('totem-cart-badge').textContent).toBe('1');
  });

  it('deixa visitante navegar e montar a sacola, pedindo identidade apenas ao finalizar', async () => {
    render(<DineInClientApp token={TOKEN} />); await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
    fireEvent.click(screen.getByTestId('totem-cart-button'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Sua sacola' })).getByRole('button', { name: 'Finalizar pedido' }));
    expect(await screen.findByTestId('identity-gate')).toBeTruthy();
    expect(h.enterTable).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.some(call => call[0] === 'submit_round')).toBe(false);
  });

  it('não adiciona item personalizado se a conta for pedida enquanto o modal está aberto', async () => {
    signedSession(); render(<DineInClientApp token={TOKEN} />); await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Hambúrguer especial' }));
    const options = await screen.findByRole('dialog', { name: 'Personalizar Hambúrguer especial' });
    fireEvent.click(within(options).getByRole('button', { name: 'Escolher' }));
    account = { ...tab(), status: 'BILL_REQUESTED' };
    await refreshTracking();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Conta pedida' })).toBeTruthy());
    const stillOpen = screen.queryByRole('dialog', { name: 'Personalizar Hambúrguer especial' });
    if (stillOpen) fireEvent.click(within(stillOpen).getByRole('button', { name: 'Adicionar à rodada' }));
    expect(screen.getByTestId('dinein-bag-counter').textContent).toContain('0');
    expect(screen.getByTestId('totem-cart-badge').textContent).toBe('0');
    expect(h.rpc.mock.calls.some(call => call[0] === 'submit_round')).toBe(false);
  });

  it('preserva código, bolha e convite ao app; encerra acompanhamento e mostra nova rodada no totem', async () => {
    signedSession(); account = tab([round()]);
    render(<DineInClientApp token={TOKEN} />); await openMenu();
    expect((await screen.findByTestId('dinein-delivery-code-o1')).textContent).toContain('4821');
    expect(screen.getByTestId('dinein-track-order').textContent).toContain('4821');
    expect(screen.getByTestId('dinein-app-banner').textContent).toContain('Peça também de casa com nosso app');
    account = tab([round('DELIVERED')]); await refreshTracking();
    await waitFor(() => expect(screen.queryByTestId('dinein-track-order')).toBeNull());
    expect(screen.queryByTestId('dinein-delivery-code-o1')).toBeNull();
    account = tab([round('DELIVERED'), round('PENDING', 'o2', '6759')]); await refreshTracking();
    expect((await screen.findByTestId('dinein-delivery-code-o2')).textContent).toContain('6759');
    expect(screen.getByTestId('dinein-track-order').textContent).toContain('6759');
    expect(screen.getByTestId('totem-menu-view')).toBeTruthy();
    for (const channel of h.channels.values()) expect(channel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('não revela código no totem nem na bolha para sessão sem aprovação', async () => {
    signedSession(); account = tab([round('PENDING', 'o1', '7777')], false);
    render(<DineInClientApp token={TOKEN} />); await openMenu();
    await screen.findByTestId('dinein-track-order');
    expect(screen.queryByTestId('dinein-delivery-code-o1')).toBeNull();
    expect(screen.getByTestId('dinein-track-order').textContent).not.toContain('7777');
    expect(screen.getByTestId('totem-menu-view').textContent).not.toContain('7777');
  });
});
