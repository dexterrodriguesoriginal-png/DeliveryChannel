
/**
 * DELIVERY CHANNEL
 * TESTES — CARDÁPIO PREMIUM DO TOTEM
 *
 * Arquivo:
 * src/features/dineInMenu/dineInMenu.model.test.ts
 *
 * Testa regras de apresentação e isolamento.
 *
 * Não utiliza o banco de produção.
 * Não cria pedidos.
 * Não executa pagamentos.
 * Não altera mesas.
 */

import {
  describe,
  expect,
  it,
} from 'vitest';

import type {
  Category,
  Product,
} from '../../../types';

import {
  DEFAULT_MENU_THEME,
} from '../../theme/menuTheme';

import {
  buildMenuCatalog,
  productsForCategory,
  initialMenuCategory,
  resolveCategoryIcon,
  safeMenuImageUrl,
  formatMenuMoney,
  resolveMenuVisualTheme,
  buildExpenseSummary,
  MENU_NAVIGATION,
  EXPENSE_PAYMENT_OPTIONS,
  type ExpenseTab,
} from '../premiumTotem.model';

// =====================================================
// 1. DADOS DE TESTE
// =====================================================

const TENANT_A =
  '11111111-1111-4111-8111-111111111111';

const TENANT_B =
  '22222222-2222-4222-8222-222222222222';

function category(
  id: string,
  tenantId = TENANT_A,
  overrides: Partial<Category> = {},
): Category {
  return {
    id,
    tenantId,
    name: 'Cervejas',
    description: '',
    order: 1,
    isActive: true,
    ...overrides,
  };
}

function product(
  id: string,
  categoryId: string,
  tenantId = TENANT_A,
  overrides: Partial<Product> = {},
): Product {
  return {
    id,
    tenantId,
    categoryId,
    name: 'Cerveja Premium',
    description: 'Garrafa gelada',
    price: 15,
    imageUrl: 'https://example.com/cerveja.webp',
    isAvailable: true,
    isActive: true,
    stockQuantity: 20,
    unit: 'un',
    ...overrides,
  };
}

function expenseTab(
  overrides: Partial<ExpenseTab> = {},
): ExpenseTab {
  return {
    status: 'OPEN',
    pixStatus: null,
    serviceFeePercent: 10,
    serviceFeeRemoved: false,
    subtotal: 55,

    me: {
      role: 'RESPONSIBLE',
      approved: true,
    },

    rounds: [
      {
        orderId: 'pedido-1',
        status: 'DELIVERED',
        mine: true,
        subtotal: 20,
        items: [
          {
            name: 'Cerveja',
            quantity: 2,
            unitPrice: 10,
            totalPrice: 20,
          },
        ],
      },
      {
        orderId: 'pedido-2',
        status: 'DELIVERED',
        mine: false,
        subtotal: 35,
        items: [
          {
            name: 'Porção',
            quantity: 1,
            unitPrice: 35,
            totalPrice: 35,
          },
        ],
      },
      {
        orderId: 'pedido-cancelado',
        status: 'CANCELLED',
        mine: true,
        subtotal: 40,
        items: [
          {
            name: 'Pedido cancelado',
            quantity: 1,
            unitPrice: 40,
            totalPrice: 40,
          },
        ],
      },
    ],

    ...overrides,
  };
}

// =====================================================
// 2. ISOLAMENTO MULTI-TENANT
// =====================================================

describe('Isolamento entre estabelecimentos', () => {
  it('mostra somente categorias da loja atual', () => {
    const categories = [
      category('cat-a'),
      category('cat-b', TENANT_B),
    ];

    const products = [
      product('produto-a', 'cat-a'),
      product('produto-b', 'cat-b', TENANT_B),
    ];

    const result = buildMenuCatalog(
      TENANT_A,
      categories,
      products,
    );

    expect(result.categories).toHaveLength(1);
    expect(result.products).toHaveLength(1);

    expect(result.categories[0].id).toBe('cat-a');
    expect(result.products[0].id).toBe('produto-a');
  });

  it('não permite categoria de outra loja', () => {
    const result = buildMenuCatalog(
      TENANT_A,
      [category('categoria-externa', TENANT_B)],
      [product('produto-1', 'categoria-externa')],
    );

    expect(result.categories).toHaveLength(0);
    expect(result.products).toHaveLength(0);
  });

  it('não exibe dados sem tenant válido', () => {
    const result = buildMenuCatalog(
      '',
      [category('cat-a')],
      [product('produto-a', 'cat-a')],
    );

    expect(result.categories).toEqual([]);
    expect(result.products).toEqual([]);
  });

  it('não deixa produto cruzar lojas', () => {
    const result = buildMenuCatalog(
      TENANT_A,
      [category('cat-a')],
      [
        product('produto-a', 'cat-a'),
        product('produto-b', 'cat-a', TENANT_B),
      ],
    );

    expect(
      result.products.map(item => item.id),
    ).toEqual(['produto-a']);
  });
});

