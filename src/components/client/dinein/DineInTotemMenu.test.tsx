// @vitest-environment happy-dom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category, Product } from '../../../types';
import type { PublicMenuOutdoorSlide } from '../../../repositories/menuOutdoorRepository';
import { DEFAULT_MENU_THEME, MENU_TEMPLATES } from '../../../lib/theme/menuTheme';

const mocks = vi.hoisted(() => ({ slides: vi.fn() }));
vi.mock('../../../repositories/menuOutdoorRepository', () => ({
  menuOutdoorRepository: { getPublicSlides: (...args: unknown[]) => mocks.slides(...args) },
}));
import { DineInTotemMenu } from './DineInTotemMenu';

const category = (patch: Partial<Category> = {}): Category => ({
  id: 'drinks', tenantId: 'store-a', name: 'Bebidas', order: 1, isActive: true, ...patch,
});
const product = (patch: Partial<Product> = {}): Product => ({
  id: 'juice', tenantId: 'store-a', categoryId: 'drinks', name: 'Suco da casa', description: 'Fruta fresca',
  imageUrl: '/suco.jpg', price: 12, isActive: true, isAvailable: true, stockQuantity: 10, unit: 'un', ...patch,
});
function props(): React.ComponentProps<typeof DineInTotemMenu> {
  return {
    storeSlug: 'loja-a', storeTenantId: 'store-a', storeName: 'Café da Praça', logoUrl: '/logo.png',
    categories: [category()], products: [product()], menuTheme: { ...DEFAULT_MENU_THEME },
    cartCount: 2, orderingDisabled: false,
    onAddProduct: vi.fn(), onOpenProduct: vi.fn(), onOpenCart: vi.fn(), onBack: vi.fn(),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const slide = (patch: Partial<PublicMenuOutdoorSlide> = {}): PublicMenuOutdoorSlide => ({
  id: 'banner-a', imageUrl: '/banner-a.jpg', title: 'Experimente o suco', productId: 'juice', ...patch,
});
async function flush() { await act(async () => {}); }
beforeEach(() => { mocks.slides.mockReset(); mocks.slides.mockResolvedValue([]); });
afterEach(cleanup);

describe('cardápio totem ligado à conta da mesa', () => {
  it('usa o catálogo, fotos e tema próprio recebidos sem consultar dados de clientes', async () => {
    const p = props(); p.menuTheme = MENU_TEMPLATES.find(item => item.id === 'oceano')!.theme;
    render(<DineInTotemMenu {...p} />); await flush();
    expect(mocks.slides).toHaveBeenCalledExactlyOnceWith('loja-a');
    expect(screen.getByRole('tab', { name: 'Bebidas' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Suco da casa' }).getAttribute('src')).toBe('/suco.jpg');
    expect(screen.getByRole('img', { name: 'Café da Praça' }).getAttribute('src')).toBe('/logo.png');
    const view = screen.getByTestId('totem-menu-view');
    expect(view.style.getPropertyValue('--totem-bg')).toBe(p.menuTheme.background);
    expect(view.style.getPropertyValue('--totem-accent')).toBe(p.menuTheme.accent);
    expect(view.style.fontFamily).toContain('Plus Jakarta Sans');
    expect(screen.getByTestId('dinein-totem-menu').dataset.layout).toBe('comfortable');
    expect(screen.getByRole('button', { name: 'Ver sacola com 2 itens' })).toBeTruthy();
  });

  it('encaminha adicionar, abrir produto do Outdoor, sacola e voltar aos handlers existentes', async () => {
    const p = props(); const original = p.products[0];
    mocks.slides.mockResolvedValue([slide()]);
    render(<DineInTotemMenu {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Experimente o suco' }));
    expect(p.onOpenProduct).toHaveBeenCalledExactlyOnceWith(original);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
    expect(p.onAddProduct).toHaveBeenCalledExactlyOnceWith(original);
    fireEvent.click(screen.getByRole('button', { name: 'Ver sacola com 2 itens' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(p.onOpenCart).toHaveBeenCalledOnce(); expect(p.onBack).toHaveBeenCalledOnce();
  });

  it('mantém a rotação do Outdoor durante atualizações da sacola e da conta', async () => {
    vi.useFakeTimers();
    try {
      const p = props();
      mocks.slides.mockResolvedValue([slide(), slide({ id: 'banner-b', title: 'Outra novidade' })]);
      const view = render(<DineInTotemMenu {...p} />); await flush();
      expect(screen.getByTestId('outdoor-active-slide').getAttribute('aria-label')).toBe('Experimente o suco');
      act(() => vi.advanceTimersByTime(3000));
      view.rerender(<DineInTotemMenu {...p} cartCount={3} />);
      act(() => vi.advanceTimersByTime(2600));
      expect(screen.getByTestId('outdoor-active-slide').getAttribute('aria-label')).toBe('Outra novidade');
    } finally { vi.useRealTimers(); }
  });

  it('mantém grupos de opções no produto original encaminhado ao fluxo de personalização', async () => {
    const p = props();
    const configured = product({ optionGroups: [{ id: 'milk', tenantId: 'store-a', name: 'Leite', active: true,
      minSelect: 1, maxSelect: 1, type: 'STANDARD', pricingRule: 'SUM', allowRepeat: false, sort: 0, options: [] }] });
    p.products = [configured];
    render(<DineInTotemMenu {...p} />); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
    expect(p.onAddProduct).toHaveBeenCalledExactlyOnceWith(configured);
    expect((p.onAddProduct as ReturnType<typeof vi.fn>).mock.calls[0][0].optionGroups).toBe(configured.optionGroups);
  });

  it('oferece Destaques para produtos sem categoria sem reescrever o produto da sacola', async () => {
    const p = props(); const original = product({ categoryId: '' }); p.categories = []; p.products = [original];
    render(<DineInTotemMenu {...p} />); await flush();
    expect(screen.getByRole('tab', { name: 'Destaques' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
    expect(p.onAddProduct).toHaveBeenCalledExactlyOnceWith(original);
    expect(original.categoryId).toBe('');
  });

  it('exclui categorias e produtos inativos, indisponíveis e de outra loja', async () => {
    const p = props();
    p.categories = [category(), category({ id: 'closed', name: 'Categoria fechada', isActive: false }), category({ id: 'foreign', tenantId: 'store-b', name: 'Outra loja' })];
    p.products = [product(), product({ id: 'off', name: 'Inativo', isActive: false }), product({ id: 'sold', name: 'Esgotado', isAvailable: false }),
      product({ id: 'hidden-category', categoryId: 'closed', name: 'Oculto na categoria' }), product({ id: 'unknown-category', categoryId: 'unknown', name: 'Categoria desconhecida' }),
      product({ id: 'foreign-product', tenantId: 'store-b', name: 'Produto de outra loja' }), product({ id: 'foreign-category', categoryId: 'foreign', name: 'Categoria de outra loja' })];
    render(<DineInTotemMenu {...p} />); await flush();
    expect(screen.getByRole('button', { name: 'Adicionar Suco da casa' })).toBeTruthy();
    for (const name of ['Inativo', 'Esgotado', 'Oculto na categoria', 'Categoria desconhecida', 'Produto de outra loja', 'Categoria de outra loja']) expect(screen.queryByText(name)).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Destaques' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Outra loja' })).toBeNull();
  });

  it('não bloqueia o catálogo quando falha o Outdoor e permite tentar novamente', async () => {
    const p = props(); mocks.slides.mockRejectedValueOnce(new Error('sem conexão')).mockResolvedValueOnce([slide()]);
    render(<DineInTotemMenu {...p} />);
    const retry = await screen.findByRole('button', { name: 'Tentar carregar destaques novamente' });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' })); expect(p.onAddProduct).toHaveBeenCalledOnce();
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Experimente o suco' })).toBeTruthy();
    expect(mocks.slides).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Tentar carregar destaques novamente' })).toBeNull();
  });

  it('descarta retorno antigo ao trocar a loja resolvida', async () => {
    const old = deferred<PublicMenuOutdoorSlide[]>(); const next = deferred<PublicMenuOutdoorSlide[]>();
    mocks.slides.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const p = props(); const view = render(<DineInTotemMenu {...p} />);
    view.rerender(<DineInTotemMenu {...p} storeSlug="loja-b" />);
    await act(async () => next.resolve([slide({ id: 'banner-b', title: 'Destaque da loja B', imageUrl: '/banner-b.jpg' })]));
    expect(screen.getByRole('button', { name: 'Destaque da loja B' })).toBeTruthy();
    await act(async () => old.resolve([slide({ title: 'Banner antigo da loja A' })]));
    expect(screen.queryByRole('button', { name: 'Banner antigo da loja A' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Destaque da loja B' })).toBeTruthy();
    expect(mocks.slides.mock.calls.map(call => call[0])).toEqual(['loja-a', 'loja-b']);
  });

  it('remove imediatamente os banners já carregados quando muda o slug', async () => {
    const waiting = deferred<PublicMenuOutdoorSlide[]>();
    mocks.slides.mockResolvedValueOnce([slide()]).mockReturnValueOnce(waiting.promise);
    const p = props(); const view = render(<DineInTotemMenu {...p} />);
    await screen.findByRole('button', { name: 'Experimente o suco' });
    view.rerender(<DineInTotemMenu {...p} storeSlug="loja-b" />);
    expect(screen.queryByRole('button', { name: 'Experimente o suco' })).toBeNull();
    await act(async () => waiting.resolve([]));
  });

  it('bloqueia Adicionar enquanto a conta não aceita pedidos e mantém sacola e retorno disponíveis', async () => {
    const p = props(); const view = render(<DineInTotemMenu {...p} orderingDisabled />); await flush();
    const add = screen.getByRole('button', { name: 'Adicionar Suco da casa' });
    expect(add.hasAttribute('disabled')).toBe(true); expect(add.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(add); fireEvent.click(screen.getByTestId('product-card-juice'));
    expect(p.onAddProduct).not.toHaveBeenCalled(); expect(p.onOpenProduct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ver sacola com 2 itens' })); fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(p.onOpenCart).toHaveBeenCalledOnce(); expect(p.onBack).toHaveBeenCalledOnce();
    view.rerender(<DineInTotemMenu {...p} orderingDisabled={false} />);
    expect(add.hasAttribute('disabled')).toBe(false);
    fireEvent.click(add); expect(p.onAddProduct).toHaveBeenCalledExactlyOnceWith(p.products[0]);
  });

  it('bloqueia novos itens durante o envio sem anunciar que a conta está indisponível', async () => {
    const p = props(); const view = render(<DineInTotemMenu {...p} busy />); await flush();
    const add = screen.getByRole('button', { name: 'Adicionar Suco da casa' });
    expect(add.hasAttribute('disabled')).toBe(true);
    fireEvent.click(add); fireEvent.click(screen.getByTestId('product-card-juice'));
    expect(p.onAddProduct).not.toHaveBeenCalled(); expect(p.onOpenProduct).not.toHaveBeenCalled();
    expect(screen.queryByText(/Pedidos indisponíveis no momento/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver sacola com 2 itens' }));
    expect(p.onOpenCart).toHaveBeenCalledOnce();
    view.rerender(<DineInTotemMenu {...p} busy={false} />);
    expect(add.hasAttribute('disabled')).toBe(false);
    fireEvent.click(add); expect(p.onAddProduct).toHaveBeenCalledOnce();
  });

  it('usa padrão seguro para tema ausente e aplica densidade compacta sem alterar o tema do app', async () => {
    const p = props(); const view = render(<DineInTotemMenu {...p} menuTheme={undefined} />); await flush();
    expect(screen.getByTestId('totem-menu-view').style.getPropertyValue('--totem-bg')).toBe(DEFAULT_MENU_THEME.background);
    const custom = { ...DEFAULT_MENU_THEME, layout: 'compact' as const, radius: 8 };
    view.rerender(<DineInTotemMenu {...p} menuTheme={custom} />);
    expect(screen.getByTestId('dinein-totem-menu').dataset.layout).toBe('compact');
    expect(screen.getByTestId('totem-menu-view').style.getPropertyValue('--totem-radius')).toBe('8px');
    expect(document.documentElement.style.getPropertyValue('--totem-bg')).toBe('');
    expect(custom).toEqual({ ...DEFAULT_MENU_THEME, layout: 'compact', radius: 8 });
  });

  it('aceita o carregamento atual no replay de efeitos do StrictMode', async () => {
    const first = deferred<PublicMenuOutdoorSlide[]>(); const current = deferred<PublicMenuOutdoorSlide[]>();
    mocks.slides.mockReturnValueOnce(first.promise).mockReturnValueOnce(current.promise);
    render(<React.StrictMode><DineInTotemMenu {...props()} /></React.StrictMode>);
    await waitFor(() => expect(mocks.slides).toHaveBeenCalledTimes(2));
    await act(async () => current.resolve([slide({ title: 'Destaque atual' })]));
    expect(screen.getByRole('button', { name: 'Destaque atual' })).toBeTruthy();
    await act(async () => first.resolve([slide({ title: 'Destaque descartado' })]));
    expect(screen.queryByRole('button', { name: 'Destaque descartado' })).toBeNull();
  });

  it('ignora falha tardia de outra loja sem apagar os destaques atuais', async () => {
    const old = deferred<PublicMenuOutdoorSlide[]>();
    mocks.slides.mockReturnValueOnce(old.promise).mockResolvedValueOnce([slide({ title: 'Destaque atual da loja B' })]);
    const p = props(); const view = render(<DineInTotemMenu {...p} />);
    view.rerender(<DineInTotemMenu {...p} storeSlug="loja-b" />);
    await screen.findByRole('button', { name: 'Destaque atual da loja B' });
    await act(async () => old.reject(new Error('Falha da loja anterior')));
    expect(screen.getByRole('button', { name: 'Destaque atual da loja B' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar carregar destaques novamente' })).toBeNull();
  });

  it('abre o produto do Outdoor por Enter e espaço sem depender de toque', async () => {
    const p = props(); mocks.slides.mockResolvedValue([slide()]);
    render(<DineInTotemMenu {...p} />);
    const banner = await screen.findByRole('button', { name: 'Experimente o suco' });
    banner.focus();
    fireEvent.keyDown(banner, { key: 'Enter' });
    fireEvent.keyDown(banner, { key: ' ' });
    expect(p.onOpenProduct).toHaveBeenCalledTimes(2);
    expect(p.onOpenProduct).toHaveBeenLastCalledWith(p.products[0]);
    fireEvent.keyDown(banner, { key: 'Enter', repeat: true });
    expect(p.onOpenProduct).toHaveBeenCalledTimes(2);
  });

  it('exibe o banner sem link quando o produto vinculado deixou de estar disponível', async () => {
    const p = props(); p.products = [product(), product({ id: 'sold', name: 'Produto esgotado', isAvailable: false })];
    mocks.slides.mockResolvedValue([slide({ productId: 'sold' })]);
    render(<DineInTotemMenu {...p} />);
    const banner = await screen.findByTestId('outdoor-active-slide');
    expect(banner.getAttribute('role')).toBeNull(); expect(banner.getAttribute('tabindex')).toBeNull();
    fireEvent.click(banner); expect(p.onOpenProduct).not.toHaveBeenCalled();
    expect(screen.queryByText('Produto esgotado')).toBeNull();
  });

  it('preserva a promoção exibida e o preço no produto encaminhado à sacola', async () => {
    const p = props(); const promoted = product({ promotionalPrice: 9 }); p.products = [promoted];
    render(<DineInTotemMenu {...p} />); await flush();
    expect(screen.getByText('R$ 9,00')).toBeTruthy();
    expect(screen.getByText('R$ 12,00').tagName).toBe('DEL');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Suco da casa' }));
    expect(p.onAddProduct).toHaveBeenCalledExactlyOnceWith(promoted);
    expect(promoted.price).toBe(12); expect(promoted.promotionalPrice).toBe(9);
  });
});
