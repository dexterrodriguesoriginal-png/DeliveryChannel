
/**
 * DELIVERY CHANNEL
 * Cardápio Premium — Modelo de apresentação
 *
 * Este módulo não executa pedidos, pagamentos,
 * alterações de mesa ou consultas ao banco.
 *
 * Essas operações continuam pertencendo aos
 * serviços e RPCs existentes no Delivery Channel.
 */

import type {
  Category,
  Product,
} from '../../types';

import type {
  MenuTheme,
} from '../../types/menuTheme';

import {
  normalizeMenuTheme,
} from '../../lib/theme/menuTheme';

import {
  getHomeTemplate,
  type StoreHomeDesign,
} from '../storeHome/storeHome.model';

import {
  canReopenBill,
} from '../../lib/customer/billReopen';

import type {
  DiningTabStatus,
} from '../../lib/salon/tableStatus';

// ==============================================
// 1. TIPOS DE NAVEGAÇÃO
// ==============================================

export type MenuNavigation =
  | 'HOME'
  | 'CART'
  | 'TABLE'
  | 'EXPENSES';

export const MENU_NAVIGATION = [
  {
    id: 'HOME',
    label: 'Início',
    icon: 'house',
  },
  {
    id: 'CART',
    label: 'Carrinho',
    icon: 'shopping-cart',
  },
  {
    id: 'TABLE',
    label: 'Mesa',
    icon: 'armchair',
  },
  {
    id: 'EXPENSES',
    label: 'Meus gastos',
    icon: 'receipt',
  },
] as const;

// ==============================================
// 2. TIPOS VISUAIS
// ==============================================

export type MenuScreenMode =
  | 'mobile'
  | 'tablet'
  | 'totem';

export type CategoryIcon =
  | 'beer'
  | 'wine'
  | 'martini'
  | 'utensils'
  | 'coffee'
  | 'pizza'
  | 'sandwich'
  | 'dessert'
  | 'shopping-basket';

export interface MenuCategoryView {
  id: string;
  name: string;
  imageUrl: string;
  icon: CategoryIcon;
  productCount: number;
}

export interface MenuProductView {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  imageUrl: string;

  priceCents: number;
  promotionalPriceCents: number | null;
  displayPriceCents: number;

  isPromotional: boolean;
}

export interface MenuCatalogView {
  categories: MenuCategoryView[];
  products: MenuProductView[];
}

export interface MenuVisualTheme {
  background: string;
  surface: string;
  text: string;
  accent: string;
  accentText: string;
  categoryActiveBg: string;
  radius: number;
  fontFamily: string;
  layout: 'comfortable' | 'compact';

  // Gradiente de marca reaproveitado da Tela Inicial.
  headerGradient: string;
}

// ==============================================
// 3. UTILITÁRIOS DE SEGURANÇA
// ==============================================

/**
 * Aceita somente URLs HTTPS.
 *
 * Não permite javascript:, data:, file:
 * nem outras URLs capazes de executar conteúdo.
 *
 * O backend também precisa validar os uploads.
 */
export function safeMenuImageUrl(
  input: unknown,
): string {
  if (
    typeof input !== 'string' ||
    input.length > 2048
  ) {
    return '';
  }

  try {
    const url = new URL(input);

    if (url.protocol !== 'https:') {
      return '';
    }

    if (url.username || url.password) {
      return '';
    }

    return url.toString();
  } catch {
    return '';
  }
}

function safeText(
  input: unknown,
  limit: number,
): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input.trim().slice(0, limit);
}

function toCents(
  value: unknown,
): number {
  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    return 0;
  }

  return Math.round(number * 100);
}

// ==============================================
// 4. FORMATAÇÃO MONETÁRIA
// ==============================================

const brlFormatter = new Intl.NumberFormat(
  'pt-BR',
  {
    style: 'currency',
    currency: 'BRL',
  },
);

export function formatMenuMoney(
  cents: number,
): string {
  if (!Number.isSafeInteger(cents)) {
    return brlFormatter.format(0);
  }

  return brlFormatter.format(cents / 100);
}

// ==============================================
// 5. ÍCONES AUTOMÁTICOS DAS CATEGORIAS
// ==============================================

/**
 * Apenas escolhe um identificador permitido.
 * O componente React decidirá qual ícone exibir.
 *
 * O dono pode manter as fotos cadastradas
 * nas categorias existentes.
 */
export function resolveCategoryIcon(
  name: string,
): CategoryIcon {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (/cerveja|chopp/.test(normalized)) {
    return 'beer';
  }

  if (/vinho|espumante/.test(normalized)) {
    return 'wine';
  }

  if (/destilado|drink|coquetel/.test(normalized)) {
    return 'martini';
  }

  if (/pizza/.test(normalized)) {
    return 'pizza';
  }

  if (/hamburguer|lanche|sanduiche/.test(normalized)) {
    return 'sandwich';
  }

  if (/doce|sobremesa|bolo/.test(normalized)) {
    return 'dessert';
  }

  if (/cafe|bebida sem alcool|suco/.test(normalized)) {
    return 'coffee';
  }

  if (/porcao|petisco|refeicao|prato/.test(normalized)) {
    return 'utensils';
  }

  return 'shopping-basket';
}

