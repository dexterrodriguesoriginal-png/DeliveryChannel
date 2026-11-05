## Arquivo 5 � Adaptador do Card�pio Premium com o sistema atual

Este arquivo conecta o novo card�pio do totem � tela Meus gastos, sem criar outra l�gica de pedidos, pagamentos ou fechamento de mesa.

Novo arquivo

React + TypeScript

Caminho: `src/features/dineInMenu/DineInPremiumMenuAdapter.tsx`

O adaptador vai controlar tr�s situa��es: navega��o no card�pio, acesso autorizado a Meus gastos e retorno seguro ao menu ap�s o encerramento da sess�o.

```

/**
 * DELIVERY CHANNEL
 * ADAPTADOR DO CARD�PIO PREMIUM � TOTEM/TABLET
 *
 * Responsabilidades:
 *
 * - Conectar o card�pio premium ao sistema existente.
 * - Controlar a navega��o para "Meus gastos".
 * - Proteger informa��es de consumo em totens p�blicos.
 * - Reutilizar os callbacks de pedido e pagamento.
 * - Limpar a navega��o ao mudar de sess�o.
 *
 * N�O executa SQL.
 * N�O cria ou finaliza pagamentos.
 * N�O libera mesas.
 * N�O modifica autentica��o.
 *
 * As RPCs continuam em DineInClientApp.
 */

import React, {
  useEffect,
  useState,
} from 'react';

import {
  ArrowLeft,
  Loader2,
  LockKeyhole,
  RefreshCw,
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

import type {
  ExpenseTab,
} from './dineInMenu.model';

import {
  DineInPremiumMenu,
} from './DineInPremiumMenu';

import {
  DineInExpenses,
} from './DineInExpenses';

// =====================================================
// 1. TIPOS
// =====================================================

export type KioskLocation =
  | 'TABLE'
  | 'COUNTER';

type AdapterScreen =
  | 'MENU'
  | 'EXPENSES';

type BillChoice =
  | 'CARD'
  | 'PIX'
  | 'CAIXA';

export interface DineInPremiumMenuAdapterProps {
  // Identidade da loja resolvida pelo backend.
  tenantId: string;
  storeName: string;
  storeLogoUrl?: string | null;
  storeTagline?: string;

  // TABLE = totem instalado na mesa.
  // COUNTER = totem compartilhado no balc�o.
  location: KioskLocation;
  tableLabel?: string;

  categories: Category[];
  products: Product[];

  menuTheme?: MenuTheme;
  homeDesign?: StoreHomeDesign;

  cartCount: number;
  orderingDisabled: boolean;
  busy?: boolean;

  /**
   * Sess�o efetivamente verificada pelo backend.
   *
   * N�o considerar um ID salvo em localStorage
   * como prova de autoriza��o.
   */
  verifiedSessionId?: string | null;

  /**
   * Associa��o expl�cita entre os dados da
   * comanda e a sess�o que os carregou.
   *
   * Essencial para n�o exibir a comanda anterior.
   */
  tabSessionId?: string | null;

  /**
   * Deve vir da autoriza��o j� verificada
   * pelo aplicativo principal.
   */
  sessionAuthorized: boolean;

  /**
   * Dados autorizados de get_my_tab.
   */
  tab: ExpenseTab | null;

  expensesLoading?: boolean;

  /**
   * Permiss�o confirmada pelo backend para
   * mostrar o consumo de toda a mesa.
   */
  authorizedTableScope?: boolean;

  // Navega��o existente.
  onGoHome: () => void;
  onOpenCart: () => void;
  onOpenTable: () => void;
  onOpenKioskMenu?: () => void;

  // Carrinho/pedido existentes.
  onAddProduct: (product: Product) => void;
  onOpenProduct: (product: Product) => void;

  // Opera��es financeiras existentes.
  onRequestBill: (
    choice: BillChoice
  ) => Promise<void>;

  onCallWaiter: () => Promise<void>;
  onReopenBill: () => Promise<void>;

  /**
   * Atualizar a comanda por get_my_tab.
   * Deve lan�ar erro se a consulta falhar.
   */
  onRefreshExpenses: () => Promise<void>;

  /**
   * Alterar quando o totem for reiniciado
   * por inatividade ou troca de usu�rio.
   *
   * O componente TotemKioskLayer existente
   * continua respons�vel pelo timer.
   */
  resetKey?: string | number;
}

// =====================================================
// 2. COMPONENTE
// =====================================================

export function DineInPremiumMenuAdapter({
  tenantId,
  storeName,
  storeLogoUrl,
  storeTagline,

  location,
  tableLabel,

  categories,
  products,

  menuTheme,
  homeDesign,

  cartCount,
  orderingDisabled,
  busy = false,

  verifiedSessionId,
  tabSessionId,
  sessionAuthorized,
  tab,
  expensesLoading = false,
  authorizedTableScope = false,

  onGoHome,
  onOpenCart,
  onOpenTable,
  onOpenKioskMenu,

  onAddProduct,
  onOpenProduct,

  onRequestBill,
  onCallWaiter,
  onReopenBill,
  onRefreshExpenses,

  resetKey,
}: DineInPremiumMenuAdapterProps) {
  const [screen, setScreen] =
    useState<AdapterScreen>('MENU');

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState('');

  /**
   * S� exibimos consumo quando todos os
   * v�nculos necess�rios est�o v�lidos.
   *
   * Isto � uma prote��o de apresenta��o.
   * A autoriza��o definitiva pertence � RPC.
   */
  const hasMatchingSession =
    Boolean(verifiedSessionId) &&
    Boolean(tabSessionId) &&
    verifiedSessionId === tabSessionId;

  const canViewExpenses =
    sessionAuthorized &&
    hasMatchingSession &&
    tab?.me?.approved === true;

  /**
   * N�o mantenha informa��es de consumo
   * vis�veis quando a sess�o deixa de ser v�lida.
   */
  useEffect(() => {
    if (!canViewExpenses) {
      setScreen('MENU');
      setError('');
      setRefreshing(false);
    }
  }, [canViewExpenses]);

  /**
   * Reinicia a navega��o quando o backend
   * troca a sess�o, tenant ou dispositivo.
   */
  useEffect(() => {
    setScreen('MENU');
    setError('');
    setRefreshing(false);
  }, [
    tenantId,
    verifiedSessionId,
    resetKey,
    location,
  ]);

  async function openExpenses() {
    setError('');

    if (!canViewExpenses) {
      setScreen('EXPENSES');
      setError(
        location === 'COUNTER'
          ? 'Para consultar gastos no totem do balc�o, ' +
            'identifique-se e vincule uma comanda autorizada.'
          : 'Entre na mesa e aguarde sua autoriza��o ' +
            'para consultar os gastos.',
      );
      return;
    }

    setRefreshing(true);

    try {
      await onRefreshExpenses();
      setScreen('EXPENSES');
    } catch {
      setError(
        'N�o foi poss�vel atualizar a comanda. ' +
        'Tente novamente.',
      );
      setScreen('EXPENSES');
    } finally {
      setRefreshing(false);
    }
  }

  function backToMenu() {
    setScreen('MENU');
    setError('');
  }

  /**
   * Protege callbacks financeiros contra
   * execu��o quando a sess�o n�o corresponde
   * mais aos dados carregados.
   *
   * O servidor deve repetir todas as checagens.
   */
  function requireAuthorizedSession() {
    if (!canViewExpenses) {
      throw new Error(
        'Sess�o n�o autorizada ou expirada. ' +
        'Atualize sua identifica��o.',
      );
    }
  }

  async function requestBill(
    choice: BillChoice,
  ) {
    requireAuthorizedSession();

    if (tab?.status !== 'OPEN') {
      throw new Error(
        'A comanda n�o est� aberta para ' +
        'uma nova solicita��o.',
      );
    }

    await onRequestBill(choice);
  }

  async function callWaiter() {
    requireAuthorizedSession();
    await onCallWaiter();
  }

  async function reopenBill() {
    requireAuthorizedSession();
    await onReopenBill();
  }

  async function refreshExpenses() {
    requireAuthorizedSession();
    await onRefreshExpenses();
  }

  /**
   * Importante: o cliente n�o muda de mesa
   * diretamente. O callback deve abrir o
   * fluxo de autoriza��o j� existente.
   */
  function handleTableAction() {
    if (
      !sessionAuthorized ||
      !verifiedSessionId
    ) {
      return;
    }

    onOpenTable();
  }

  const menu = (
    <DineInPremiumMenu
      tenantId={tenantId}
      storeName={storeName}
      storeLogoUrl={storeLogoUrl}
      storeTagline={storeTagline}
      tableLabel={
        location === 'TABLE'
          ? tableLabel
          : undefined
      }
      categories={categories}
      products={products}
      menuTheme={menuTheme}
      homeDesign={homeDesign}
      cartCount={cartCount}
      orderingDisabled={orderingDisabled}
      busy={busy}
      onGoHome={onGoHome}
      onOpenCart={onOpenCart}
      onOpenTable={handleTableAction}
      onOpenExpenses={() => {
        void openExpenses();
      }}
      onOpenKioskMenu={onOpenKioskMenu}
      onAddProduct={onAddProduct}
      onOpenProduct={onOpenProduct}
    />
  );

  if (screen === 'MENU') {
    return menu;
  }

  // =================================================
  // 3. SESS�O N�O AUTORIZADA
  // =================================================

  if (!canViewExpenses) {
    return (
      <section
        className="flex h-[100dvh] flex-col items-center justify-center gap-5 bg-slate-950 p-8 text-center text-white"
        data-testid="kiosk-expenses-locked"
      >
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-800">
          <LockKeyhole size={48} />
        </div>

        <h2 className="text-3xl font-black">
          Meus gastos
        </h2>

        <p
          role="status"
          className="max-w-lg text-lg text-slate-300"
        >
          {error ||
            'Voc� precisa de uma sess�o autorizada ' +
            'para consultar esta comanda.'}
        </p>

        <button
          type="button"
          onClick={backToMenu}
          className="flex min-h-16 items-center gap-3 rounded-2xl bg-emerald-700 px-8 text-lg font-black text-white"
        >
          <ArrowLeft size={25} />
          Voltar ao card�pio
        </button>
      </section>
    );
  }

  // =================================================
  // 4. ATUALIZA��O DE CONSUMO
  // =================================================

  if (refreshing || expensesLoading) {
    return (
      <section
        className="flex h-[100dvh] flex-col items-center justify-center gap-5 bg-slate-950 p-8 text-center text-white"
        data-testid="kiosk-expenses-loading"
      >
        <Loader2
          size={54}
          className="animate-spin text-emerald-400"
        />

        <h2 className="text-2xl font-black">
          Atualizando seus gastos
        </h2>

        <p className="text-slate-300">
          Consultando os valores da comanda.
        </p>
      </section>
    );
  }

  // =================================================
  // 5. FALHA DE ATUALIZA��O
  // =================================================

  if (error) {
    return (
      <section
        className="flex h-[100dvh] flex-col items-center justify-center gap-5 bg-slate-950 p-8 text-center text-white"
        data-testid="kiosk-expenses-error"
      >
        <h2 className="text-2xl font-black">
          N�o foi poss�vel carregar os gastos
        </h2>

        <p role="alert" className="max-w-lg text-slate-300">
          {error}
        </p>

        <button
          type="button"
          onClick={() => {
            void openExpenses();
          }}
          className="flex min-h-16 items-center gap-3 rounded-2xl bg-emerald-700 px-8 text-lg font-black text-white"
        >
          <RefreshCw size={23} />
          Tentar novamente
        </button>

        <button
          type="button"
          onClick={backToMenu}
          className="min-h-14 rounded-2xl border border-white/30 px-8 font-bold"
        >
          Voltar ao card�pio
        </button>
      </section>
    );
  }

  // =================================================
  // 6. MEUS GASTOS
  // =================================================

  return (
    <div
      className="h-[100dvh] w-full overflow-hidden"
      data-testid="kiosk-expenses-adapter"
    >
      <DineInExpenses
        tab={tab}
        tableLabel={
          tableLabel || 'Comanda'
        }
        menuTheme={menuTheme}
        homeDesign={homeDesign}
        busy={busy}
        loading={expensesLoading}
        authorizedTableScope={
          authorizedTableScope &&
          location === 'TABLE' &&
          tab?.me?.role === 'RESPONSIBLE'
        }
        onBack={backToMenu}
        onRequestBill={requestBill}
        onCallWaiter={callWaiter}
        onReopenBill={reopenBill}
        onRefresh={refreshExpenses}
      />
    </div>
  );
}

export default DineInPremiumMenuAdapter;

```

