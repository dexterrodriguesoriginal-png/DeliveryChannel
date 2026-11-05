
/**
 * DELIVERY CHANNEL
 * TESTES DE INTEGRA��O � CARD�PIO PREMIUM TOTEM
 *
 * Executar:
 * npx vitest run \
 * src/features/dineInMenu/DineInPremiumMenu.integration.test.tsx
 *
 * Testes sem banco de produ��o.
 * Nenhum pagamento ou pedido real ser� criado.
 */

// @vitest-environment happy-dom

import React from 'react';

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  Category,
  Product,
} from '../../types';

import {
  DEFAULT_MENU_THEME,
} from '../../lib/theme/menuTheme';

import type {
  ExpenseTab,
} from './dineInMenu.model';

import {
  DineInPremiumMenu,
} from './DineInPremiumMenu';

import {
  DineInExpenses,
} from './DineInExpenses';

import {
  DineInPremiumMenuAdapter,
} from './DineInPremiumMenuAdapter';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// =====================================================
// 1. DADOS FICT�CIOS
// =====================================================

const TENANT_ID =
  '11111111-1111-4111-8111-111111111111';

const OTHER_TENANT_ID =
  '22222222-2222-4222-8222-222222222222';

const SESSION_ID = 'session-test-01';

function category(
  id: string,
  name: string,
  tenantId = TENANT_ID,
): Category {
  return {
    id,
    tenantId,
    name,
    order: id === 'cervejas' ? 1 : 2,
    isActive: true,
  };
}

function product(
  id: string,
  name: string,
  categoryId: string,
  overrides: Partial<Product> = {},
): Product {
  return {
    id,
    tenantId: TENANT_ID,
    categoryId,
    name,
    description: 'Produto especial da casa',
    price: 18,
    imageUrl:
      'https://example.com/produto.webp',
    isAvailable: true,
    isActive: true,
    stockQuantity: 20,
    unit: 'un',
    ...overrides,
  };
}

function sampleCategories(): Category[] {
  return [
    category('cervejas', 'Cervejas & Chopp'),
    category('vinhos', 'Vinhos'),
  ];
}

function sampleProducts(): Product[] {
  return [
    product(
      'cerveja-1',
      'Cerveja Aurora',
      'cervejas',
      { price: 15 },
    ),
    product(
      'cerveja-2',
      'Chopp da Casa',
      'cervejas',
      { price: 12.5 },
    ),
    product(
      'vinho-1',
      'Vinho Reserva',
      'vinhos',
      { price: 49.9 },
    ),
  ];
}

function sampleTab(
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
        orderId: 'pedido-proprio',
        status: 'DELIVERED',
        mine: true,
        subtotal: 20,
        items: [
          {
            name: 'Cerveja do Cliente',
            quantity: 2,
            unitPrice: 10,
            totalPrice: 20,
          },
        ],
      },
      {
        orderId: 'pedido-outra-pessoa',
        status: 'DELIVERED',
        mine: false,
        subtotal: 35,
        items: [
          {
            name: 'Por��o de Outro Cliente',
            quantity: 1,
            unitPrice: 35,
            totalPrice: 35,
          },
        ],
      },
    ],

    ...overrides,
  };
}

// =====================================================
// 2. PROPS DO CARD�PIO
// =====================================================

function menuProps():
  React.ComponentProps<typeof DineInPremiumMenu> {
  return {
    tenantId: TENANT_ID,

    storeName: 'ADEGASSHOW',
    storeLogoUrl:
      'https://example.com/logo.png',
    storeTagline: 'Sua adega favorita',

    tableLabel: 'Mesa 04',

    categories: sampleCategories(),
    products: sampleProducts(),

    menuTheme: DEFAULT_MENU_THEME,

    cartCount: 2,
    orderingDisabled: false,
    busy: false,

    onGoHome: vi.fn(),
    onOpenCart: vi.fn(),
    onOpenTable: vi.fn(),
    onOpenExpenses: vi.fn(),

    onAddProduct: vi.fn(),
    onOpenProduct: vi.fn(),
  };
}