// =====================================================
// 3. CATEGORIAS E PRODUTOS
// =====================================================

describe('Categorias do cardápio', () => {
  it('ordena categorias conforme cadastro', () => {
    const result = buildMenuCatalog(
      TENANT_A,
      [
        category('segunda', TENANT_A, {
          name: 'Vinhos',
          order: 2,
        }),
        category('primeira', TENANT_A, {
          name: 'Cervejas',
          order: 1,
        }),
      ],
      [
        product('p1', 'primeira'),
        product('p2', 'segunda'),
      ],
    );

    expect(
      result.categories.map(item => item.id),
    ).toEqual(['primeira', 'segunda']);
  });

  it('oculta categorias inativas', () => {
    const result = buildMenuCatalog(
      TENANT_A,
      [
        category('cat-a', TENANT_A, {
          isActive: false,
        }),
      ],
      [product('p1', 'cat-a')],
    );

    expect(result.categories).toHaveLength(0);
    expect(result.products).toHaveLength(0);
  });

  it('oculta produtos inativos', () => {
    const result = buildMenuCatalog(
      TENANT_A,
      [category('cat-a')],
      [
        product('p1', 'cat-a', TENANT_A, {
          isActive: false,
        }),
      ],
    );

    expect(result.products).toHaveLength(0);
  });

  it('oculta produtos indisponíveis', () => {
    const result = buildMenuCatalog(
      TENANT_A,
      [category('cat-a')],
      [
        product('p1', 'cat-a', TENANT_A, {
          isAvailable: false,
        }),
      ],
    );

    expect(result.products).toHaveLength(0);
  });

  it('mostra somente os produtos selecionados', () => {
    const catalog = buildMenuCatalog(
      TENANT_A,
      [
        category('cervejas'),
        category('vinhos', TENANT_A, {
          name: 'Vinhos',
        }),
      ],
      [
        product('p1', 'cervejas'),
        product('p2', 'vinhos'),
      ],
    );

    const selected = productsForCategory(
      catalog,
      'vinhos',
    );

    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe('p2');
  });

  it('seleciona a primeira categoria', () => {
    const catalog = buildMenuCatalog(
      TENANT_A,
      [category('cervejas')],
      [product('p1', 'cervejas')],
    );

    expect(
      initialMenuCategory(catalog),
    ).toBe('cervejas');
  });

  it('não retorna produtos para categoria inválida', () => {
    const catalog = buildMenuCatalog(
      TENANT_A,
      [category('cervejas')],
      [product('p1', 'cervejas')],
    );

    expect(
      productsForCategory(catalog, 'inexistente'),
    ).toEqual([]);
  });

  it('agrupa produtos sem categoria em Destaques', () => {
    const catalog = buildMenuCatalog(
      TENANT_A,
      [],
      [product('p1', '')],
    );

    expect(catalog.categories).toHaveLength(1);

    expect(catalog.categories[0].name)
      .toBe('Destaques');

    expect(catalog.products).toHaveLength(1);
  });
});

// =====================================================
// 4. PREÇOS E PROMOÇÕES
// =====================================================