// ==============================================
// 6. CONSTRUÇÃO DO CATÁLOGO VISUAL
// ==============================================

const UNCATEGORIZED_ID =
  '__dc_menu_uncategorized__';

/**
 * IMPORTANTE:
 *
 * tenantId deve vir da loja resolvida pelo servidor,
 * nunca de um parâmetro arbitrário do navegador.
 *
 * Este filtro é uma proteção adicional da interface.
 * A autorização real continua no Supabase.
 */
export function buildMenuCatalog(
  tenantId: string,
  categories: readonly Category[],
  products: readonly Product[],
): MenuCatalogView {
  if (!tenantId) {
    return {
      categories: [],
      products: [],
    };
  }

  const ownCategories = categories
    .filter(category =>
      category.tenantId === tenantId &&
      category.isActive !== false,
    )
    .sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0),
    );

  const validCategoryIds = new Set(
    ownCategories.map(category => category.id),
  );

  const visibleProducts: MenuProductView[] = [];

  for (const product of products) {
    if (product.tenantId !== tenantId) {
      continue;
    }

    if (
      product.isActive === false ||
      product.isAvailable === false
    ) {
      continue;
    }

    if (
      product.categoryId &&
      !validCategoryIds.has(product.categoryId)
    ) {
      continue;
    }

    const priceCents = toCents(product.price);

    const promotionalPriceCents =
      product.promotionalPrice !== undefined &&
      product.promotionalPrice !== null &&
      Number.isFinite(product.promotionalPrice) &&
      product.promotionalPrice >= 0 &&
      product.promotionalPrice < product.price
        ? toCents(product.promotionalPrice)
        : null;

    visibleProducts.push({
      id: product.id,

      categoryId:
        product.categoryId || UNCATEGORIZED_ID,

      name: safeText(product.name, 120),

      description: safeText(
        product.description,
        180,
      ),

      imageUrl: safeMenuImageUrl(
        product.imageUrl,
      ),

      priceCents,

      promotionalPriceCents,

      displayPriceCents:
        promotionalPriceCents ?? priceCents,

      isPromotional:
        promotionalPriceCents !== null,
    });
  }

  const counts = new Map<string, number>();

  for (const product of visibleProducts) {
    counts.set(
      product.categoryId,
      (counts.get(product.categoryId) ?? 0) + 1,
    );
  }

  const resultCategories: MenuCategoryView[] =
    ownCategories
      .filter(category =>
        (counts.get(category.id) ?? 0) > 0,
      )
      .map(category => ({
        id: category.id,
        name: safeText(category.name, 100),
        imageUrl: safeMenuImageUrl(
          category.imageUrl,
        ),
        icon: resolveCategoryIcon(category.name),
        productCount:
          counts.get(category.id) ?? 0,
      }));

  const uncategorizedCount =
    counts.get(UNCATEGORIZED_ID) ?? 0;

  if (uncategorizedCount > 0) {
    resultCategories.push({
      id: UNCATEGORIZED_ID,
      name: 'Destaques',
      imageUrl: '',
      icon: 'shopping-basket',
      productCount: uncategorizedCount,
    });
  }

  return {
    categories: resultCategories,
    products: visibleProducts,
  };
}

// ==============================================
// 7. SELEÇÃO DE CATEGORIA
// ==============================================

export function productsForCategory(
  catalog: MenuCatalogView,
  categoryId: string,
): MenuProductView[] {
  const isValidCategory =
    catalog.categories.some(
      category => category.id === categoryId,
    );

  if (!isValidCategory) {
    return [];
  }

  return catalog.products.filter(
    product => product.categoryId === categoryId,
  );
}

export function initialMenuCategory(
  catalog: MenuCatalogView,
): string {
  return catalog.categories[0]?.id ?? '';
}

// ==============================================
// 8. TEMA VISUAL COMPARTILHADO
// ==============================================

/**
 * Reaproveita:
 *
 * - Gradiente da Tela Inicial;
 * - Cores do Design do Cardápio;
 * - Fontes, bordas e espaçamento configurados.
 *
 * Nunca aceita CSS arbitrário vindo do banco.
 */
export function resolveMenuVisualTheme(
  menuTheme: MenuTheme | undefined,
  homeDesign: StoreHomeDesign | undefined,
): MenuVisualTheme {
  const menu = normalizeMenuTheme(menuTheme);

  const homeTemplate = getHomeTemplate(
    homeDesign?.templateId ?? 'dc-oficial',
  );

  return {
    background: menu.background,
    surface: menu.surface,
    text: menu.text,
    accent: menu.accent,
    accentText: menu.accentText,
    categoryActiveBg: menu.categoryActiveBg,

    radius: menu.radius,
    fontFamily: menu.fontFamily,
    layout: menu.layout,

    headerGradient:
      homeTemplate.topGradient,
  };
}

