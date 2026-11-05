# Conversa — cardápio (Prompt mestre CEO IA)

## Pedido 1 (CEO)

Olá, aqui é o CEO (assistente do David). Recebi o código da Tela Inicial, obrigado — já estou integrando no projeto.

Agora o David pede a mesma coisa para a TELA DO CARDÁPIO (imagem anexada, que você criou para ele): mesmo padrão de entrega — código React/TypeScript + CSS + model/repository + migration Supabase (se precisar) + testes, um arquivo por vez, com o caminho de cada arquivo.

Requisitos:
1. Layout igual à imagem: header com logo/nome da loja e seletor de mesa ("Mesa 04"), menu lateral de categorias com ícone (categoria ativa destacada), título da categoria, grade de produtos com foto, nome, descrição curta, preço e botão "Adicionar".
2. Barra inferior: Início, Carrinho (com contador), Mesa e — ATENÇÃO — trocar "Minha conta" por "Meus gastos" (para o cliente não confundir com perfil/email/telefone).
3. Tela "Meus gastos": lista do que o cliente/mesa consumiu (itens, quantidades, valores, subtotal, taxa de serviço se houver, total) e o botão "Fechar conta". Ao tocar em Fechar conta, mostrar as opções: pagar na mesa (garçom traz a maquininha / PIX na mesa), pagar no balcão/caixa, ou chamar o garçom. Regra do David: só o cliente pede a conta; depois de pedir, a mesa fica marrom piscando no app do garçom, no Salão e no Dashboard; o cliente pode reabrir a mesa para continuar pedindo; a mesa só libera depois do pagamento confirmado.
4. Cores/visual configuráveis pela loja (usar o mesmo design/tema da Tela Inicial), mobile e totem/tablet.
5. Sem dados sensíveis expostos, sem HTML/CSS injetável, URLs de imagem seguras.

Pode mandar os arquivos um por vez. Obrigado!

## Resposta 1 (ChatGPT)

Perfeito! Vamos desenvolver o novo cardápio do Delivery Channel com a mesma qualidade visual da imagem, preservando os fluxos de mesa, pedidos e pagamentos.

Verifiquei o código existente e encontrei algo importante: o sistema já possui os mecanismos de pedir conta, reabrir comanda, calcular taxa de serviço e sinalizar mesas em marrom. Portanto, vamos aproveitar essas funcionalidades, em vez de criar um segundo sistema financeiro.

A implementação será entregue um arquivo por vez, nesta ordem: modelo TypeScript, componente do cardápio, CSS, tela Meus gastos, integração com o backend, testes e, somente se necessário, migration SQL.

## Arquivo 1 — Modelo do novo cardápio

Novo arquivo

Não substitui nenhum arquivo existente

Caminho: `src/features/dineInMenu/dineInMenu.model.ts`

Este arquivo estabelece as regras para categorias, produtos, imagens, cores, navegação e informações financeiras, sem executar pedidos ou pagamentos.

```

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

```

## O que este primeiro arquivo resolve

Ele prepara a estrutura para reproduzir o layout da imagem:

- Categorias na lateral, com imagem ou ícone automático.
- Seleção de categoria e respectivos produtos.
- Preços normais e promocionais.
- Identidade visual vinculada ao tema da loja.
- Navegação Início, Carrinho, Mesa e Meus gastos.
- Estrutura de consumo individual ou da mesa, conforme autorização.
- Opções de solicitar a conta, sem duplicar as operações financeiras existentes.

Pontos importantes para o CEO: os valores de `Meus gastos` calculados pela interface são de apresentação; o servidor continua sendo a fonte definitiva para cobrança, taxas, descontos, pagamentos e liberação de mesas. A tela não poderá marcar uma mesa como paga por conta própria.

Nenhuma migration é necessária para este primeiro arquivo, porque ele contém apenas modelos e funções de apresentação.

Status: código proposto, ainda não compilado ou testado no projeto. Nenhuma alteração foi realizada no GitHub, Supabase ou AI Studio.

O próximo arquivo será `src/features/dineInMenu/DineInPremiumMenu.tsx`: o componente React do cardápio com cabeçalho, categorias laterais, três produtos por fileira em telas adequadas e barra inferior com Meus gastos.

## Pedido 2 — correção (CEO)

Correção importante do David: essa tela do cardápio (a da imagem) é o CARDÁPIO DO TOTEM (tablet/totem na mesa ou no balcão da loja), NÃO é o aplicativo do cliente no celular. Faça o layout pensando no totem/tablet (tela grande, toque, modo quiosque). O resto dos requisitos continua igual ("Meus gastos" no lugar de "Minha conta", com "Fechar conta" e as opções mesa/balcão/chamar garçom). Pode mandar os arquivos um por vez.

## Resposta 2 (ChatGPT)

Perfeito! Correção incorporada. O novo cardápio será exclusivo do totem/tablet do estabelecimento, seguindo a imagem da ADEGASSHOW. Não vamos modificar o aplicativo do cliente no celular.

A prioridade será tela horizontal, botões grandes para toque, categorias laterais, três produtos por fileira e barra inferior fixa. A tela Meus gastos será vinculada à comanda real da mesa, sem criar um sistema financeiro paralelo.

## Arquivo 2 — Componente React do Cardápio Premium para Totem

Novo arquivo

React + TypeScript

Caminho: `src/features/dineInMenu/DineInPremiumMenu.tsx`

Este componente utiliza o modelo TypeScript enviado anteriormente. Ele é responsável somente pela apresentação e navegação, mantendo o processamento de pedidos no sistema existente.

```

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
} from '../../types';

import type {
  MenuTheme,
} from '../../types/menuTheme';

import type {
  StoreHomeDesign,
} from '../storeHome/storeHome.model';

import {
  buildMenuCatalog,
  productsForCategory,
  initialMenuCategory,
  resolveMenuVisualTheme,
  formatMenuMoney,
  safeMenuImageUrl,
  type CategoryIcon,
} from './dineInMenu.model';

import './dineInPremiumMenu.css';

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
              const Icon =
                CATEGORY_ICONS[category.icon];

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
                  <SafeImage
                    src={category.imageUrl}
                    alt={category.name}
                    className="dc-kiosk-category-photo"
                    fallback={
                      <Icon
                        size={34}
                        aria-hidden={true}
                      />
                    }
                  />

                  <span className="dc-kiosk-category-label">
                    {category.name}
                  </span>
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

```

## O que este arquivo entrega

- Cabeçalho: logo e nome da loja, identificação da mesa e opção de menu.
- Lateral esquerda: categorias com fotos ou ícones e destaque para a categoria selecionada.
- Centro: produtos filtrados pela categoria, com foto, descrição, preço e Adicionar.
- Barra inferior: Início, Carrinho com contador, Mesa e Meus gastos.
- Pedidos: continuam usando os callbacks existentes, inclusive os produtos com adicionais.
- Segurança: o componente não consulta dados de clientes, não cobra pagamentos e não libera mesas.

A tela Meus gastos será um componente separado. O botão nesta etapa apenas chama `onOpenExpenses`; será a aplicação existente que verificará a sessão autorizada e carregará a comanda.

O layout de três produtos por fileira, rolagem independente da lateral, cabeçalho fixo, barra inferior fixa e dimensões dos botões para toque será definido no CSS, sem interferir no aplicativo mobile.

Próximo arquivo da sequência: `src/features/dineInMenu/dineInPremiumMenu.css`.

Nenhum arquivo foi modificado no projeto. Este código ainda precisa ser integrado, compilado e testado pelo programador.