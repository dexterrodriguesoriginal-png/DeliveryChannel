// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product, ProductOptionGroup } from '../../../types';

const h = vi.hoisted(() => ({
  load: vi.fn(), recommend: vi.fn(), impression: vi.fn(), accept: vi.fn(), conversion: vi.fn(), create: vi.fn(), toast: vi.fn(),
  user: null as null | { id: string; email: string; user_metadata: { name: string } },
  channels: new Map<string, { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }>(),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ supabaseUser: h.user, activeTenant: null }) }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: h.toast }) }));
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {
  rpc: vi.fn(async () => ({ data: null, error: null })),
  channel: (name: string) => {
    if (h.channels.has(name)) return h.channels.get(name);
    const channel = { on: vi.fn(() => channel), subscribe: vi.fn(() => channel) };
    h.channels.set(name, channel); return channel;
  }, removeChannel: vi.fn(),
} }));
vi.mock('../../../repositories/publicStoreRepository', () => ({ publicStoreRepository: { loadPublicStore: (...args: unknown[]) => h.load(...args) } }));
vi.mock('../../../repositories/upsellRepository', async importOriginal => ({ ...await importOriginal<typeof import('../../../repositories/upsellRepository')>(), upsellRepository: {
  recommend: (...args: unknown[]) => h.recommend(...args), impression: (...args: unknown[]) => h.impression(...args),
  accept: (...args: unknown[]) => h.accept(...args), recordConversion: (...args: unknown[]) => h.conversion(...args),
} }));
vi.mock('../../../repositories/tenantModuleRepository', () => ({ tenantModuleRepository: { getPublicEnabled: async () => new Set(['delivery', 'pickup', 'addons']) } }));
vi.mock('../../../repositories/productOptionRepository', () => ({ productOptionRepository: { getPublicForProducts: async () => new Map([['configured', [group]]]) } }));
vi.mock('../../../repositories/customerRepository', () => ({ customerRepository: { getCustomerByUserId: async () => null } }));
vi.mock('../../../repositories/orderRepository', () => ({ orderRepository: { getCustomerOrders: async () => [], subscribeToCustomerOrders: () => () => {} } }));
vi.mock('../../../services/orderService', () => ({ orderService: { createPublic: (...args: unknown[]) => h.create(...args) } }));
vi.mock('../../../lib/pwa/applyStoreIdentity', () => ({ applyStoreIdentity: vi.fn().mockResolvedValue({}) }));
vi.mock('../../../lib/theme/themeEngine', async importOriginal => ({ ...await importOriginal<typeof import('../../../lib/theme/themeEngine')>(), SAFE_FONT_FAMILIES: [] }));
vi.mock('../../../components/client/InstallStoreAppHint', () => ({ InstallStoreAppHint: () => null }));
vi.mock('../../../components/client/OrderPixPanel', () => ({ OrderPixPanel: () => null }));
vi.mock('../../../components/client/OnlineOrderPaymentPanel', () => ({ OnlineOrderPaymentPanel: () => null }));
vi.mock('../../../components/client/OnlinePaymentOptions', () => ({ OnlinePaymentOptions: () => null }));
vi.mock('../../../components/storefront/ThemedProductList', () => ({ ThemedProductList: ({ products, onAddToCart }: { products: Product[]; onAddToCart: (p: Product) => void }) => <div>{products.map(product => <button type="button" key={product.id} onClick={() => onAddToCart(product)}>Adicionar {product.name}</button>)}</div> }));

import { ClientApp } from '../ClientApp';