describe('Preços do cardápio', () => {
  it('converte reais em centavos', () => {
    const result = buildMenuCatalog(
      TENANT_A,
      [category('cat-a')],
      [
        product('p1', 'cat-a', TENANT_A, {
          price: 12.5,
        }),
      ],
    );

    expect(result.products[0].priceCents)
      .toBe(1250);
  });

  it('aplica preço promocional válido', () => {
    const result = buildMenuCatalog(
      TENANT_A,
      [category('cat-a')],
      [
        product('p1', 'cat-a', TENANT_A, {
          price: 20,
          promotionalPrice: 15,
        }),
      ],
    );

    const item = result.products[0];

    expect(item.priceCents).toBe(2000);
    expect(item.promotionalPriceCents).toBe(1500);
    expect(item.displayPriceCents).toBe(1500);
    expect(item.isPromotional).toBe(true);
  });

  it('ignora promoção maior que preço normal', () => {
    const result = buildMenuCatalog(
      TENANT_A,
      [category('cat-a')],
      [
        product('p1', 'cat-a', TENANT_A, {
          price: 20,
          promotionalPrice: 25,
        }),
      ],
    );

    const item = result.products[0];

    expect(item.displayPriceCents).toBe(2000);
    expect(item.isPromotional).toBe(false);
  });

  it('formata valores monetários em português', () => {
    const text = formatMenuMoney(2590);

    expect(text).toContain('25,90');
    expect(text).toContain('R$');
  });
});

// =====================================================
// 5. SEGURANÇA DAS IMAGENS
// =====================================================

describe('Segurança de URLs', () => {
  it('aceita URL HTTPS', () => {
    expect(
      safeMenuImageUrl(
        'https://example.com/produto.webp',
      ),
    ).toBe(
      'https://example.com/produto.webp',
    );
  });

  it('bloqueia javascript:', () => {
    expect(
      safeMenuImageUrl('javascript:alert(1)'),
    ).toBe('');
  });

  it('bloqueia data:', () => {
    expect(
      safeMenuImageUrl(
        'data:text/html,<script>alert(1)</script>',
      ),
    ).toBe('');
  });

  it('bloqueia HTTP inseguro', () => {
    expect(
      safeMenuImageUrl(
        'http://example.com/imagem.jpg',
      ),
    ).toBe('');
  });

  it('bloqueia URLs com credenciais', () => {
    expect(
      safeMenuImageUrl(
        'https://usuario:senha@example.com/foto.jpg',
      ),
    ).toBe('');
  });

  it('bloqueia conteúdo que não é URL', () => {
    expect(
      safeMenuImageUrl('<script>alert(1)</script>'),
    ).toBe('');
  });
});

// =====================================================
// 6. ÍCONES E TEMA
// =====================================================

describe('Identidade visual', () => {
  it('identifica categorias automaticamente', () => {
    expect(resolveCategoryIcon('Cervejas & Chopp'))
      .toBe('beer');

    expect(resolveCategoryIcon('Vinhos'))
      .toBe('wine');

    expect(resolveCategoryIcon('Pizzas'))
      .toBe('pizza');

    expect(resolveCategoryIcon('Hambúrgueres'))
      .toBe('sandwich');
  });

  it('escolhe o ícone padrão pelas palavras do nome da categoria', () => {
    const cases: Array<[string, string]> = [
      ['Cervejas & Chopp', 'beer'], ['Chopp artesanal', 'beer'],
      ['Vinhos & Espumantes', 'wine'], ['Espumantes', 'wine'],
      ['Destilados & Whiskies', 'martini'], ['Whisky', 'martini'],
      ['Petiscos & Aperitivos', 'snack'], ['Aperitivos', 'snack'],
      ['Porções', 'utensils'],
      ['Bebidas sem Álcool', 'soda'], ['Refrigerantes', 'soda'], ['Sucos naturais', 'soda'],
      ['Lanches', 'sandwich'], ['Burgers', 'sandwich'],
      ['Pizzas', 'pizza'],
      ['Doces', 'dessert'], ['Sobremesas', 'dessert'],
      ['Promoções', 'promo'], ['Promoção de cerveja', 'promo'],
      ['Outros', 'shopping-basket'], ['', 'shopping-basket'],
    ];
    for (const [name, icon] of cases) {
      expect(resolveCategoryIcon(name), name).toBe(icon);
    }
  });

  it('utiliza o tema do cardápio', () => {
    const result = resolveMenuVisualTheme(
      DEFAULT_MENU_THEME,
      undefined,
    );

    expect(result.background)
      .toBe(DEFAULT_MENU_THEME.background);

    expect(result.accent)
      .toBe(DEFAULT_MENU_THEME.accent);

    expect(result.radius)
      .toBe(DEFAULT_MENU_THEME.radius);
  });

  it('possui navegação com Meus gastos', () => {
    const labels = MENU_NAVIGATION.map(
      item => item.label,
    );

    expect(labels).toEqual([
      'Início',
      'Carrinho',
      'Mesa',
      'Meus gastos',
    ]);

    expect(labels).not.toContain('Minha conta');
  });
});

