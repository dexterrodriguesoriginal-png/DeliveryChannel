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

describe('Tela inicial personalizada no app da loja', () => {
  it('depois da #dc-boot mostra a imagem da loja, "Pular" leva à vitrine e não repete na mesma abertura', async () => {
    h.load.mockResolvedValue({ status: 'ok', data: { ...store(), presentation: { url: 'https://cdn.test/marketing-public/t/a.webp', mediaType: 'IMAGE', imageSeconds: 3, oncePerDay: false } } });
    const first = render(<ClientApp />);
    const overlay = await screen.findByTestId('store-presentation');
    expect(overlay.getAttribute('data-kind')).toBe('IMAGE');
    expect((screen.getByTestId('store-presentation-image') as HTMLImageElement).src).toBe('https://cdn.test/marketing-public/t/a.webp');
    // A vitrine já está montada por baixo (carrinho/checkout nunca ficam bloqueados depois do pular).
    expect(screen.getByRole('button', { name: 'Adicionar Hambúrguer da casa' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Pular/ }));
    await waitFor(() => expect(screen.queryByTestId('store-presentation')).toBeNull());
    first.unmount();
    render(<ClientApp />);
    await screen.findByRole('button', { name: 'Adicionar Hambúrguer da casa' });
    expect(screen.queryByTestId('store-presentation')).toBeNull();
  });
  it('sem tela configurada usa o padrão do tema (fundo do tema + nome da loja)', async () => {
    render(<ClientApp />);
    const overlay = await screen.findByTestId('store-presentation');
    expect(overlay.getAttribute('data-kind')).toBe('THEME');
    expect(within(overlay).getByText('Café da Praça')).toBeTruthy();
    expect(overlay.style.background.replace(/\s/g, '')).toMatch(/^(#ffffff|rgb\(255,255,255\))$/i);
  });
  it('1× por dia: não aparece de novo no mesmo dia, mesmo em nova abertura', async () => {
    const data = { ...store(), presentation: { url: 'https://cdn.test/marketing-public/t/v.mp4', mediaType: 'VIDEO', imageSeconds: 2.5, oncePerDay: true } };
    h.load.mockResolvedValue({ status: 'ok', data });
    const first = render(<ClientApp />);
    expect((await screen.findByTestId('store-presentation')).getAttribute('data-kind')).toMatch(/VIDEO|STILL/);
    first.unmount(); cleanup(); sessionStorage.clear();
    render(<ClientApp />);
    await screen.findByRole('button', { name: 'Adicionar Hambúrguer da casa' });
    expect(screen.queryByTestId('store-presentation')).toBeNull();
  });
});