const group: ProductOptionGroup = {
  id: 'extra', tenantId: 'tenant-a', name: 'Escolha o complemento', type: 'STANDARD', minSelect: 1, maxSelect: 1,
  allowRepeat: false, active: true, pricingRule: 'SUM', sort: 0,
  options: [{ id: 'milk', groupId: 'extra', tenantId: 'tenant-a', name: 'Leite integral', extraPriceCents: 250, active: true, soldOut: false, sort: 0 }],
};
const products: Product[] = [
  { id: 'burger', tenantId: 'tenant-a', categoryId: 'main', name: 'Hambúrguer da casa', description: 'Da casa', price: 30,
    imageUrl: '', isActive: true, isAvailable: true, stockQuantity: 20, unit: 'un' },
  { id: 'juice', tenantId: 'tenant-a', categoryId: 'drinks', name: 'Suco natural', description: 'Fresco', price: 8,
    imageUrl: '', isActive: true, isAvailable: true, stockQuantity: 20, unit: 'copo' },
  { id: 'configured', tenantId: 'tenant-a', categoryId: 'drinks', name: 'Café especial', description: 'Escolha o leite', price: 10,
    imageUrl: '', isActive: true, isAvailable: true, stockQuantity: 20, unit: 'copo' },
];
const store = (slug = 'loja-a', tenantId = 'tenant-a') => ({
  tenant: { id: tenantId, slug, name: 'Café da Praça', phone: '', email: '', category: 'RESTAURANTE', status: 'ACTIVE' },
  theme: { storeName: 'Café da Praça', primaryColor: '#166534', secondaryColor: '#14532d', backgroundColor: '#ffffff', cardColor: '#ffffff', textColor: '#0f172a', borderRadius: '1rem', tagline: '' },
  settings: { isOpen: true, minOrderValue: 0, deliveryFee: 0, estimatedDeliveryTime: '30 min', address: 'Rua da Praça', city: 'São Paulo', phoneWhatsApp: '', deliveryEnabled: true, pickupEnabled: true },
  categories: [{ id: 'main', tenantId, name: 'Lanches', isActive: true, order: 0 }, { id: 'drinks', tenantId, name: 'Bebidas', isActive: true, order: 1 }],
  products: products.map(product => ({ ...product, tenantId })), offers: [], campaigns: [], promotionCarousels: [], serverTimeOffsetMs: 0,
});
const offer = (productId = 'juice') => ({ offerToken: 'offer-a', suggestions: [{ productId, reason: 'Combina com seu pedido' }] });

beforeEach(() => {
  vi.clearAllMocks(); h.channels.clear(); localStorage.clear(); sessionStorage.clear(); h.user = null;
  window.history.replaceState(null, '', '/app/loja-a'); window.scrollTo = vi.fn();
  h.load.mockResolvedValue({ status: 'ok', data: store() });
  h.recommend.mockResolvedValue(offer()); h.impression.mockResolvedValue(undefined); h.accept.mockResolvedValue(undefined); h.conversion.mockResolvedValue(undefined);
  h.create.mockResolvedValue({ id: 'order-real', tenantId: 'tenant-a', orderNumber: 12, status: 'PENDING', paymentStatus: 'PENDING', paymentMethod: 'PIX', fulfillmentType: 'PICKUP', total: 38,
    items: [], createdAt: '2026-11-05T12:00:00Z', deliveryAddress: 'Retirada no balcão', customerName: 'Ana', customerPhone: '11999990000' });
});
afterEach(cleanup);