function expensesProps():
  React.ComponentProps<typeof DineInExpenses> {
  return {
    tab: sampleTab(),
    tableLabel: 'Mesa 04',

    menuTheme: DEFAULT_MENU_THEME,

    authorizedTableScope: false,

    busy: false,
    loading: false,

    onBack: vi.fn(),

    onRequestBill:
      vi.fn(async () => {}),

    onCallWaiter:
      vi.fn(async () => {}),

    onReopenBill:
      vi.fn(async () => {}),

    onRefresh:
      vi.fn(async () => {}),
  };
}

function adapterProps():
  React.ComponentProps<
    typeof DineInPremiumMenuAdapter
  > {
  return {
    tenantId: TENANT_ID,
    storeName: 'ADEGASSHOW',

    storeLogoUrl:
      'https://example.com/logo.png',

    location: 'TABLE',
    tableLabel: 'Mesa 04',

    categories: sampleCategories(),
    products: sampleProducts(),

    menuTheme: DEFAULT_MENU_THEME,

    cartCount: 2,
    orderingDisabled: false,
    busy: false,

    verifiedSessionId: SESSION_ID,
    tabSessionId: SESSION_ID,

    sessionAuthorized: true,
    tab: sampleTab(),

    authorizedTableScope: false,

    onGoHome: vi.fn(),
    onOpenCart: vi.fn(),
    onOpenTable: vi.fn(),

    onAddProduct: vi.fn(),
    onOpenProduct: vi.fn(),

    onRequestBill:
      vi.fn(async () => {}),

    onCallWaiter:
      vi.fn(async () => {}),

    onReopenBill:
      vi.fn(async () => {}),

    onRefreshExpenses:
      vi.fn(async () => {}),
  };
}

// =====================================================
// 3. TESTES DO CARD�PIO DO TOTEM
// =====================================================

