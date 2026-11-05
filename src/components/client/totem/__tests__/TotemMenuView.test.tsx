// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import TotemMenuView, { DEFAULT_TOTEM_THEME, type TotemOutdoorSlide } from '../TotemMenuView';
import type { Category, Product } from '../../../../types';

afterEach(cleanup);

describe('TotemMenuView', () => {
  const mockCategories: Category[] = [
    {
      id: 'cat-drinks',
      tenantId: 'tenant-1',
      name: 'Bebidas Geladas',
      order: 2,
      isActive: true,
    },
    {
      id: 'cat-burgers',
      tenantId: 'tenant-1',
      name: 'Hambúrgueres Artesanais',
      order: 1,
      isActive: true,
    },
    {
      id: 'cat-empty',
      tenantId: 'tenant-1',
      name: 'Sobremesas Vazias',
      order: 3,
      isActive: true,
    },
    {
      id: 'cat-inactive',
      tenantId: 'tenant-1',
      name: 'Categoria Desativada',
      order: 0,
      isActive: false,
    },
  ];

  const mockProducts: Product[] = [
    {
      id: 'prod-burger-1',
      tenantId: 'tenant-1',
      categoryId: 'cat-burgers',
      name: 'X-Burger Supremo',
      description: 'Blend 180g, queijo cheddar e bacon artesanal',
      price: 38.0,
      promotionalPrice: 29.9,
      imageUrl: 'https://images.example.com/burger.jpg',
      isAvailable: true,
      isActive: true,
      stockQuantity: 10,
      unit: 'un',
    },
    {
      id: 'prod-burger-unavailable',
      tenantId: 'tenant-1',
      categoryId: 'cat-burgers',
      name: 'Burger Esgotado',
      description: 'Não deve aparecer',
      price: 45.0,
      imageUrl: '',
      isAvailable: false,
      isActive: true,
      stockQuantity: 0,
      unit: 'un',
    },
    {
      id: 'prod-drink-1',
      tenantId: 'tenant-1',
      categoryId: 'cat-drinks',
      name: 'Suco Natural de Laranja',
      description: '500ml sem açúcar',
      price: 12.5,
      imageUrl: '',
      isAvailable: true,
      isActive: true,
      stockQuantity: 20,
      unit: 'un',
    },
  ];

  const mockSlides: TotemOutdoorSlide[] = [
    {
      id: 'slide-1',
      imageUrl: 'https://images.example.com/banner1.jpg',
      title: 'Festival de Burgers!',
      productId: 'prod-burger-1',
    },
  ];

  it('renders categories in left column sorted by order, hiding empty/inactive ones', () => {
    render(
      <TotemMenuView
        storeName="Hamburgueria do Chefe"
        categories={mockCategories}
        products={mockProducts}
        outdoorSlides={mockSlides}
        theme={DEFAULT_TOTEM_THEME}
        cartCount={0}
        onAddProduct={vi.fn()}
        onOpenCart={vi.fn()}
      />
    );

    const sidebar = screen.getByTestId('totem-categories-sidebar');
    const categoryButtons = sidebar.querySelectorAll('button[role="tab"]');

    // Should only render cat-burgers (order 1) and cat-drinks (order 2)
    // cat-empty has no available products -> hidden
    // cat-inactive is isActive: false -> hidden
    expect(categoryButtons).toHaveLength(2);
    expect(categoryButtons[0].textContent).toContain('Hambúrgueres Artesanais');
    expect(categoryButtons[1].textContent).toContain('Bebidas Geladas');

    expect(screen.queryByText('Sobremesas Vazias')).toBeNull();
    expect(screen.queryByText('Categoria Desativada')).toBeNull();
  });

  it('clicking a category marks it active', () => {
    render(
      <TotemMenuView
        storeName="Hamburgueria do Chefe"
        categories={mockCategories}
        products={mockProducts}
        outdoorSlides={mockSlides}
        theme={{
          ...DEFAULT_TOTEM_THEME,
          categoryActiveBg: '#ff0055',
        }}
        cartCount={2}
        onAddProduct={vi.fn()}
        onOpenCart={vi.fn()}
      />
    );

    const burgerBtn = screen.getByTestId('category-btn-cat-burgers');
    const drinksBtn = screen.getByTestId('category-btn-cat-drinks');

    // Initially first category is active
    expect(burgerBtn.getAttribute('aria-selected')).toBe('true');
    expect(drinksBtn.getAttribute('aria-selected')).toBe('false');

    // Click on drinks
    fireEvent.click(drinksBtn);

    expect(burgerBtn.getAttribute('aria-selected')).toBe('false');
    expect(drinksBtn.getAttribute('aria-selected')).toBe('true');
    expect(['#ff0055', 'rgb(255, 0, 85)']).toContain(drinksBtn.style.backgroundColor);
  });

  it('"Adicionar" calls onAddProduct with the product', () => {
    const handleAddProduct = vi.fn();

    render(
      <TotemMenuView
        storeName="Hamburgueria do Chefe"
        categories={mockCategories}
        products={mockProducts}
        outdoorSlides={mockSlides}
        theme={DEFAULT_TOTEM_THEME}
        cartCount={0}
        onAddProduct={handleAddProduct}
        onOpenCart={vi.fn()}
      />
    );

    const addBtn = screen.getByTestId('add-product-prod-burger-1');
    fireEvent.click(addBtn);

    expect(handleAddProduct).toHaveBeenCalledTimes(1);
    expect(handleAddProduct).toHaveBeenCalledWith(mockProducts[0]);
  });

  it('cart badge shows cartCount and calls onOpenCart', () => {
    const handleOpenCart = vi.fn();

    render(
      <TotemMenuView
        storeName="Hamburgueria do Chefe"
        categories={mockCategories}
        products={mockProducts}
        outdoorSlides={mockSlides}
        theme={DEFAULT_TOTEM_THEME}
        cartCount={5}
        onAddProduct={vi.fn()}
        onOpenCart={handleOpenCart}
      />
    );

    const badge = screen.getByTestId('totem-cart-badge');
    expect(badge.textContent).toBe('5');

    const cartBtn = screen.getByTestId('totem-cart-button');
    fireEvent.click(cartBtn);

    expect(handleOpenCart).toHaveBeenCalledTimes(1);
  });

  it('promotional price shows old price struck', () => {
    render(
      <TotemMenuView
        storeName="Hamburgueria do Chefe"
        categories={mockCategories}
        products={mockProducts}
        outdoorSlides={mockSlides}
        theme={DEFAULT_TOTEM_THEME}
        cartCount={0}
        onAddProduct={vi.fn()}
        onOpenCart={vi.fn()}
      />
    );

    // X-Burger Supremo has regular price 38.00 and promotional 29.90
    expect(screen.getByText('R$ 29,90')).toBeTruthy();
    const oldPriceEl = screen.getByText('R$ 38,00');
    expect(oldPriceEl.tagName.toLowerCase()).toBe('del');
    expect(oldPriceEl.className).toContain('line-through');

    // Suco Natural de Laranja has only regular price 12.50
    expect(screen.getByText('R$ 12,50')).toBeTruthy();
  });

  it('outdoor area hidden when outdoorSlides is empty', () => {
    render(
      <TotemMenuView
        storeName="Hamburgueria do Chefe"
        categories={mockCategories}
        products={mockProducts}
        outdoorSlides={[]}
        theme={DEFAULT_TOTEM_THEME}
        cartCount={0}
        onAddProduct={vi.fn()}
        onOpenCart={vi.fn()}
      />
    );

    expect(screen.queryByTestId('totem-outdoor-area')).toBeNull();
  });

  it('clicking an outdoor slide with productId calls onOpenProduct', () => {
    const handleOpenProduct = vi.fn();

    render(
      <TotemMenuView
        storeName="Hamburgueria do Chefe"
        categories={mockCategories}
        products={mockProducts}
        outdoorSlides={mockSlides}
        theme={DEFAULT_TOTEM_THEME}
        cartCount={0}
        onAddProduct={vi.fn()}
        onOpenProduct={handleOpenProduct}
        onOpenCart={vi.fn()}
      />
    );

    const slide = screen.getByTestId('outdoor-active-slide');
    fireEvent.click(slide);

    expect(handleOpenProduct).toHaveBeenCalledTimes(1);
    expect(handleOpenProduct).toHaveBeenCalledWith(mockProducts[0]);
  });

  it('renders back button and triggers onBack when provided', () => {
    const handleBack = vi.fn();

    const { rerender } = render(
      <TotemMenuView
        storeName="Hamburgueria do Chefe"
        categories={mockCategories}
        products={mockProducts}
        outdoorSlides={mockSlides}
        theme={DEFAULT_TOTEM_THEME}
        cartCount={0}
        onAddProduct={vi.fn()}
        onOpenCart={vi.fn()}
        onBack={handleBack}
      />
    );

    const backBtn = screen.getByTestId('totem-back-button');
    fireEvent.click(backBtn);
    expect(handleBack).toHaveBeenCalledTimes(1);

    // Omit onBack
    rerender(
      <TotemMenuView
        storeName="Hamburgueria do Chefe"
        categories={mockCategories}
        products={mockProducts}
        outdoorSlides={mockSlides}
        theme={DEFAULT_TOTEM_THEME}
        cartCount={0}
        onAddProduct={vi.fn()}
        onOpenCart={vi.fn()}
      />
    );
    expect(screen.queryByTestId('totem-back-button')).toBeNull();
  });

  it('displays elegant placeholder for products without image', () => {
    render(
      <TotemMenuView
        storeName="Hamburgueria do Chefe"
        categories={mockCategories}
        products={mockProducts}
        outdoorSlides={mockSlides}
        theme={DEFAULT_TOTEM_THEME}
        cartCount={0}
        onAddProduct={vi.fn()}
        onOpenCart={vi.fn()}
      />
    );

    const placeholders = screen.getAllByTestId('product-image-placeholder');
    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders[0].textContent).toContain('Suco Natural de Laranja');
  });
  const renderSlides = (slides: TotemOutdoorSlide[]) => render(
    <TotemMenuView storeName="Loja" categories={mockCategories} products={mockProducts} outdoorSlides={slides}
      theme={DEFAULT_TOTEM_THEME} cartCount={0} onAddProduct={vi.fn()} onOpenCart={vi.fn()} />);

  it('renderiza banner do YouTube só como embed nocookie mudo', () => {
    renderSlides([{ id: 'yt', youtubeId: 'dQw4w9WgXcQ', title: 'Promo' }]);
    const frame = screen.getByTestId('outdoor-youtube');
    expect(frame.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&loop=1&playlist=dQw4w9WgXcQ&controls=0&playsinline=1');
  });
  it('não renderiza iframe para id de YouTube adulterado', () => {
    renderSlides([{ id: 'yt', youtubeId: '"><script>' }]);
    expect(screen.queryByTestId('outdoor-youtube')).toBeNull();
  });
  it('vídeo enviado toca até o fim antes de avançar (não corta em 5,5 s)', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderSlides([{ id: 'v', videoUrl: 'https://media.example/a.mp4', title: 'Vídeo longo' }, { id: 'i', imageUrl: 'https://media.example/b.webp', title: 'Foto' }]);
      act(() => { vi.advanceTimersByTime(60000); });
      const video = container.querySelector('video')!;
      expect(video).toBeTruthy(); expect(video.loop).toBe(false);
      act(() => { fireEvent.ended(video); });
      expect(container.querySelector('video')).toBeNull();
      expect(screen.getByAltText('Foto')).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });
});

