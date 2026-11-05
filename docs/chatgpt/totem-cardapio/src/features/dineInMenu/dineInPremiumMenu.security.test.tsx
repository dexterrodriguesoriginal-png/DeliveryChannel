
/**
 * DELIVERY CHANNEL
 * SEGURAN�A � CARD�PIO PREMIUM / TOTEM
 *
 * Arquivo:
 * src/features/dineInMenu/
 * dineInPremiumMenu.security.test.tsx
 *
 * Testes de interface e concorr�ncia.
 * Nenhuma conex�o com Supabase � necess�ria.
 *
 * ATEN��O:
 * Os testes de regress�o marcados como cr�ticos
 * podem falhar at� que as corre��es sejam aplicadas.
 */

// @vitest-environment happy-dom

import React from 'react';

import {
  act,
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

import type {
  MenuTheme,
} from '../../types/menuTheme';

import {
  DEFAULT_MENU_THEME,
} from '../../lib/theme/menuTheme';

import {
  buildExpenseSummary,
  safeMenuImageUrl,
  type ExpenseTab,
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

// =====================================================
// 1. FIXTURES
// =====================================================

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

function category(
  id: string,
  name: string,
  tenantId = TENANT_A,
): Category {
  return {
    id,
    tenantId,
    name,
    order: 1,
    isActive: true,
  };
}

function product(
  id: string,
  name: string,
  tenantId = TENANT_A,
  overrides: Partial<Product> = {},
): Product {
  return {
    id,
    tenantId,
    categoryId: 'bebidas',
    name,
    description: 'Descri��o do produto',
    price: 20,
    imageUrl: 'https://example.com/image.webp',
    isAvailable: true,
    isActive: true,
    stockQuantity: 10,
    unit: 'un',
    ...overrides,
  };
}

function makeTab(
  overrides: Partial<ExpenseTab> = {},
): ExpenseTab {
  return {
    status: 'OPEN',
    pixStatus: null,

    serviceFeePercent: 10,
    serviceFeeRemoved: false,

    subtotal: 70,

    me: {
      role: 'RESPONSIBLE',
      approved: true,
    },

    rounds: [
      {
        orderId: 'own',
        status: 'DELIVERED',
        mine: true,
        subtotal: 20,
        items: [
          {
            name: 'Consumo autorizado',
            quantity: 1,
            unitPrice: 20,
            totalPrice: 20,
          },
        ],
      },
      {
        orderId: 'other',
        status: 'DELIVERED',
        mine: false,
        subtotal: 35,
        items: [
          {
            name: 'Consumo de terceiros',
            quantity: 1,
            unitPrice: 35,
            totalPrice: 35,
          },
        ],
      },
      {
        orderId: 'unknown',
        status: 'DELIVERED',
        // Sem campo mine propositalmente.
        subtotal: 15,
        items: [
          {
            name: 'Consumo sem titular',
            quantity: 1,
            unitPrice: 15,
            totalPrice: 15,
          },
        ],
      },
    ],

    ...overrides,
  };
}

function makeMenuProps():
  React.ComponentProps<typeof DineInPremiumMenu> {
  return {
    tenantId: TENANT_A,
    storeName: 'Loja Teste',

    tableLabel: 'Mesa 04',

    categories: [
      category('bebidas', 'Bebidas'),
    ],

    products: [
      product('p1', 'Suco da Casa'),
    ],

    menuTheme: DEFAULT_MENU_THEME,

    cartCount: 0,
    orderingDisabled: false,

    onGoHome: vi.fn(),
    onOpenCart: vi.fn(),
    onOpenTable: vi.fn(),
    onOpenExpenses: vi.fn(),

    onAddProduct: vi.fn(),
    onOpenProduct: vi.fn(),
  };
}

function makeAdapterProps():
  React.ComponentProps<
    typeof DineInPremiumMenuAdapter
  > {
  return {
    ...makeMenuProps(),

    location: 'TABLE',
    verifiedSessionId: SESSION_A,
    tabSessionId: SESSION_A,

    sessionAuthorized: true,

    tab: makeTab(),

    authorizedTableScope: false,

    onRequestBill: vi.fn(async () => {}),
    onCallWaiter: vi.fn(async () => {}),
    onReopenBill: vi.fn(async () => {}),

    onRefreshExpenses: vi.fn(async () => {}),
  };
}

function makeExpensesProps():
  React.ComponentProps<typeof DineInExpenses> {
  return {
    tab: makeTab(),
    tableLabel: 'Mesa 04',

    menuTheme: DEFAULT_MENU_THEME,
    authorizedTableScope: false,

    onBack: vi.fn(),

    onRequestBill: vi.fn(async () => {}),
    onCallWaiter: vi.fn(async () => {}),
    onReopenBill: vi.fn(async () => {}),
    onRefresh: vi.fn(async () => {}),
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;

  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });

  return { promise, resolve, reject };
}

async function openExpensesInAdapter() {
  fireEvent.click(
    screen.getByTestId('kiosk-nav-expenses'),
  );

  await screen.findByTestId('kiosk-expenses');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// =====================================================
// 2. AUTORIZA��O DE SESS�O
// =====================================================

describe('Seguran�a de sess�o no totem', () => {
  it('n�o exp�e gastos sem sess�o', async () => {
    const props = makeAdapterProps();

    render(
      <DineInPremiumMenuAdapter
        {...props}
        verifiedSessionId={null}
        tabSessionId={null}
        sessionAuthorized={false}
        tab={null}
      />,
    );

    fireEvent.click(
      screen.getByTestId('kiosk-nav-expenses'),
    );

    expect(
      screen.queryByText('Consumo autorizado'),
    ).toBeNull();

    expect(
      screen.queryByText('Consumo de terceiros'),
    ).toBeNull();

    expect(
      props.onRefreshExpenses,
    ).not.toHaveBeenCalled();
  });

  it('bloqueia dados vinculados a outra sess�o', () => {
    const props = makeAdapterProps();

    render(
      <DineInPremiumMenuAdapter
        {...props}
        verifiedSessionId={SESSION_A}
        tabSessionId={SESSION_B}
      />,
    );

    fireEvent.click(
      screen.getByTestId('kiosk-nav-expenses'),
    );

    expect(
      screen.queryByText('Consumo autorizado'),
    ).toBeNull();

    expect(
      props.onRefreshExpenses,
    ).not.toHaveBeenCalled();
  });

  it('n�o mostra gastos de uma sess�o reprovada', () => {
    const props = makeExpensesProps();

    render(
      <DineInExpenses
        {...props}
        tab={makeTab({
          me: {
            role: 'GUEST',
            approved: false,
          },
        })}
      />,
    );

    expect(
      screen.getByText('Comanda n�o dispon�vel'),
    ).toBeTruthy();

    expect(
      screen.queryByText('Consumo autorizado'),
    ).toBeNull();

    expect(
      screen.queryByTestId('kiosk-request-bill'),
    ).toBeNull();
  });

  it('remove gastos da tela quando a sess�o expira', async () => {
    const props = makeAdapterProps();

    const view = render(
      <DineInPremiumMenuAdapter {...props} />,
    );

    await openExpensesInAdapter();

    expect(
      screen.getByText('Consumo autorizado'),
    ).toBeTruthy();

    view.rerender(
      <DineInPremiumMenuAdapter
        {...props}
        verifiedSessionId={null}
        tabSessionId={null}
        sessionAuthorized={false}
        tab={null}
      />,
    );

    await waitFor(() => {
      expect(
        screen.queryByText('Consumo autorizado'),
      ).toBeNull();

      expect(
        screen.queryByText('Consumo de terceiros'),
      ).toBeNull();
    });
  });
});

// =====================================================
// 3. PRIVACIDADE DA COMANDA
// =====================================================

describe('Privacidade dos gastos', () => {
  it('n�o inclui pedidos marcados como de terceiros', () => {
    const result = buildExpenseSummary(
      makeTab(),
      false,
    );

    expect(
      result.lines.some(
        line => line.name === 'Consumo de terceiros',
      ),
    ).toBe(false);
  });

  /**
   * TESTE CR�TICO.
   *
   * O modelo anterior utilizava:
   * round.mine !== false
   *
   * Isso aceita valores undefined.
   *
   * A regra segura �:
   * round.mine === true
   */
  it('n�o considera pedidos sem titular como pr�prios', () => {
    const result = buildExpenseSummary(
      makeTab(),
      false,
    );

    expect(
      result.lines.some(
        line => line.name === 'Consumo sem titular',
      ),
    ).toBe(false);

    expect(result.subtotalCents).toBe(2000);
  });

  it('convidado n�o visualiza a mesa inteira por flag isolada', () => {
    const props = makeExpensesProps();

    render(
      <DineInExpenses
        {...props}
        authorizedTableScope={true}
        tab={makeTab({
          me: {
            role: 'GUEST',
            approved: true,
          },
        })}
      />,
    );

    expect(
      screen.getByText('Consumo autorizado'),
    ).toBeTruthy();

    expect(
      screen.queryByText('Consumo de terceiros'),
    ).toBeNull();
  });

  it('n�o permite solicitar conta encerrada', () => {
    const props = makeExpensesProps();

    render(
      <DineInExpenses
        {...props}
        tab={makeTab({
          status: 'CLOSED',
        })}
      />,
    );

    expect(
      screen.queryByTestId('kiosk-request-bill'),
    ).toBeNull();

    expect(
      props.onRequestBill,
    ).not.toHaveBeenCalled();
  });

  it('n�o permite reabrir conta com PIX pendente', () => {
    const props = makeExpensesProps();

    render(
      <DineInExpenses
        {...props}
        tab={makeTab({
          status: 'AWAITING_PAYMENT',
          pixStatus: 'pending',
        })}
      />,
    );

    expect(
      screen.queryByRole('button', {
        name: /Reabrir comanda/i,
      }),
    ).toBeNull();
  });
});

// =====================================================
// 4. ISOLAMENTO DE ESTABELECIMENTO
// =====================================================

describe('Isolamento de loja', () => {
  it('n�o apresenta produtos de outro tenant', () => {
    const props = makeMenuProps();

    props.products = [
      product('p1', 'Suco da Casa'),

      product(
        'p2',
        'Produto de Outra Loja',
        TENANT_B,
      ),
    ];

    render(
      <DineInPremiumMenu {...props} />,
    );

    expect(
      screen.getByText('Suco da Casa'),
    ).toBeTruthy();

    expect(
      screen.queryByText('Produto de Outra Loja'),
    ).toBeNull();
  });

  it('n�o mistura categorias de estabelecimentos', () => {
    const props = makeMenuProps();

    props.categories = [
      category('bebidas', 'Bebidas'),

      category(
        'privada',
        'Categoria de Outra Loja',
        TENANT_B,
      ),
    ];

    render(
      <DineInPremiumMenu {...props} />,
    );

    expect(
      screen.queryByText('Categoria de Outra Loja'),
    ).toBeNull();
  });

  it('n�o deixa bot�o adicionar contornar bloqueio', () => {
    const props = makeMenuProps();

    render(
      <DineInPremiumMenu
        {...props}
        orderingDisabled={true}
      />,
    );

    const button = screen.getByTestId(
      'kiosk-add-p1',
    ) as HTMLButtonElement;

    expect(button.disabled).toBe(true);

    fireEvent.click(button);

    expect(
      props.onAddProduct,
    ).not.toHaveBeenCalled();
  });
});

// =====================================================
// 5. TEXTO, IMAGENS E CSS
// =====================================================

describe('Prote��o de conte�do visual', () => {
  it('n�o cria elementos HTML a partir do nome', () => {
    const props = makeMenuProps();

    const suspicious =
      '<img src=x onerror=alert(1)>';

    props.products = [
      product('p1', suspicious),
    ];

    const { container } = render(
      <DineInPremiumMenu {...props} />,
    );

    expect(
      screen.getByText(suspicious),
    ).toBeTruthy();

    expect(
      container.querySelector('img[src="x"]'),
    ).toBeNull();
  });

  it('bloqueia esquemas de URL perigosos', () => {
    expect(
      safeMenuImageUrl('javascript:alert(1)'),
    ).toBe('');

    expect(
      safeMenuImageUrl('data:text/html,hello'),
    ).toBe('');

    expect(
      safeMenuImageUrl('file:///secret.txt'),
    ).toBe('');

    expect(
      safeMenuImageUrl('http://example.com/image.png'),
    ).toBe('');
  });

  it('n�o aceita CSS arbitr�rio em cores do tema', () => {
    const props = makeMenuProps();

    const maliciousTheme = {
      ...DEFAULT_MENU_THEME,
      accent: 'red; background:url(javascript:alert(1))',
      radius: 999999,
      fontFamily: 'url(https://example.com/x.css)',
    } as unknown as MenuTheme;

    const { container } = render(
      <DineInPremiumMenu
        {...props}
        menuTheme={maliciousTheme}
      />,
    );

    const root = container.querySelector(
      '[data-testid="dinein-premium-kiosk"]',
    ) as HTMLElement;

    expect(
      root.style.getPropertyValue(
        '--dc-kiosk-accent',
      ),
    ).toBe(DEFAULT_MENU_THEME.accent);

    expect(
      root.style.getPropertyValue(
        '--dc-kiosk-radius',
      ),
    ).toBe(
      `${DEFAULT_MENU_THEME.radius}px`,
    );

    expect(
      root.style.fontFamily,
    ).not.toContain('url(');
  });
});

// =====================================================
// 6. RESPOSTAS ASS�NCRONAS ANTIGAS
// =====================================================

describe('Prote��o contra respostas atrasadas', () => {
  /**
   * TESTE CR�TICO.
   *
   * Se uma consulta come�ar na sess�o A
   * e terminar ap�s o dispositivo mudar para B,
   * a resposta A n�o deve abrir a tela B.
   */
  it('ignora consulta antiga ap�s troca de sess�o', async () => {
    const oldRefresh = deferred();

    const props = makeAdapterProps();

    props.onRefreshExpenses = vi.fn(
      () => oldRefresh.promise,
    );

    const view = render(
      <DineInPremiumMenuAdapter {...props} />,
    );

    fireEvent.click(
      screen.getByTestId('kiosk-nav-expenses'),
    );

    expect(
      props.onRefreshExpenses,
    ).toHaveBeenCalledOnce();

    // Uma nova sess�o foi validada pelo backend.
    view.rerender(
      <DineInPremiumMenuAdapter
        {...props}
        verifiedSessionId={SESSION_B}
        tabSessionId={SESSION_B}
        resetKey="new-session"
        tab={makeTab({
          rounds: [],
          subtotal: 0,
        })}
      />,
    );

    await act(async () => {
      oldRefresh.resolve();
      await oldRefresh.promise;
    });

    expect(
      screen.getByTestId('dinein-premium-kiosk'),
    ).toBeTruthy();

    expect(
      screen.queryByTestId('kiosk-expenses'),
    ).toBeNull();
  });

  /**
   * TESTE CR�TICO.
   *
   * Reset por inatividade deve invalidar
   * consultas iniciadas anteriormente.
   */
  it('n�o reabre gastos ap�s reset do quiosque', async () => {
    const oldRefresh = deferred();

    const props = makeAdapterProps();

    props.onRefreshExpenses = vi.fn(
      () => oldRefresh.promise,
    );

    const view = render(
      <DineInPremiumMenuAdapter
        {...props}
        resetKey={1}
      />,
    );

    fireEvent.click(
      screen.getByTestId('kiosk-nav-expenses'),
    );

    view.rerender(
      <DineInPremiumMenuAdapter
        {...props}
        resetKey={2}
      />,
    );

    await act(async () => {
      oldRefresh.resolve();
      await oldRefresh.promise;
    });

    expect(
      screen.getByTestId('dinein-premium-kiosk'),
    ).toBeTruthy();

    expect(
      screen.queryByTestId('kiosk-expenses'),
    ).toBeNull();
  });

  /**
   * Se a sess�o perder autoriza��o enquanto
   * uma solicita��o estiver pendente, a UI
   * n�o pode continuar mostrando os gastos.
   *
   * O backend deve validar tamb�m a autoriza��o.
   */
  it('oculta dados ap�s perda de autoriza��o', async () => {
    const pending = deferred();

    const props = makeAdapterProps();

    props.onRefreshExpenses = vi.fn(
      async () => {},
    );

    props.onRequestBill = vi.fn(
      () => pending.promise,
    );

    const view = render(
      <DineInPremiumMenuAdapter {...props} />,
    );

    await openExpensesInAdapter();

    fireEvent.click(
      screen.getByTestId('kiosk-request-bill'),
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

    expect(
      props.onRequestBill,
    ).toHaveBeenCalledOnce();

    // O dispositivo perdeu a autoriza��o.
    view.rerender(
      <DineInPremiumMenuAdapter
        {...props}
        sessionAuthorized={false}
        verifiedSessionId={null}
        tabSessionId={null}
        tab={null}
        resetKey={2}
      />,
    );

    await waitFor(() => {
      expect(
        screen.queryByText('Consumo autorizado'),
      ).toBeNull();
    });

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });

    expect(
      screen.queryByText('Consumo autorizado'),
    ).toBeNull();
  });
});

// =====================================================
// 7. OPERA��ES FINANCEIRAS N�O AUTORIZADAS
// =====================================================

describe('Bloqueio de opera��es financeiras', () => {
  it('n�o permite fechar conta sem sess�o v�lida', () => {
    const props = makeAdapterProps();

    render(
      <DineInPremiumMenuAdapter
        {...props}
        sessionAuthorized={false}
        verifiedSessionId={null}
        tabSessionId={null}
        tab={null}
      />,
    );

    fireEvent.click(
      screen.getByTestId('kiosk-nav-expenses'),
    );

    expect(
      screen.queryByTestId('kiosk-request-bill'),
    ).toBeNull();

    expect(
      props.onRequestBill,
    ).not.toHaveBeenCalled();
  });

  it('chamar gar�om n�o executa fechamento', async () => {
    const props = makeExpensesProps();

    render(
      <DineInExpenses {...props} />,
    );

    fireEvent.click(
      screen.getByTestId('kiosk-request-bill'),
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

  it('bot�o fechar conta n�o existe durante pagamento', () => {
    const props = makeExpensesProps();

    render(
      <DineInExpenses
        {...props}
        tab={makeTab({
          status: 'AWAITING_PAYMENT',
          pixStatus: 'pending',
        })}
      />,
    );

    expect(
      screen.queryByTestId('kiosk-request-bill'),
    ).toBeNull();

    expect(
      props.onRequestBill,
    ).not.toHaveBeenCalled();
  });
});