describe('Card�pio Premium � Totem', () => {
  it('exibe identidade da loja e mesa', () => {
    render(
      <DineInPremiumMenu {...menuProps()} />,
    );

    expect(
      screen.getByRole('heading', {
        name: 'ADEGASSHOW',
      }),
    ).toBeTruthy();

    expect(
      screen.getByRole('button', {
        name: /Informa��es da Mesa 04/,
      }),
    ).toBeTruthy();

    expect(
      screen.getByTestId(
        'dinein-premium-kiosk',
      ),
    ).toBeTruthy();
  });

  it('exibe a categoria inicial', () => {
    render(
      <DineInPremiumMenu {...menuProps()} />,
    );

    expect(
      screen.getByRole('heading', {
        name: 'Cervejas & Chopp',
      }),
    ).toBeTruthy();

    expect(
      screen.getByText('Cerveja Aurora'),
    ).toBeTruthy();

    expect(
      screen.getByText('Chopp da Casa'),
    ).toBeTruthy();
  });

  it('alterna categorias por toque', () => {
    render(
      <DineInPremiumMenu {...menuProps()} />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /Vinhos/,
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Vinhos',
      }),
    ).toBeTruthy();

    expect(
      screen.getByText('Vinho Reserva'),
    ).toBeTruthy();

    expect(
      screen.queryByText('Cerveja Aurora'),
    ).toBeNull();
  });

  it('adiciona produto pelo callback existente', () => {
    const props = menuProps();

    render(
      <DineInPremiumMenu {...props} />,
    );

    fireEvent.click(
      screen.getByTestId(
        'kiosk-add-cerveja-1',
      ),
    );

    expect(
      props.onAddProduct,
    ).toHaveBeenCalledExactlyOnceWith(
      props.products[0],
    );
  });

  it('n�o adiciona produtos com pedidos bloqueados', () => {
    const props = menuProps();

    props.orderingDisabled = true;

    render(
      <DineInPremiumMenu {...props} />,
    );

    const button = screen.getByTestId(
      'kiosk-add-cerveja-1',
    ) as HTMLButtonElement;

    expect(button.disabled).toBe(true);

    fireEvent.click(button);

    expect(
      props.onAddProduct,
    ).not.toHaveBeenCalled();
  });

  it('abre detalhes de produtos com adicionais', () => {
    const props = menuProps();

    const configured = product(
      'cerveja-com-opcoes',
      'Cerveja Personalizada',
      'cervejas',
      {
        optionGroups: [
          {
            id: 'tamanho',
            tenantId: TENANT_ID,
            name: 'Escolha o tamanho',
            active: true,
            minSelect: 1,
            maxSelect: 1,
            type: 'STANDARD',
            pricingRule: 'SUM',
            allowRepeat: false,
            sort: 0,
            options: [],
          },
        ],
      },
    );

    props.products = [configured];

    render(
      <DineInPremiumMenu {...props} />,
    );

    fireEvent.click(
      screen.getByTestId(
        'kiosk-add-cerveja-com-opcoes',
      ),
    );

    expect(
      props.onOpenProduct,
    ).toHaveBeenCalledExactlyOnceWith(
      configured,
    );

    expect(
      props.onAddProduct,
    ).not.toHaveBeenCalled();
  });

  it('impede exposi��o visual de produtos de outra loja', () => {
    const props = menuProps();

    props.products.push(
      product(
        'produto-externo',
        'Produto Privado de Outra Loja',
        'cervejas',
        {
          tenantId: OTHER_TENANT_ID,
        },
      ),
    );

    render(
      <DineInPremiumMenu {...props} />,
    );

    expect(
      screen.queryByText(
        'Produto Privado de Outra Loja',
      ),
    ).toBeNull();
  });

  it('n�o utiliza URL de imagem perigosa', () => {
    const props = menuProps();

    props.products = [
      product(
        'produto-inseguro',
        'Produto Seguro',
        'cervejas',
        {
          imageUrl:
            'javascript:alert(1)',
        },
      ),
    ];

    const { container } = render(
      <DineInPremiumMenu {...props} />,
    );

    expect(
      container.querySelector(
        'img[src^="javascript:"]',
      ),
    ).toBeNull();

    expect(
      screen.getByText('Produto Seguro'),
    ).toBeTruthy();
  });
});

// =====================================================
// 4. BARRA INFERIOR
// =====================================================

describe('Navega��o do Totem', () => {
  it('usa Meus gastos em vez de Minha conta', () => {
    render(
      <DineInPremiumMenu {...menuProps()} />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Meus gastos',
      }),
    ).toBeTruthy();

    expect(
      screen.queryByRole('button', {
        name: 'Minha conta',
      }),
    ).toBeNull();
  });

  it('abre carrinho e informa��es da mesa', () => {
    const props = menuProps();

    render(
      <DineInPremiumMenu {...props} />,
    );

    fireEvent.click(
      screen.getByTestId('kiosk-nav-cart'),
    );

    expect(
      props.onOpenCart,
    ).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByTestId('kiosk-nav-table'),
    );

    expect(
      props.onOpenTable,
    ).toHaveBeenCalledOnce();
  });

  it('exibe contador do carrinho', () => {
    render(
      <DineInPremiumMenu
        {...menuProps()}
        cartCount={7}
      />,
    );

    expect(
      screen.getByLabelText('7 itens'),
    ).toBeTruthy();
  });

  it('abre a tela inicial pelo callback', () => {
    const props = menuProps();

    render(
      <DineInPremiumMenu {...props} />,
    );

    fireEvent.click(
      screen.getByTestId('kiosk-nav-home'),
    );

    expect(
      props.onGoHome,
    ).toHaveBeenCalledOnce();
  });
});

// =====================================================
// 5. TELA MEUS GASTOS
// =====================================================

