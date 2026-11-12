
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
import { totemDesignCssVars, type TotemDesign } from '../../../lib/menu/totemDesign';

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
  CircleUserRound,
  UserRound,
  X,
  Store,
  ChevronDown,
  ArrowLeftRight,
  Drumstick,
  CupSoda,
  Gift,
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

import type { CategoryMenuMode } from '../../../lib/menu/menuHeader';
import { kioskProductGridColumns } from '../../../lib/menu/kioskProductGrid';

import './dineInPremiumMenu.css';
import { useMenuBestSellers } from '../../../hooks/useMenuBestSellers';
import { ReorderList } from '../dinein/ReorderList';
import type { ReorderItem } from '../../../lib/customer/dineInReorder';
import { MenuOutdoorCarousel } from './MenuOutdoorCarousel';
import type { PublicMenuOutdoorSlide } from '../../../repositories/menuOutdoorRepository';
import { TotemOrderPanel, type TotemOrderLine } from './TotemOrderPanel';

export type DineInMenuVariant = 'MESA' | 'TOTEM';

// ============================================
// TIPAGEM
// ============================================

export interface DineInPremiumMenuProps {
  reorderItems?: ReorderItem[];
  onRepeat?: (item: ReorderItem) => void;
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

  /** Capa larga da loja (1600x500). Sem capa = cabeçalho padrão. */
  coverUrl?: string | null;
  /** Menu lateral: ícone padrão (ICON) ou imagem própria da categoria (IMAGE). */
  categoryMenuMode?: CategoryMenuMode;
  /**
   * MESA (padrão): capa, pílula da mesa e nav Início/Carrinho/Mesa/Minha conta.
   * TOTEM: sem capa/logo/mesa/nav de app; painel fixo “Seu pedido” no rodapé.
   */
  variant?: DineInMenuVariant;
  /** Itens compactos do painel do totem (ignorados no modo mesa). */
  orderLines?: TotemOrderLine[];
  orderSubtotalCents?: number;
  onChangeOrderQuantity?: (key: string, delta: number) => void;
  onCheckoutOrder?: () => void;
  totemDesign?: TotemDesign | null;

  /** Navegação controlada pelo app existente. */
  onGoHome: () => void;
  onOpenCart: () => void;
  onOpenTable: () => void;
  onOpenExpenses: () => void;
  /** Ações existentes da mesa, exibidas no menu compacto. */
  onOpenAccount?: () => void;
  onOpenBill?: () => void;
  onCallWaiter?: () => void | Promise<void>;
  canOpenAccount?: boolean;
  canRequestBill?: boolean;
  canCallWaiter?: boolean;
  billActionLabel?: string;
  onMoveTable?: () => void;
  canMoveTable?: boolean;
  roleChip?: React.ReactNode;

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
  snack: Drumstick,
  soda: CupSoda,
  promo: Gift,
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
  activeId?: string;
  onGoHome: () => void;
  onOpenCart: () => void;
  onOpenTable: () => void;
  onOpenAccount: () => void;
}