// =====================================================
// 7. MEUS GASTOS
// =====================================================

describe('Cálculo de Meus gastos', () => {
  it('não inclui consumo explicitamente de outro cliente', () => {
    const summary = buildExpenseSummary(
      expenseTab(),
      false,
    );

    expect(summary.lines).toHaveLength(1);
    expect(summary.lines[0].name).toBe('Cerveja');

    expect(summary.subtotalCents).toBe(2000);
    expect(summary.serviceFeeCents).toBe(200);
    expect(summary.totalCents).toBe(2200);

    expect(summary.isEstimate).toBe(true);
  });

  it('mostra valores da mesa no escopo autorizado', () => {
    const summary = buildExpenseSummary(
      expenseTab(),
      true,
    );

    expect(summary.lines).toHaveLength(2);

    expect(summary.subtotalCents).toBe(5500);
    expect(summary.serviceFeeCents).toBe(550);
    expect(summary.totalCents).toBe(6050);
  });

  it('não cobra taxa removida', () => {
    const summary = buildExpenseSummary(
      expenseTab({
        serviceFeeRemoved: true,
      }),
      true,
    );

    expect(summary.serviceFeeCents).toBe(0);
    expect(summary.totalCents).toBe(5500);
  });

  it('não inclui pedidos cancelados', () => {
    const summary = buildExpenseSummary(
      expenseTab(),
      true,
    );

    expect(
      summary.lines.some(
        line => line.name === 'Pedido cancelado',
      ),
    ).toBe(false);
  });

  it('não permite pedir conta sem aprovação', () => {
    const summary = buildExpenseSummary(
      expenseTab({
        me: {
          role: 'GUEST',
          approved: false,
        },
      }),
    );

    expect(summary.canRequestBill).toBe(false);
    expect(summary.canReopenBill).toBe(false);
  });

  it('permite solicitar conta aberta e aprovada', () => {
    const summary = buildExpenseSummary(
      expenseTab(),
    );

    expect(summary.canRequestBill).toBe(true);
  });

  it('não solicita novamente conta já pedida', () => {
    const summary = buildExpenseSummary(
      expenseTab({
        status: 'BILL_REQUESTED',
      }),
    );

    expect(summary.canRequestBill).toBe(false);
  });

  it('permite reabertura antes de pagamento pendente', () => {
    const summary = buildExpenseSummary(
      expenseTab({
        status: 'BILL_REQUESTED',
        pixStatus: null,
      }),
    );

    expect(summary.canReopenBill).toBe(true);
  });

  it('bloqueia reabertura durante PIX pendente', () => {
    const summary = buildExpenseSummary(
      expenseTab({
        status: 'BILL_REQUESTED',
        pixStatus: 'pending',
      }),
    );

    expect(summary.canReopenBill).toBe(false);
  });

  it('bloqueia reabertura após conta encerrada', () => {
    const summary = buildExpenseSummary(
      expenseTab({
        status: 'CLOSED',
      }),
    );

    expect(summary.canReopenBill).toBe(false);
    expect(summary.canRequestBill).toBe(false);
  });
});

// =====================================================
// 8. OPÇÕES DE FECHAMENTO
// =====================================================

describe('Opções de pagamento do totem', () => {
  it('possui quatro opções de atendimento', () => {
    expect(EXPENSE_PAYMENT_OPTIONS).toHaveLength(4);
  });

  it('registra as preferências de pagamento corretas', () => {
    const choices = EXPENSE_PAYMENT_OPTIONS.map(
      item => item.serverChoice,
    );

    expect(choices).toEqual([
      'CARD',
      'PIX',
      'CAIXA',
      null,
    ]);
  });

  it('não possui opção de fechamento direto da mesa', () => {
    const choices = EXPENSE_PAYMENT_OPTIONS.map(
      item => item.serverChoice,
    );

    expect(choices).not.toContain('CLOSED');
    expect(choices).not.toContain('PAID');
  });
});