describe('Meus gastos � Interface', () => {
  it('exibe somente os produtos do cliente no escopo individual', () => {
    render(
      <DineInExpenses {...expensesProps()} />,
    );

    expect(
      screen.getByText('Cerveja do Cliente'),
    ).toBeTruthy();

    expect(
      screen.queryByText(
        'Por��o de Outro Cliente',
      ),
    ).toBeNull();

    expect(
      screen.getByText('R$ 22,00'),
    ).toBeTruthy();
  });

  it('mostra os valores da mesa quando autorizado', () => {
    render(
      <DineInExpenses
        {...expensesProps()}
        authorizedTableScope={true}
      />,
    );

    expect(
      screen.getByText('Cerveja do Cliente'),
    ).toBeTruthy();

    expect(
      screen.getByText(
        'Por��o de Outro Cliente',
      ),
    ).toBeTruthy();

    expect(
      screen.getByText('R$ 60,50'),
    ).toBeTruthy();
  });

  it('bloqueia valores sem sess�o aprovada', () => {
    const props = expensesProps();

    props.tab = sampleTab({
      me: {
        role: 'GUEST',
        approved: false,
      },
    });

    render(
      <DineInExpenses {...props} />,
    );

    expect(
      screen.queryByText('Cerveja do Cliente'),
    ).toBeNull();

    expect(
      screen.queryByTestId(
        'kiosk-request-bill',
      ),
    ).toBeNull();

    expect(
      screen.getByText(
        'Comanda n�o dispon�vel',
      ),
    ).toBeTruthy();
  });

  it.each([
    ['Pagar na mesa', 'CARD'],
    ['PIX na mesa', 'PIX'],
    ['Pagar no balc�o', 'CAIXA'],
  ] as const)(
    'solicita %s usando %s',
    async (label, choice) => {
      const props = expensesProps();

      render(
        <DineInExpenses {...props} />,
      );

      fireEvent.click(
        screen.getByTestId(
          'kiosk-request-bill',
        ),
      );

      expect(
        screen.getByRole('dialog'),
      ).toBeTruthy();

      fireEvent.click(
        screen.getByRole('button', {
          name: new RegExp(label, 'i'),
        }),
      );

      fireEvent.click(
        screen.getByTestId(
          'kiosk-confirm-payment-choice',
        ),
      );

      await waitFor(() => {
        expect(
          props.onRequestBill,
        ).toHaveBeenCalledExactlyOnceWith(
          choice,
        );
      });
    },
  );

  it('chama gar�om sem solicitar fechamento', async () => {
    const props = expensesProps();

    render(
      <DineInExpenses {...props} />,
    );

    fireEvent.click(
      screen.getByTestId(
        'kiosk-request-bill',
      ),
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /Chamar gar�om/i,
      }),
    );

    fireEvent.click(
      screen.getByTestId(
        'kiosk-confirm-payment-choice',
      ),
    );

    await waitFor(() => {
      expect(
        props.onCallWaiter,
      ).toHaveBeenCalledOnce();
    });

    expect(
      props.onRequestBill,
    ).not.toHaveBeenCalled();
  });

  it('permite reabrir conta quando autorizado', async () => {
    const props = expensesProps();

    props.tab = sampleTab({
      status: 'BILL_REQUESTED',
      pixStatus: null,
    });

    render(
      <DineInExpenses {...props} />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /Reabrir comanda/i,
      }),
    );

    await waitFor(() => {
      expect(
        props.onReopenBill,
      ).toHaveBeenCalledOnce();
    });
  });

  it('bloqueia reabertura durante PIX pendente', () => {
    const props = expensesProps();

    props.tab = sampleTab({
      status: 'AWAITING_PAYMENT',
      pixStatus: 'pending',
    });

    render(
      <DineInExpenses {...props} />,
    );

    expect(
      screen.queryByRole('button', {
        name: /Reabrir comanda/i,
      }),
    ).toBeNull();

    expect(
      screen.queryByTestId(
        'kiosk-request-bill',
      ),
    ).toBeNull();
  });

  it('mostra erro quando solicitar conta falha', async () => {
    const props = expensesProps();

    props.onRequestBill = vi.fn(
      async () => {
        throw new Error(
          'N�o foi poss�vel solicitar a conta.',
        );
      },
    );

    render(
      <DineInExpenses {...props} />,
    );

    fireEvent.click(
      screen.getByTestId(
        'kiosk-request-bill',
      ),
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /Pagar na mesa/i,
      }),
    );

    fireEvent.click(
      screen.getByTestId(
        'kiosk-confirm-payment-choice',
      ),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('alert').textContent,
      ).toContain(
        'N�o foi poss�vel solicitar a conta.',
      );
    });
  });
});