function BottomNavigation({
  cartCount,
  activeId = 'home',
  onGoHome,
  onOpenCart,
  onOpenTable,
  onOpenAccount,
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
      id: 'account',
      label: 'Minha conta',
      icon: CircleUserRound,
      onClick: onOpenAccount,
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
            className={item.id === activeId ? 'dc-kiosk-nav-item dc-kiosk-nav-item--active' : 'dc-kiosk-nav-item'}
            aria-current={item.id === activeId ? 'page' : undefined}
            onClick={item.onClick}
            data-testid={`kiosk-nav-${item.id}`}
          >
            <span className="dc-kiosk-nav-icon">
              <Icon
                size={30}
                aria-hidden={true}
              />

              {item.id === 'cart' && (
                  <span
                    className="dc-kiosk-cart-count"
                    data-testid="dinein-bag-counter"
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
  reorderItems = [],
  onRepeat,
  productColumns = 3,
  outdoorSlides = [],
  coverUrl,
  categoryMenuMode = 'ICON',
  variant = 'MESA',
  orderLines = [],
  orderSubtotalCents = 0,
  onChangeOrderQuantity,
  onCheckoutOrder,
  totemDesign,

  onGoHome,
  onOpenCart,
  onOpenTable,
  onOpenExpenses,
  onOpenAccount,
  onOpenBill,
  onCallWaiter,
  canOpenAccount = true,
  canRequestBill = true,
  canCallWaiter = true,
  billActionLabel = 'Pedir a conta',
  onMoveTable,
  canMoveTable = false,
  roleChip,
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
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [actionsMenuError, setActionsMenuError] = useState('');

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

  const openAccount = onOpenAccount ?? onOpenTable;

  function runMenuAction(action?: () => void | Promise<void>) {
    setActionsMenuOpen(false);
    setActionsMenuError('');
    if (!action) return;
    try {
      void Promise.resolve(action()).catch(() => {
        setActionsMenuError('Não foi possível realizar esta ação. Tente novamente.');
      });
    } catch {
      setActionsMenuError('Não foi possível realizar esta ação. Tente novamente.');
    }
  }

  function toggleActionsMenu() {
    setActionsMenuOpen(open => !open);
    setActionsMenuError('');
    onOpenKioskMenu?.();
  }

  const safeCoverUrl = safeMenuImageUrl(coverUrl);
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => { setCoverFailed(false); }, [safeCoverUrl]);
  const showCover = Boolean(safeCoverUrl) && !coverFailed;

  const safeCartCount = Math.max(
    0,
    Math.trunc(Number(cartCount) || 0),
  );

  const bestSellers = useMenuBestSellers(tenantId);
  const isTotem = variant === 'TOTEM';
  const totemOrderVisible = isTotem && orderLines.some(line => Number(line.quantity) > 0);

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
    ...(isTotem && totemDesign ? totemDesignCssVars(totemDesign) : {}),
  } as CSSProperties;

  return (
    <div
      className="dc-kiosk"
      data-testid="dinein-premium-kiosk"
      data-tenant-id={tenantId}
      data-layout={theme.layout}
      data-variant={isTotem ? 'totem' : 'mesa'}
      data-banner={isTotem && outdoorSlides.length > 0 ? 'true' : 'false'}
      data-order={isTotem ? (totemOrderVisible ? 'true' : 'false') : undefined}
      data-cover={!isTotem && showCover ? 'true' : 'false'}
      style={rootStyle}
    >
      {/* =================================
          CABEÇALHO PREMIUM (somente QR de mesa)
      ================================= */}

      {!isTotem && <header
        className={[
          'dc-kiosk-header',
          showCover ? 'dc-kiosk-header--cover' : '',
        ].join(' ')}
        data-testid="kiosk-header"
        data-cover={showCover ? 'true' : 'false'}
      >
        {showCover && (
          <>
            <img
              src={safeCoverUrl}
              alt=""
              aria-hidden={true}
              className="dc-kiosk-cover-image"
              data-testid="kiosk-cover-image"
              decoding="async"
              referrerPolicy="no-referrer"
              draggable={false}
              onError={() => setCoverFailed(true)}
            />
            <span className="dc-kiosk-cover-shade" aria-hidden={true} />
          </>
        )}

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

          {/* Com capa: só a logo aparece; o nome fica apenas para leitores de tela. */}
          <div className={showCover ? 'dc-kiosk-brand-copy dc-kiosk-sr-only' : 'dc-kiosk-brand-copy'}>
            <h1 className="dc-kiosk-store-name">
              {storeName}
            </h1>
          </div>
        </div>

        <div className="dc-kiosk-header-actions">
          {tableLabel ? (
            <button
              type="button"
              className="dc-kiosk-table-selector"
              aria-label={`${tableLabel}: ${actionsMenuOpen ? 'fechar menu' : 'abrir menu'}`}
              aria-expanded={actionsMenuOpen}
              aria-controls="dc-kiosk-actions-menu"
              onClick={toggleActionsMenu}
              data-testid="kiosk-hamburger"
            >
              <Armchair
                size={24}
                aria-hidden={true}
              />

              <span>{tableLabel}</span>

              <ChevronDown
                size={20}
                aria-hidden={true}
                className="dc-kiosk-table-chevron"
              />
            </button>
          ) : (
            <button
              type="button"
              className="dc-kiosk-menu-button"
              aria-label={actionsMenuOpen ? 'Fechar menu' : 'Abrir menu'}
              aria-expanded={actionsMenuOpen}
              aria-controls="dc-kiosk-actions-menu"
              onClick={toggleActionsMenu}
              data-testid="kiosk-hamburger"
            >
              {actionsMenuOpen
                ? <X size={30} aria-hidden={true} />
                : <Menu size={30} aria-hidden={true} />}
            </button>
          )}
        </div>
      </header>}

      {!isTotem && actionsMenuOpen && (
        <div className="dc-kiosk-actions-backdrop" onClick={() => setActionsMenuOpen(false)}>
          <nav
            id="dc-kiosk-actions-menu"
            aria-label="Ações do cardápio"
            className="dc-kiosk-actions-panel"
            onClick={event => event.stopPropagation()}
          >
            <button type="button" className="dc-kiosk-action-row"
              onClick={() => runMenuAction(onCallWaiter)} disabled={!onCallWaiter || !canCallWaiter}
              data-testid="kiosk-action-waiter">
              <UserRound size={23} aria-hidden={true} /> Chamar garçom
            </button>
            <button type="button" className="dc-kiosk-action-row"
              onClick={() => runMenuAction(onOpenBill)} disabled={!onOpenBill || !canRequestBill}
              data-testid="kiosk-action-bill">
              <ReceiptText size={23} aria-hidden={true} /> {billActionLabel}
            </button>
            <button type="button" className="dc-kiosk-action-row"
              onClick={() => runMenuAction(openAccount)} disabled={!canOpenAccount}
              data-testid="kiosk-action-account">
              <CircleUserRound size={23} aria-hidden={true} /> Minha conta
            </button>
            <button type="button" className="dc-kiosk-action-row"
              onClick={() => runMenuAction(onOpenExpenses)}
              data-testid="kiosk-action-expenses">
              <ReceiptText size={23} aria-hidden={true} /> Meus gastos
            </button>
          </nav>
        </div>
      )}
      {!isTotem && actionsMenuError && <p role="alert" className="dc-kiosk-action-error">{actionsMenuError}</p>}

      {/* =================================
          CONTEÚDO PRINCIPAL
      ================================= */}

      {isTotem && (
        <div
          className="dc-kiosk-totem-banner"
          data-testid="totem-fullwidth-banner"
          data-empty={outdoorSlides.length === 0 ? 'true' : 'false'}
          hidden={outdoorSlides.length === 0}
        >
          <MenuOutdoorCarousel slides={outdoorSlides} onOpenProduct={id => handleProductDetails(id)} />
        </div>
      )}

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
              const Icon = CATEGORY_ICONS[category.icon];
              const ownImage =
                categoryMenuMode === 'IMAGE'
                  ? safeMenuImageUrl(category.imageUrl)
                  : '';

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
                  data-testid={`kiosk-category-${category.id}`}
                  data-visual={ownImage ? 'image' : 'icon'}
                  onClick={() =>
                    setSelectedCategoryId(
                      category.id,
                    )
                  }
                >
                  <span className="dc-kiosk-category-visual" aria-hidden={true}>
                    {ownImage ? (
                      <SafeImage
                        src={ownImage}
                        alt=""
                        className="dc-kiosk-category-photo"
                        fallback={<Icon size={34} aria-hidden={true} />}
                      />
                    ) : (
                      <Icon
                        size={34}
                        className="dc-kiosk-category-icon"
                        aria-hidden={true}
                      />
                    )}
                  </span>
                  <span className="dc-kiosk-category-label">{category.name}</span>
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
          {!isTotem && (roleChip || onMoveTable || (onOpenBill && billActionLabel !== 'Pedir a conta')) && (
            <div className="dc-kiosk-mesa-row" aria-label="Status da mesa">
              <div className="dc-kiosk-mesa-status">{roleChip}</div>
              <div className="dc-kiosk-mesa-chrome">
                {onOpenBill && billActionLabel !== 'Pedir a conta' && (
                  <button
                    type="button"
                    disabled={!canRequestBill || busy}
                    onClick={() => onOpenBill()}
                    className={
                      'dc-kiosk-mesa-chrome-btn'
                      + (billActionLabel === 'Aguardando PIX'
                        ? ' dinein-bill-awaiting-pix'
                        : billActionLabel === 'Conta pedida'
                          ? ' dinein-bill-requested'
                          : '')
                    }
                  >
                    {billActionLabel}
                  </button>
                )}
                {onMoveTable && (
                  <button
                    type="button"
                    data-testid="dinein-move-table-btn"
                    disabled={!canMoveTable || busy}
                    onClick={onMoveTable}
                    className="dc-kiosk-mesa-chrome-btn dc-kiosk-move-table"
                  >
                    <ArrowLeftRight size={16} aria-hidden={true} />
                    <span>Mudar de mesa</span>
                  </button>
                )}
              </div>
            </div>
          )}
          {!isTotem && tableControls}
          {!isTotem && (
            <MenuOutdoorCarousel slides={outdoorSlides} onOpenProduct={id => handleProductDetails(id)} />
          )}
          {onRepeat && <ReorderList items={reorderItems} onRepeat={onRepeat} disabled={!mayOrder} />}
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
              data-columns={productColumns}
              style={{ gridTemplateColumns: kioskProductGridColumns(productColumns) }}
            >
              {categoryProducts.map(product => {
                const original =
                  originalProducts.get(product.id);

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
                      {bestSellers.includes(product.id) && <span className="dc-kiosk-best-seller">Mais pedido da casa</span> }
                      <button
                        type="button"
                        className="dc-kiosk-product-name"
                        data-testid={`kiosk-product-name-${product.id}`}
                        onClick={() => handleProductDetails(product.id)}
                      >
                        {product.name}
                      </button>

                      {onRepeat && reorderItems.some(i => i.productId === product.id) && <button type="button" className="dc-kiosk-repeat" disabled={!mayOrder} onClick={() => onRepeat(reorderItems.find(i => i.productId === product.id)!)}>Pedir de novo</button>}
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
                          <ShoppingCart size={24} aria-hidden={true} />
                          <span>Adicionar</span>
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

      {isTotem ? (
        <TotemOrderPanel
          lines={orderLines}
          subtotalCents={Math.max(0, Math.trunc(Number(orderSubtotalCents) || 0))}
          onChangeQuantity={onChangeOrderQuantity ?? (() => undefined)}
          onCheckout={onCheckoutOrder ?? (() => undefined)}
          checkoutDisabled={orderingDisabled || busy}
          visible={totemOrderVisible}
        />
      ) : (
        <BottomNavigation
          cartCount={safeCartCount}
          onGoHome={onGoHome}
          onOpenCart={onOpenCart}
          onOpenTable={onOpenTable}
          onOpenAccount={() => {
            if (canOpenAccount) openAccount();
          }}
        />
      )}
    </div>
  );
}

export default DineInPremiumMenu;
