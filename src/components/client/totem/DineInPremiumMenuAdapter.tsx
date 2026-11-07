
/**
 * DELIVERY CHANNEL
 * ADAPTADOR PREMIUM DO TOTEM ? VERS?O 2
 *
 * Seguran?a contra:
 * - Troca de cliente;
 * - Troca de estabelecimento;
 * - Sess?es expiradas;
 * - Reset por inatividade;
 * - Respostas antigas do servidor;
 * - Solicita??es financeiras duplicadas;
 * - Exibi??o de gastos não autorizados.
 *
 * Não faz acesso direto ao banco.
 * Não fecha ou libera mesas.
 * Não altera autentica??o.
 *
 * As RPCs continuam pertencendo
 * ao DineInClientApp.
 */

import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ArrowLeft,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
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
  canReopenBill,
} from '../../../lib/customer/billReopen';

import type {
  ExpenseTab,
} from '../../../lib/menu/premiumTotem.model';

import {
  DineInPremiumMenu,
} from './DineInPremiumMenu';

import {
  DineInExpenses,
} from './DineInExpenses';

// ==============================================
// 1. TIPOS
// ==============================================

export type KioskLocation =
  | 'TABLE'
  | 'COUNTER';

type AdapterScreen =
  | 'MENU'
  | 'LOADING'
  | 'EXPENSES'
  | 'LOCKED'
  | 'ERROR';

type BillChoice =
  | 'CARD'
  | 'PIX'
  | 'CAIXA';

interface ScreenState {
  screen: AdapterScreen;
  scope: string;
}

interface ScopeSnapshot {
  scope: string;
  generation: number;
}

interface RunningOperation {
  id: number;
  scope: string;
  generation: number;
}

export interface DineInPremiumMenuAdapterProps {
  tenantId: string;

  storeName: string;
  storeLogoUrl?: string | null;
  storeTagline?: string;

  location: KioskLocation;
  tableLabel?: string;

  categories: Category[];
  products: Product[];

  menuTheme?: MenuTheme;
  homeDesign?: StoreHomeDesign;

  cartCount: number;
  orderingDisabled: boolean;
  busy?: boolean;
  productColumns?: 1 | 2 | 3;

  verifiedSessionId?: string | null;
  tabSessionId?: string | null;

  sessionAuthorized: boolean;

  tab: ExpenseTab | null;
  expensesLoading?: boolean;

  authorizedTableScope?: boolean;

  onGoHome: () => void;
  onOpenCart: () => void;
  onOpenTable: () => void;
  onOpenKioskMenu?: () => void;

  onAddProduct: (product: Product) => void;
  onOpenProduct: (product: Product) => void;

  onRequestBill: (
    choice: BillChoice,
  ) => Promise<void>;

  onCallWaiter: () => Promise<void>;
  onReopenBill: () => Promise<void>;

  onRefreshExpenses: () => Promise<void>;

  resetKey?: string | number;
}