// =====================================================
// 6. ADAPTADOR E PROTE��O DE SESS�O
// =====================================================

describe('Adaptador � Seguran�a do Totem', () => {
  it('abre Meus gastos com sess�o autorizada', async () => {
    const props = adapterProps();

    render(
      <DineInPremiumMenuAdapter {...props} />,
    );

    fireEvent.click(
      screen.getByTestId(
        'kiosk-nav-expenses',
      ),
    );

    await waitFor(() => {
      expect(
        props.onRefreshExpenses,
      ).toHaveBeenCalledOnce();
    });

    expect(
      await screen.findByTestId(
        'kiosk-expenses',
      ),
    ).toBeTruthy();

    expect(
      screen.getByText('Cerveja do Cliente'),
    ).toBeTruthy();
  });

  it('n�o revela consumo com sess�es diferentes', async () => {
    const props = adapterProps();

    props.tabSessionId =
      'outra-sessao';

    render(
      <DineInPremiumMenuAdapter {...props} />,
    );

    fireEvent.click(
      screen.getByTestId(
        'kiosk-nav-expenses',
      ),
    );

    expect(
      screen.queryByText('Cerveja do Cliente'),
    ).toBeNull();

    expect(
      screen.queryByTestId(
        'kiosk-expenses-adapter',
      ),
    ).toBeNull();

    expect(
      props.onRefreshExpenses,
    ).not.toHaveBeenCalled();
  });

  it('oculta gastos ap�s troca de sess�o', async () => {
    const props = adapterProps();

    const view = render(
      <DineInPremiumMenuAdapter {...props} />,
    );

    fireEvent.click(
      screen.getByTestId(
        'kiosk-nav-expenses',
      ),
    );

    expect(
      await screen.findByText(
        'Cerveja do Cliente',
      ),
    ).toBeTruthy();

    // Simula a mudan�a da sess�o autenticada.
    view.rerender(
      <DineInPremiumMenuAdapter
        {...props}
        verifiedSessionId="nova-sessao"
        tabSessionId="sessao-anterior"
        sessionAuthorized={false}
      />,
    );

    await waitFor(() => {
      expect(
        screen.queryByText(
          'Cerveja do Cliente',
        ),
      ).toBeNull();
    });
  });

  it('bloqueia despesas no totem de balc�o sem identifica��o', () => {
    const props = adapterProps();

    props.location = 'COUNTER';
    props.verifiedSessionId = null;
    props.tabSessionId = null;
    props.sessionAuthorized = false;
    props.tab = null;

    render(
      <DineInPremiumMenuAdapter {...props} />,
    );

    fireEvent.click(
      screen.getByTestId(
        'kiosk-nav-expenses',
      ),
    );

    expect(
      screen.queryByTestId(
        'kiosk-expenses-adapter',
      ),
    ).toBeNull();

    expect(
      props.onRequestBill,
    ).not.toHaveBeenCalled();
  });

  it('reinicia navega��o ao reiniciar o quiosque', async () => {
    const props = adapterProps();

    const view = render(
      <DineInPremiumMenuAdapter
        {...props}
        resetKey={1}
      />,
    );

    fireEvent.click(
      screen.getByTestId(
        'kiosk-nav-expenses',
      ),
    );

    expect(
      await screen.findByTestId(
        'kiosk-expenses',
      ),
    ).toBeTruthy();

    view.rerender(
      <DineInPremiumMenuAdapter
        {...props}
        resetKey={2}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(
          'dinein-premium-kiosk',
        ),
      ).toBeTruthy();
    });
  });
});