describe('Leve também no aplicativo da loja', () => {
  it('pede sugestões depois da adição real e um toque inclui o complemento sem criar outro pedido de upsell', async () => {
    render(<ClientApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Hambúrguer da casa' }));
    const sheet = await screen.findByRole('dialog', { name: 'Leve também' });
    expect(h.recommend).toHaveBeenCalledWith('loja-a', 'burger', [{ productId: 'burger', quantity: 1 }], 'DELIVERY');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Levar Suco natural' }));
    await waitFor(() => expect(h.accept).toHaveBeenCalledWith('offer-a', 'juice'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Leve também' })).toBeNull());
    expect(screen.getByTestId('floating-cart').textContent).toContain('2');
    expect(h.recommend).toHaveBeenCalledTimes(1);
    expect(h.conversion).not.toHaveBeenCalled();
  });

  it('sugestão com adicionais usa o seletor obrigatório e só inclui depois de uma escolha válida', async () => {
    h.recommend.mockResolvedValue(offer('configured'));
    render(<ClientApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Hambúrguer da casa' }));
    const sheet = await screen.findByRole('dialog', { name: 'Leve também' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Levar Café especial' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Leve também' })).toBeNull());
    const detail = (await screen.findByTestId('product-option-groups')).closest('div.relative')! as HTMLElement;
    const add = within(detail).getByRole('button', { name: 'Adicionar à Sacola' });
    expect(add.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(detail).getByRole('button', { name: 'Escolher' }));
    expect(add.hasAttribute('disabled')).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(screen.queryByTestId('product-option-groups')).toBeNull());
    expect(screen.getByTestId('floating-cart').textContent).toContain('2');
    expect(h.recommend).toHaveBeenCalledTimes(1);
  });

  it('resposta pendente não abre sugestões por cima da revisão da sacola/checkout', async () => {
    let finish!: (value: ReturnType<typeof offer>) => void;
    h.recommend.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<ClientApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Hambúrguer da casa' }));
    fireEvent.click(screen.getByTestId('floating-cart'));
    await screen.findByTestId('cart-screen');
    await act(async () => finish(offer()));
    expect(screen.queryByRole('dialog', { name: 'Leve também' })).toBeNull();
    expect(h.impression).not.toHaveBeenCalled();
  });

  it('atribui somente depois do servidor criar um pedido, sem enviar preços do upsell no checkout', async () => {
    h.user = { id: 'customer-a', email: 'cliente@example.com', user_metadata: { name: 'Ana' } };
    localStorage.setItem('adegafood_cust_name', 'Ana'); localStorage.setItem('adegafood_cust_phone', '11999990000');
    render(<ClientApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Hambúrguer da casa' }));
    const sheet = await screen.findByRole('dialog', { name: 'Leve também' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Levar Suco natural' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Leve também' })).toBeNull());
    fireEvent.click(screen.getByTestId('floating-cart'));
    const cart = await screen.findByTestId('cart-screen');
    fireEvent.click(within(cart).getByRole('button', { name: 'Retirada' }));
    fireEvent.click(within(cart).getByRole('button', { name: /Continuar/ }));
    const checkout = (await screen.findByRole('heading', { name: 'Finalizar Pedido' })).closest('div.relative')! as HTMLElement;
    expect(h.conversion).not.toHaveBeenCalled();
    fireEvent.submit(checkout.querySelector('form')!);
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.conversion).toHaveBeenCalledWith('offer-a', 'order-real'));
    const submitted = h.create.mock.calls[0][1];
    expect(submitted.items).toEqual([{ productId: 'burger', quantity: 1 }, { productId: 'juice', quantity: 1 }]);
    expect(submitted.items.every((item: Record<string, unknown>) => !('price' in item) && !('unitPrice' in item))).toBe(true);
  });

  it('preserva o aceite do visitante após login e uma tentativa falha não vira venda', async () => {
    localStorage.setItem('adegafood_cust_name', 'Ana'); localStorage.setItem('adegafood_cust_phone', '11999990000');
    h.create.mockRejectedValueOnce(new Error('Falha temporária de conexão'));
    const view = render(<ClientApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Hambúrguer da casa' }));
    const sheet = await screen.findByRole('dialog', { name: 'Leve também' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Levar Suco natural' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Leve também' })).toBeNull());
    h.user = { id: 'new-customer', email: 'cliente@example.com', user_metadata: { name: 'Ana' } };
    view.rerender(<ClientApp />);
    fireEvent.click(screen.getByTestId('floating-cart'));
    const cart = await screen.findByTestId('cart-screen');
    fireEvent.click(within(cart).getByRole('button', { name: 'Retirada' }));
    fireEvent.click(within(cart).getByRole('button', { name: /Continuar/ }));
    const checkout = (await screen.findByRole('heading', { name: 'Finalizar Pedido' })).closest('div.relative')! as HTMLElement;
    fireEvent.submit(checkout.querySelector('form')!);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(h.conversion).not.toHaveBeenCalled();
    fireEvent.submit(checkout.querySelector('form')!);
    await waitFor(() => expect(h.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.conversion).toHaveBeenCalledExactlyOnceWith('offer-a', 'order-real'));
  });
});