// ==============================================
// 9. MEUS GASTOS
// ==============================================

/**
 * DTO visual derivado do retorno já autorizado
 * da RPC get_my_tab(p_session_id).
 *
 * Não deve ser preenchido com buscas públicas
 * ou IDs de outros clientes.
 */
export interface ExpenseLine {
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface ExpenseRound {
  orderId: string;
  status: string;

  // O servidor pode restringir a visualização
  // dos pedidos a quem pertence à comanda.
  mine?: boolean;

  subtotal: number;

  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }>;
}

export interface ExpenseTab {
  status: DiningTabStatus;
  pixStatus?: string | null;

  serviceFeePercent: number;
  serviceFeeRemoved: boolean;

  subtotal: number;
  rounds: ExpenseRound[];

  me?: {
    role: 'RESPONSIBLE' | 'GUEST';
    approved: boolean;
  };
}

export interface ExpenseSummary {
  lines: ExpenseLine[];

  subtotalCents: number;
  serviceFeeCents: number;
  totalCents: number;

  isEstimate: boolean;

  status: DiningTabStatus;

  canRequestBill: boolean;
  canReopenBill: boolean;
}

/**
 * Visualização individual por padrão.
 *
 * Só use tableScope=true quando o fluxo existente
 * tiver autorizado a exibição da comanda da mesa.
 *
 * Valores individuais calculados aqui são estimativas.
 * O valor final para cobrança pertence ao servidor.
 */
export function buildExpenseSummary(
  tab: ExpenseTab,
  tableScope = false,
): ExpenseSummary {
  const rounds = tab.rounds.filter(round =>
    round.status !== 'CANCELLED' &&
    (tableScope || round.mine !== false),
  );

  const lines: ExpenseLine[] = [];

  for (const round of rounds) {
    for (const item of round.items) {
      const quantity = Number(item.quantity);

      if (
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
      ) {
        continue;
      }

      lines.push({
        name: safeText(item.name, 120),
        quantity,
        unitPriceCents: toCents(
          item.unitPrice,
        ),
        totalCents: toCents(
          item.totalPrice,
        ),
      });
    }
  }

  const subtotalCents = tableScope
    ? toCents(tab.subtotal)
    : rounds.reduce(
        (sum, round) =>
          sum + toCents(round.subtotal),
        0,
      );

  const percentage =
    Number.isFinite(tab.serviceFeePercent)
      ? Math.max(
          0,
          Math.min(100, tab.serviceFeePercent),
        )
      : 0;

  const serviceFeeCents =
    tab.serviceFeeRemoved
      ? 0
      : Math.round(
          subtotalCents * percentage / 100,
        );

  const canRequestBill =
    tab.me?.approved === true &&
    tab.status === 'OPEN';

  const canReopen =
    tab.me?.approved === true &&
    canReopenBill(
      tab.status,
      tab.pixStatus,
    );

  return {
    lines,
    subtotalCents,
    serviceFeeCents,
    totalCents:
      subtotalCents + serviceFeeCents,

    // Mesmo no escopo de mesa, o valor exibido
    // não substitui a confirmação de cobrança.
    isEstimate: !tableScope,

    status: tab.status,
    canRequestBill,
    canReopenBill: canReopen,
  };
}

// ==============================================
// 10. OPÇÕES DE FECHAMENTO DA CONTA
// ==============================================

export type ExpensePaymentAction =
  | 'CARD_AT_TABLE'
  | 'PIX_AT_TABLE'
  | 'PAY_AT_COUNTER'
  | 'CALL_WAITER';

export const EXPENSE_PAYMENT_OPTIONS = [
  {
    id: 'CARD_AT_TABLE',
    label: 'Pagar na mesa',
    description: 'Garçom traz a maquininha',
    serverChoice: 'CARD',
  },
  {
    id: 'PIX_AT_TABLE',
    label: 'PIX na mesa',
    description: 'Solicitar pagamento via PIX',
    serverChoice: 'PIX',
  },
  {
    id: 'PAY_AT_COUNTER',
    label: 'Pagar no balcão',
    description: 'Pagamento no caixa',
    serverChoice: 'CAIXA',
  },
  {
    id: 'CALL_WAITER',
    label: 'Chamar garçom',
    description: 'Solicitar atendimento',
    serverChoice: null,
  },
] as const;

/**
 * Regras de fechamento:
 *
 * 1. "Fechar conta" na interface significa
 *    solicitar a conta, não encerrar a mesa.
 *
 * 2. CARD/PIX/CAIXA utilizam a RPC existente
 *    request_bill, com p_session_id.
 *
 * 3. CALL_WAITER utiliza call_waiter.
 *
 * 4. Reabertura utiliza reopen_tab_from_bill.
 *
 * 5. A mesa só é liberada pelo backend após
 *    confirmação do pagamento e fechamento.
 *
 * 6. O estado marrom piscando é responsabilidade
 *    do Salão, Dashboard e App do Garçom, que
 *    já possuem suas regras de status.
 */