## Como esse adaptador dever� funcionar

Card�pio e carrinho

Os produtos continuam utilizando `onAddProduct`, `onOpenProduct` e `onOpenCart` do sistema atual. Nenhum pedido � gravado diretamente pelo adaptador.

Meus gastos

S� exibe a comanda quando o aplicativo principal confirma uma sess�o v�lida e os dados pertencem �quela sess�o.

Fechar conta

Encaminha a forma de pagamento selecionada para a opera��o financeira existente. N�o encerra a mesa por conta pr�pria.

Seguran�a do totem

O controle de inatividade permanece no `TotemKioskLayer`. O adaptador oculta dados quando a autoriza��o desaparece ou a sess�o muda.

## Aten��o ao integrar

H� tr�s pontos importantes para o programador:

1\. `get_my_tab` deve continuar sendo a fonte dos gastos. O aplicativo principal precisa associar a resposta � sess�o efetivamente consultada e passar essa associa��o como `tabSessionId`. N�o basta receber o ID de uma sess�o do navegador.

2\. Totem no balc�o exige prote��o adicional. O c�digo bloqueia os gastos sem autoriza��o, mas a identifica��o do cliente e a limpeza de dados entre usu�rios devem ser garantidas pelo fluxo principal. Uma sess�o antiga n�o pode permanecer dispon�vel para o pr�ximo cliente.

3\. N�o substituir `request_bill` ou `reopen_tab_from_bill`. A solicita��o da conta deve continuar acionando os estados que j� alimentam os indicadores marrons do Sal�o, do Dashboard e do Gar�om. A mesa s� ser� liberada mediante confirma��o financeira pelo backend.

Este adaptador � uma proposta de integra��o. Ele ainda n�o foi compilado ou testado no workspace atual, e depende de callbacks adequadamente conectados no `DineInClientApp`.

Pr�ximo arquivo (6): integra��o localizada no `src/pages/client/DineInClientApp.tsx`, mostrando exatamente quais imports, estados e callbacks devem ser conectados ao adaptador, sem substituir o arquivo inteiro ou alterar o aplicativo do cliente no celular.

Nenhum arquivo do projeto foi modificado.