// ==============================================
// 2. COMPONENTE
// ==============================================

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
  productColumns = 3,

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

  // ==========================================
  // 3. IDENTIDADE DO CONTEXTO
  // ==========================================

  /**
   * Cada combina??o abaixo representa
   * um contexto de navega??o independente.
   *
   * Mudou loja, sessão, local ou resetKey?
   * O contexto anterior deixa de ser v?lido.
   */
  const scope = JSON.stringify([
    tenantId,
    verifiedSessionId ?? null,
    tabSessionId ?? null,
    location,
    resetKey ?? null,
  ]);

  const scopeRef = useRef({
    scope,
    generation: 0,
    mounted: true,
  });

  /**
   * Invalida??o s?ncrona durante renderiza??o:
   * uma resposta anterior não pode voltar
   * a valer ap?s a troca de identidade.
   */
  if (scopeRef.current.scope !== scope) {
    scopeRef.current.scope = scope;
    scopeRef.current.generation += 1;
  }

  const matchingSession =
    Boolean(verifiedSessionId) &&
    Boolean(tabSessionId) &&
    verifiedSessionId === tabSessionId;

  const authorized =
    Boolean(tenantId) &&
    sessionAuthorized &&
    matchingSession &&
    tab?.me?.approved === true &&
    tab.status !== 'CANCELLED';

  const authorizationRef = useRef(authorized);
  if (authorizationRef.current !== authorized) {
    scopeRef.current.generation += 1;
    authorizationRef.current = authorized;
  }

  const [navigation, setNavigation] =
    useState<ScreenState>({
      screen: 'MENU',
      scope,
    });

  const [error, setError] = useState('');

  const [pending, setPending] = useState<{
    scope: string;
    id: number;
  } | null>(null);

  const operationRef =
    useRef<RunningOperation | null>(null);

  const nextOperationIdRef = useRef(0);

  // ==========================================
  // 4. CICLO DE VIDA
  // ==========================================

  useEffect(() => {
    scopeRef.current.mounted = true;

    return () => {
      scopeRef.current.mounted = false;
      scopeRef.current.generation += 1;
    };
  }, []);

  /**
   * Ao trocar o contexto, reiniciar
   * a navega??o sem preservar erros
   * ou respostas anteriores.
   */
  useEffect(() => {
    setNavigation({
      screen: 'MENU',
      scope,
    });

    setError('');
    setPending(null);
  }, [scope]);

  /**
   * Uma perda de autoriza??o não pode
   * deixar a tela de gastos vis?vel.
   */
  useEffect(() => {
    if (!authorized) {
      setNavigation(current => {
        if (
          current.scope !== scope ||
          current.screen === 'EXPENSES' ||
          current.screen === 'LOADING'
        ) {
          return {
            screen: 'MENU',
            scope,
          };
        }

        return current;
      });

      setPending(null);
    }
  }, [authorized, scope]);

  // ==========================================
  // 5. PROTE??O CONTRA RESULTADOS ANTIGOS
  // ==========================================

  function snapshot(): ScopeSnapshot {
    return {
      scope: scopeRef.current.scope,
      generation: scopeRef.current.generation,
    };
  }

  function isSnapshotValid(
    captured: ScopeSnapshot,
  ): boolean {
    return (
      scopeRef.current.mounted &&
      scopeRef.current.scope === captured.scope &&
      scopeRef.current.generation ===
        captured.generation &&
      authorizationRef.current
    );
  }

  function assertAuthorized(): ScopeSnapshot {
    if (!authorized) {
      throw new Error(
        'Sessão expirada ou não autorizada. ' +
        'Entre novamente na mesa.',
      );
    }

    return snapshot();
  }

  function assertSnapshot(
    captured: ScopeSnapshot,
  ) {
    if (!isSnapshotValid(captured)) {
      throw new Error(
        'A sessão mudou durante a opera??o. ' +
        'Os dados anteriores foram descartados.',
      );
    }
  }

  // ==========================================
  // 6. CONTROLE DE OPERA??ES
  // ==========================================

  /**
   * Bloqueia opera??es duplicadas no mesmo
   * contexto e descarta resultados antigos.
   *
   * Uma opera??o antiga de outro contexto
   * não impede a nova sessão de funcionar.
   */
  async function guardedOperation(
    action: () => Promise<void>,
  ): Promise<void> {
    const captured = assertAuthorized();

    const current = operationRef.current;

    if (
      current &&
      current.scope === captured.scope &&
      current.generation ===
        captured.generation
    ) {
      throw new Error(
        'Aguarde a opera??o anterior terminar.',
      );
    }

    const id = ++nextOperationIdRef.current;

    operationRef.current = {
      id,
      scope: captured.scope,
      generation: captured.generation,
    };

    setPending({
      id,
      scope: captured.scope,
    });

    try {
      await action();

      assertSnapshot(captured);
    } finally {
      if (operationRef.current?.id === id) {
        operationRef.current = null;
      }

      if (isSnapshotValid(captured)) {
        setPending(currentPending =>
          currentPending?.id === id
            ? null
            : currentPending,
        );
      }
    }
  }

  const isPending =
    busy ||
    expensesLoading ||
    (pending !== null &&
      pending.scope === scope);

  // ==========================================
  // 7. NAVEGA??O SEGURA
  // ==========================================

  /**
   * A navega??o ? vinculada ao contexto
   * para não reaproveitar uma tela financeira
   * quando outra pessoa entra no totem.
   */
  const effectiveScreen: AdapterScreen =
    navigation.scope !== scope
      ? 'MENU'
      : !authorized &&
          (
            navigation.screen === 'EXPENSES' ||
            navigation.screen === 'LOADING'
          )
        ? 'MENU'
        : navigation.screen;

  function backToMenu() {
    setNavigation({
      screen: 'MENU',
      scope,
    });

    setError('');
  }

  function goHome() {
    backToMenu();
    onGoHome();
  }

  async function openExpenses() {
    if (!authorized) {
      setError(
        location === 'COUNTER'
          ? 'Identifique-se para consultar uma comanda.'
          : 'Entre na mesa e aguarde a autoriza??o.',
      );

      setNavigation({
        screen: 'LOCKED',
        scope,
      });

      return;
    }

    if (isPending) return;

    const captured = snapshot();

    setError('');

    setNavigation({
      screen: 'LOADING',
      scope,
    });

    try {
      await guardedOperation(onRefreshExpenses);

      if (!isSnapshotValid(captured)) {
        return;
      }

      setNavigation({
        screen: 'EXPENSES',
        scope: captured.scope,
      });
    } catch {
      if (!isSnapshotValid(captured)) {
        return;
      }

      setError(
        'Não foi poss?vel atualizar a comanda. ' +
        'Confira a conex?o e tente novamente.',
      );

      setNavigation({
        screen: 'ERROR',
        scope: captured.scope,
      });
    }
  }

  // ==========================================
  // 8. SOLICITA??O DE CONTA
  // ==========================================

  async function requestBill(
    choice: BillChoice,
  ): Promise<void> {
    assertAuthorized();

    if (
      tab?.status !== 'OPEN' ||
      isPending
    ) {
      throw new Error(
        'Esta comanda não est? dispon?vel ' +
        'para solicitar a conta.',
      );
    }

    await guardedOperation(
      () => onRequestBill(choice),
    );
  }

  // ==========================================
  // 9. CHAMAR GAR?OM
  // ==========================================

  async function callWaiter(): Promise<void> {
    assertAuthorized();

    if (
      isPending ||
      tab?.status === 'CLOSED' ||
      tab?.status === 'CANCELLED'
    ) {
      throw new Error(
        'Não foi poss?vel solicitar atendimento ' +
        'neste momento.',
      );
    }

    await guardedOperation(onCallWaiter);
  }

  // ==========================================
  // 10. REABRIR COMANDA
  // ==========================================

  async function reopenBill(): Promise<void> {
    assertAuthorized();

    if (
      isPending ||
      !canReopenBill(
        tab?.status,
        tab?.pixStatus,
      )
    ) {
      throw new Error(
        'A comanda não pode ser reaberta agora.',
      );
    }

    await guardedOperation(onReopenBill);
  }

  // ==========================================
  // 11. ATUALIZAR GASTOS
  // ==========================================

  async function refreshExpenses(): Promise<void> {
    assertAuthorized();

    if (isPending) {
      throw new Error(
        'J? existe uma opera??o em andamento.',
      );
    }

    await guardedOperation(onRefreshExpenses);
  }

  function openTable() {
    if (!authorized || isPending) {
      return;
    }

    onOpenTable();
  }

  // ==========================================
  // 12. CARD?PIO PRINCIPAL
  // ==========================================

  if (effectiveScreen === 'MENU') {
    return (
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
        productColumns={productColumns}
        orderingDisabled={
          orderingDisabled || isPending
        }
        busy={isPending}

        onGoHome={goHome}
        onOpenCart={onOpenCart}
        onOpenTable={openTable}
        onOpenExpenses={() => {
          void openExpenses();
        }}
        onOpenKioskMenu={onOpenKioskMenu}

        onAddProduct={onAddProduct}
        onOpenProduct={onOpenProduct}
      />
    );
  }

  // ==========================================
  // 13. SESS?O N?O AUTORIZADA
  // ==========================================

  if (effectiveScreen === 'LOCKED') {
    return (
      <section
        className="flex h-[100dvh] flex-col items-center justify-center gap-5 bg-slate-950 p-8 text-center text-white"
        data-testid="kiosk-expenses-locked"
      >
        <div className="grid h-24 w-24 place-items-center rounded-full bg-slate-800">
          <LockKeyhole
            size={48}
            aria-hidden="true"
          />
        </div>

        <h1 className="text-3xl font-black">
          Meus gastos
        </h1>

        <p
          role="status"
          className="max-w-lg text-lg text-slate-300"
        >
          {error ||
            '? necess?rio possuir uma sessão autorizada.'}
        </p>

        <button
          type="button"
          onClick={backToMenu}
          className="flex min-h-16 items-center gap-3 rounded-2xl bg-emerald-700 px-8 text-lg font-black text-white"
        >
          <ArrowLeft size={25} />
          Voltar ao card?pio
        </button>
      </section>
    );
  }

  // ==========================================
  // 14. CONSULTA EM ANDAMENTO
  // ==========================================

  if (
    effectiveScreen === 'LOADING' ||
    expensesLoading
  ) {
    return (
      <section
        className="flex h-[100dvh] flex-col items-center justify-center gap-5 bg-slate-950 p-8 text-center text-white"
        data-testid="kiosk-expenses-loading"
      >
        <Loader2
          size={54}
          className="animate-spin text-emerald-400"
        />

        <h1 className="text-2xl font-black">
          Atualizando seus gastos
        </h1>

        <p className="text-slate-300">
          Consultando os valores autorizados.
        </p>
      </section>
    );
  }

  // ==========================================
  // 15. ERRO SEM DADOS FINANCEIROS
  // ==========================================

  if (effectiveScreen === 'ERROR') {
    return (
      <section
        className="flex h-[100dvh] flex-col items-center justify-center gap-5 bg-slate-950 p-8 text-center text-white"
        data-testid="kiosk-expenses-error"
      >
        <ShieldAlert
          size={52}
          className="text-amber-400"
        />

        <h1 className="text-2xl font-black">
          Não foi poss?vel carregar os gastos
        </h1>

        <p
          role="alert"
          className="max-w-lg text-center text-slate-300"
        >
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
          Voltar ao card?pio
        </button>
      </section>
    );
  }

  // ==========================================
  // 16. MEUS GASTOS ? SESS?O V?LIDA
  // ==========================================

  if (!authorized || !tab) {
    return null;
  }

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

        busy={isPending}
        loading={expensesLoading}

        authorizedTableScope={
          authorizedTableScope &&
          location === 'TABLE' &&
          tab.me?.role === 'RESPONSIBLE'
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
