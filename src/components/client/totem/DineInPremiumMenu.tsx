
/**
 * DELIVERY CHANNEL
 * CARDÁPIO PREMIUM — TOTEM / TABLET
 *
 * Layout prioritário: 1024x768, 1280x800,
 * 1920x1080 e tablets horizontais.
 *
 * NÃO é o aplicativo de delivery do celular.
 *
 * Este componente:
 * - Não cria pedidos diretamente.
 * - Não consulta dados financeiros.
 * - Não muda a mesa diretamente.
 * - Não realiza pagamentos.
 * - Não altera autenticação.
 *
 * As operações são recebidas por callbacks
 * da aplicação atual.
 */

import React, {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';

import {
  Beer,
  Wine,
  Martini,
  UtensilsCrossed,
  Coffee,
  Pizza,
  Sandwich,
  CakeSlice,
  ShoppingBasket,
  ShoppingCart,
  House,
  Armchair,
  ReceiptText,
  Menu,
  Plus,
  Store,
} from 'lucide-react';

import type {
  Category,
  Product,
} from '../../../types';

import type {
  MenuTheme,
} from '../../../types/menuTheme';

import type {
  StoreHomeDesign,
} from '../../../lib/storeHome/storeHome.model';

import {
  buildMenuCatalog,
  productsForCategory,
  initialMenuCategory,
  resolveMenuVisualTheme,
  formatMenuMoney,
  safeMenuImageUrl,
  type CategoryIcon,
} from '../../../lib/menu/premiumTotem.model';

import './dineInPremiumMenu.css';
import { MenuOutdoorCarousel } from './MenuOutdoorCarousel';
import type { PublicMenuOutdoorSlide } from '../../../repositories/menuOutdoorRepository';

// ============================================
// TIPAGEM
// ============================================

export interface DineInPremiumMenuProps {
  /** Tenant resolvido pelo QR/servidor. */
  tenantId: string;

  storeName: string;
  storeLogoUrl?: string | null;
  storeTagline?: string;

  tableLabel?: string;

  categories: Category[];
  products: Product[];

  menuTheme?: MenuTheme;
  homeDesign?: StoreHomeDesign;

  cartCount: number;

  orderingDisabled: boolean;
  busy?: boolean;
  tableControls?: React.ReactNode;
  productColumns?: 1 | 2 | 3;
  outdoorSlides?: PublicMenuOutdoorSlide[];

  /** Navegação controlada pelo app existente. */
  onGoHome: () => void;
  onOpenCart: () => void;
  onOpenTable: () => void;
  onOpenExpenses: () => void;

  /** Opcional: menu de ações do totem. */
  onOpenKioskMenu?: () => void;

  /**
   * Callback existente de pedido.
   * Não chamar Supabase diretamente aqui.
   */
  onAddProduct: (product: Product) => void;

  /**
   * Abre o detalhamento e adicionais.
   */
  onOpenProduct: (product: Product) => void;
}

// ============================================
// ÍCONES DAS CATEGORIAS
// ============================================

const CATEGORY_ICONS = {
  beer: Beer,
  wine: Wine,
  martini: Martini,
  utensils: UtensilsCrossed,
  coffee: Coffee,
  pizza: Pizza,
  sandwich: Sandwich,
  dessert: CakeSlice,
  'shopping-basket': ShoppingBasket,
} satisfies Record<
  CategoryIcon,
  React.ComponentType<{
    size?: number;
    className?: string;
    'aria-hidden'?: boolean;
  }>
>;

// ============================================
// IMAGENS COM FALLBACK
// ============================================

interface SafeImageProps {
  src: string | null | undefined;
  alt: string;
  className: string;
  fallback: React.ReactNode;
}

function SafeImage({
  src,
  alt,
  className,
  fallback,
}: SafeImageProps) {
  const safeUrl = safeMenuImageUrl(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [safeUrl]);

  if (!safeUrl || failed) {
    return (
      <div
        className={`${className} dc-kiosk-image-fallback`}
        aria-label={alt}
        role="img"
      >
        {fallback}
      </div>
    );
  }

  return (
    <img
      src={safeUrl}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

// ============================================
// NAVEGAÇÃO INFERIOR
// ============================================

interface BottomNavigationProps {
  cartCount: number;
  onGoHome: () => void;
  onOpenCart: () => void;
  onOpenTable: () => void;
  onOpenExpenses: () => void;
}

function BottomNavigation({
  cartCount,
  onGoHome,
  onOpenCart,
  onOpenTable,
  onOpenExpenses,
}: BottomNavigationProps) {
  const items = [
    {
      id: 'home',
      label: 'Início',
      icon: House,
      onClick: onGoHome,
    },
    {
      id: 'cart',
      label: 'Carrinho',
      icon: ShoppingCart,
      onClick: onOpenCart,
    },
    {
      id: 'table',
      label: 'Mesa',
      icon: Armchair,
      onClick: onOpenTable,
    },
    {
      id: 'expenses',
      label: 'Meus gastos',
      icon: ReceiptText,
      onClick: onOpenExpenses,
    },
  ];

  return (
    <nav
      className="dc-kiosk-bottom-nav"
      aria-label="Navegação do totem"
    >
      {items.map(item => {
        const Icon = item.icon;

        return (
          <button
            key={item.id}
            type="button"
            className="dc-kiosk-nav-item"
            onClick={item.onClick}
            data-testid={`kiosk-nav-${item.id}`}
          >
            <span className="dc-kiosk-nav-icon">
              <Icon
                size={30}
                aria-hidden={true}
              />

              {item.id === 'cart' &&
                cartCount > 0 && (
                  <span
                    className="dc-kiosk-cart-count"
                    aria-label={`${cartCount} itens`}
                  >
                    {cartCount > 99
                      ? '99+'
                      : cartCount}
                  </span>
                )}
            </span>

            <span className="dc-kiosk-nav-label">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// ============================================
// COMPONENTE PRINCIPAL DO TOTEM
// ============================================

export function DineInPremiumMenu({
  tenantId,
  storeName,
  storeLogoUrl,
  storeTagline,
  tableLabel,

  categories,
  products,

  menuTheme,
  homeDesign,

  cartCount,
  orderingDisabled,
  busy = false,
  tableControls,
  productColumns = 3,
  outdoorSlides = [],

  onGoHome,
  onOpenCart,
  onOpenTable,
  onOpenExpenses,
  onOpenKioskMenu,

  onAddProduct,
  onOpenProduct,
}: DineInPremiumMenuProps) {
  // Catálogo filtrado por estabelecimento.
  const catalog = useMemo(
    () => buildMenuCatalog(
      tenantId,
      categories,
      products,
    ),
    [tenantId, categories, products],
  );

  const theme = useMemo(
    () => resolveMenuVisualTheme(
      menuTheme,
      homeDesign,
    ),
    [menuTheme, homeDesign],
  );

  const firstCategory =
    initialMenuCategory(catalog);

  const [selectedCategoryId, setSelectedCategoryId] =
    useState('');

  // Seleção inicial e troca de estabelecimento.
  useEffect(() => {
    setSelectedCategoryId(current => {
      const exists = catalog.categories.some(
        item => item.id === current,
      );

      return exists
        ? current
        : firstCategory;
    });
  }, [catalog.categories, firstCategory]);

  const activeCategoryId =
    catalog.categories.some(
      item => item.id === selectedCategoryId,
    )
      ? selectedCategoryId
      : firstCategory;

  const activeCategory = catalog.categories.find(
    item => item.id === activeCategoryId,
  );

  const categoryProducts = useMemo(
    () => productsForCategory(
      catalog,
      activeCategoryId,
    ),
    [catalog, activeCategoryId],
  );

  // Somente produtos realmente recebidos da loja.
  const originalProducts = useMemo(
    () => new Map(
      products
        .filter(product =>
          product.tenantId === tenantId &&
          product.isActive !== false &&
          product.isAvailable !== false,
        )
        .map(product => [
          product.id,
          product,
        ]),
    ),
    [products, tenantId],
  );

  // O botão "Adicionar" não poderá contornar
  // as verificações do aplicativo principal.
  const mayOrder =
    !orderingDisabled && !busy;

  function handleAdd(productId: string) {
    if (!mayOrder) return;

    const product = originalProducts.get(
      productId,
    );

    if (!product) return;

    const hasOptions = product.optionGroups?.some(
      group => group.active,
    );

    if (hasOptions) {
      onOpenProduct(product);
      return;
    }

    onAddProduct(product);
  }

  function handleProductDetails(productId: string) {
    if (busy) return;

    const product = originalProducts.get(
      productId,
    );

    if (product) {
      onOpenProduct(product);
    }
  }

  const safeCartCount = Math.max(
    0,
    Math.trunc(Number(cartCount) || 0),
  );

  // Todas as cores vêm de configurações
  // normalizadas do Design do Cardápio.
  const rootStyle = {
    '--dc-kiosk-bg': theme.background,
    '--dc-kiosk-surface': theme.surface,
    '--dc-kiosk-text': theme.text,
    '--dc-kiosk-accent': theme.accent,
    '--dc-kiosk-accent-text': theme.accentText,
    '--dc-kiosk-category-active':
      theme.categoryActiveBg,
    '--dc-kiosk-radius':
      `${theme.radius}px`,
    '--dc-kiosk-header-gradient':
      theme.headerGradient,
    fontFamily: theme.fontFamily,
  } as CSSProperties;

  return (
    <div
      className="dc-kiosk"
      data-testid="dinein-premium-kiosk"
      data-tenant-id={tenantId}
      data-layout={theme.layout}
      style={rootStyle}
    >
      {/* =================================
          CABEÇALHO PREMIUM
      ================================= */}

      <header className="dc-kiosk-header">
        <div className="dc-kiosk-brand">
          <SafeImage
            src={storeLogoUrl}
            alt={`Logo de ${storeName}`}
            className="dc-kiosk-brand-logo"
            fallback={
              <Store
                size={40}
                aria-hidden={true}
              />
            }
          />

          <div className="dc-kiosk-brand-copy">
            <h1 className="dc-kiosk-store-name">
              {storeName}
            </h1>

            <p className="dc-kiosk-store-tagline">
              {storeTagline ||
                'Bem-vindo ao nosso cardápio'}
            </p>
          </div>
        </div>

        <div className="dc-kiosk-header-actions">
          {tableLabel && (
            <button
              type="button"
              className="dc-kiosk-table-selector"
              onClick={onOpenTable}
              aria-label={`Informações da ${tableLabel}`}
            >
              <Armchair
                size={27}
                aria-hidden={true}
              />

              <span>{tableLabel}</span>
            </button>
          )}

          {onOpenKioskMenu && (
            <button
              type="button"
              className="dc-kiosk-menu-button"
              aria-label="Abrir opções do totem"
              onClick={onOpenKioskMenu}
            >
              <Menu
                size={30}
                aria-hidden={true}
              />
            </button>
          )}
        </div>
      </header>

      {/* =================================
          CONTEÚDO PRINCIPAL
      ================================= */}

      <div className="dc-kiosk-main">
        {/* MENU LATERAL DE CATEGORIAS */}

        <aside
          className="dc-kiosk-sidebar"
          aria-label="Categorias do cardápio"
        >
          <div className="dc-kiosk-category-list">
            {catalog.categories.map(category => {
              const isSelected =
                category.id === activeCategoryId;

              return (
                <button
                  key={category.id}
                  type="button"
                  className={[
                    'dc-kiosk-category',
                    isSelected
                      ? 'dc-kiosk-category--active'
                      : '',
                  ].join(' ')}
                  aria-current={
                    isSelected ? 'true' : undefined
                  }
                  onClick={() =>
                    setSelectedCategoryId(
                      category.id,
                    )
                  }
                >
                  {safeMenuImageUrl(category.imageUrl) ? (
                    <SafeImage
                      src={category.imageUrl}
                      alt={category.name}
                      className="dc-kiosk-category-photo"
                      fallback={<span className="dc-kiosk-category-label">{category.name}</span>}
                    />
                  ) : (
                    <span className="dc-kiosk-category-label">{category.name}</span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* =================================
            PRODUTOS DA CATEGORIA
        ================================= */}

        <main
          className="dc-kiosk-products-area"
          aria-label="Produtos do cardápio"
        >
          {tableControls}
          <MenuOutdoorCarousel slides={outdoorSlides} onOpenProduct={id => handleProductDetails(id)} />
          <div className="dc-kiosk-category-heading">
            <div className="dc-kiosk-category-title-row">
              {activeCategory && (() => {
                const Icon =
                  CATEGORY_ICONS[activeCategory.icon];

                return (
                  <Icon
                    size={44}
                    className="dc-kiosk-heading-icon"
                    aria-hidden={true}
                  />
                );
              })()}

              <div>
                <h2 className="dc-kiosk-category-title">
                  {activeCategory?.name ||
                    'Nosso cardápio'}
                </h2>

                <p className="dc-kiosk-category-subtitle">
                  {activeCategory
                    ? `${activeCategory.productCount} produtos disponíveis`
                    : 'Escolha uma categoria'}
                </p>
              </div>
            </div>

            <div
              className="dc-kiosk-title-decoration"
              aria-hidden={true}
            />
          </div>

          {categoryProducts.length > 0 ? (
            <div
              className="dc-kiosk-products-grid"
              data-testid="kiosk-products-grid"
              style={{ gridTemplateColumns: `repeat(${productColumns}, minmax(0, 1fr))` }}
            >
              {categoryProducts.map(product => {
                const original =
                  originalProducts.get(product.id);

                const hasOptions =
                  original?.optionGroups?.some(
                    group => group.active,
                  ) ?? false;

                return (
                  <article
                    key={product.id}
                    className="dc-kiosk-product-card"
                    data-testid={`kiosk-product-${product.id}`}
                  >
                    <button
                      type="button"
                      className="dc-kiosk-product-photo-button"
                      onClick={() =>
                        handleProductDetails(
                          product.id,
                        )
                      }
                      aria-label={`Ver detalhes de ${product.name}`}
                    >
                      <SafeImage
                        src={product.imageUrl}
                        alt={product.name}
                        className="dc-kiosk-product-photo"
                        fallback={
                          <UtensilsCrossed
                            size={52}
                            aria-hidden={true}
                          />
                        }
                      />
                    </button>

                    <div className="dc-kiosk-product-info">
                      <h3 className="dc-kiosk-product-name">
                        {product.name}
                      </h3>

                      <p className="dc-kiosk-product-description">
                        {product.description ||
                          'Confira este produto da casa.'}
                      </p>

                      <div className="dc-kiosk-product-bottom">
                        {product.isPromotional &&
                          product.promotionalPriceCents !== null && (
                            <span className="dc-kiosk-original-price">
                              {formatMenuMoney(
                                product.priceCents,
                              )}
                            </span>
                          )}

                        <strong className="dc-kiosk-product-price">
                          {formatMenuMoney(
                            product.displayPriceCents,
                          )}
                        </strong>

                        <button
                          type="button"
                          className="dc-kiosk-add-button"
                          disabled={
                            !mayOrder || !original
                          }
                          onClick={() =>
                            handleAdd(product.id)
                          }
                          aria-label={`Adicionar ${product.name}`}
                          data-testid={`kiosk-add-${product.id}`}
                        >
                          <Plus
                            size={24}
                            aria-hidden={true}
                          />

                          <span>
                            {hasOptions
                              ? 'Escolher opções'
                              : 'Adicionar'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div
              className="dc-kiosk-empty"
              role="status"
            >
              <UtensilsCrossed
                size={52}
                aria-hidden={true}
              />

              <h3>Sem produtos nesta categoria</h3>

              <p>
                Escolha outra categoria do cardápio.
              </p>
            </div>
          )}
        </main>
      </div>

      {/* =================================
          MENU INFERIOR FIXO
      ================================= */}

      <BottomNavigation
        cartCount={safeCartCount}
        onGoHome={onGoHome}
        onOpenCart={onOpenCart}
        onOpenTable={onOpenTable}
        onOpenExpenses={onOpenExpenses}
      />
    </div>
  );
}

export default DineInPremiumMenu;
