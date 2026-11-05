## Arquivo 4 � Tela �Meus gastos� do Totem

Agora vamos criar a tela financeira que o cliente acessa pelo menu inferior do totem.

Ela ter� a rela��o dos produtos consumidos, quantidades, valores, subtotal, taxa de servi�o, total e o bot�o Fechar conta. Ao tocar nele, o cliente escolhe como deseja pagar ou solicita um gar�om.

Caminho: `src/features/dineInMenu/DineInExpenses.tsx`

Novo arquivo

React + TypeScript � sem altera��o do banco

```

/**
 * DELIVERY CHANNEL
 * TELA MEUS GASTOS � TOTEM / TABLET
 *
 * IMPORTANTE:
 *
 * 1. N�o realiza pagamentos diretamente.
 * 2. N�o encerra nem libera mesas.
 * 3. N�o consulta dados de outras sess�es.
 * 4. N�o modifica valores financeiros.
 * 5. Utiliza a comanda autorizada pelo backend.
 *
 * Integra��es existentes:
 *
 * - get_my_tab
 * - request_bill
 * - reopen_tab_from_bill
 * - call_waiter
 *
 * A confirma��o financeira e a libera��o
 * da mesa continuam exclusivamente no servidor.
 */

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ArrowLeft,
  Armchair,
  BellRing,
  CheckCircle2,
  CreditCard,
  Loader2,
  QrCode,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';

import type { MenuTheme } from '../../types/menuTheme';

import type {
  StoreHomeDesign,
} from '../storeHome/storeHome.model';

import {
  buildExpenseSummary,
  EXPENSE_PAYMENT_OPTIONS,
  formatMenuMoney,
  resolveMenuVisualTheme,
  type ExpensePaymentAction,
  type ExpenseTab,
} from './dineInMenu.model';

// =====================================================
// 1. CONTRATOS DE INTEGRA��O
// =====================================================

type BillPaymentChoice =
  | 'CARD'
  | 'PIX'
  | 'CAIXA';

export interface DineInExpensesProps {
  /**
   * Dados autorizados retornados por get_my_tab.
   * Nunca aceitar uma comanda definida pelo cliente.
   */
  tab: ExpenseTab | null;

  tableLabel: string;

  menuTheme?: MenuTheme;
  homeDesign?: StoreHomeDesign;

  busy?: boolean;
  loading?: boolean;

  /**
   * Apenas habilitar quando o backend autorizar
   * a visualiza��o dos valores de toda a mesa.
   */
  authorizedTableScope?: boolean;

  onBack: () => void;

  /**
   * O callback deve lan�ar erro se request_bill
   * n�o confirmar o recebimento da solicita��o.
   */
  onRequestBill: (
    choice: BillPaymentChoice,
  ) => Promise<void>;

  /**
   * Chama call_waiter.
   * N�o solicita fechamento financeiro.
   */
  onCallWaiter: () => Promise<void>;

  /**
   * Chama reopen_tab_from_bill.
   * O servidor revalida PIX e status.
   */
  onReopenBill: () => Promise<void>;

  /**
   * Atualiza os valores a partir de get_my_tab.
   */
  onRefresh?: () => Promise<void>;
}

// =====================================================
// 2. INFORMA��ES VISUAIS DE PAGAMENTO
// =====================================================

const PAYMENT_ICONS = {
  CARD_AT_TABLE: CreditCard,
  PIX_AT_TABLE: QrCode,
  PAY_AT_COUNTER: Wallet,
  CALL_WAITER: BellRing,
} as const;

const PAYMENT_DESCRIPTIONS: Record<
  ExpensePaymentAction,
  string
> = {
  CARD_AT_TABLE:
    'Um atendente leva a maquininha at� sua mesa.',

  PIX_AT_TABLE:
    'A equipe orientar� o pagamento PIX na mesa.',

  PAY_AT_COUNTER:
    'Solicite a conta para pagar no caixa.',

  CALL_WAITER:
    'Chame um atendente para tirar suas d�vidas.',
};

// =====================================================
// 3. STATUS DA COMANDA
// =====================================================

function getBillStatusLabel(
  status?: ExpenseTab['status'],
): string {
  switch (status) {
    case 'OPEN':
      return 'Comanda aberta';

    case 'BILL_REQUESTED':
      return 'Conta solicitada';

    case 'WAITER_AUTHORIZED':
      return 'Atendimento autorizado';

    case 'AWAITING_PAYMENT':
      return 'Aguardando pagamento';

    case 'CLOSED':
      return 'Conta encerrada';

    case 'CANCELLED':
      return 'Comanda cancelada';

    default:
      return 'Aguardando atualiza��o';
  }
}

function isBillPending(
  status?: ExpenseTab['status'],
): boolean {
  return status === 'BILL_REQUESTED'
    || status === 'WAITER_AUTHORIZED'
    || status === 'AWAITING_PAYMENT';
}

// =====================================================
// 4. COMPONENTE PRINCIPAL
// =====================================================

export function DineInExpenses({
  tab,
  tableLabel,
  menuTheme,
  homeDesign,
  busy = false,
  loading = false,
  authorizedTableScope = false,
  onBack,
  onRequestBill,
  onCallWaiter,
  onReopenBill,
  onRefresh,
}: DineInExpensesProps) {
  const [paymentModalOpen, setPaymentModalOpen] =
    useState(false);

  const [selectedPayment, setSelectedPayment] =
    useState<ExpensePaymentAction | null>(null);

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const backButtonRef =
    useRef<HTMLButtonElement>(null);

  const paymentCloseRef =
    useRef<HTMLButtonElement>(null);

  const theme = useMemo(
    () => resolveMenuVisualTheme(
      menuTheme,
      homeDesign,
    ),
    [menuTheme, homeDesign],
  );

  /**
   * Sem sess�o aprovada, n�o exibir informa��es
   * de consumo nem valores da comanda.
   */
  const hasAuthorizedSession =
    tab?.me?.approved === true;

  const canShowTableTotal =
    authorizedTableScope
    && hasAuthorizedSession
    && tab?.me?.role === 'RESPONSIBLE';

  const summary = useMemo(() => {
    if (!tab || !hasAuthorizedSession) {
      return null;
    }

    return buildExpenseSummary(
      tab,
      Boolean(canShowTableTotal),
    );
  }, [
    tab,
    hasAuthorizedSession,
    canShowTableTotal,
  ]);

  const isWorking =
    busy || loading || submitting;

  const canRequestBill =
    Boolean(
      summary?.canRequestBill &&
      !isWorking,
    );

  const canReopenBill =
    Boolean(
      summary?.canReopenBill &&
      !isWorking,
    );

  const selectedOption =
    EXPENSE_PAYMENT_OPTIONS.find(
      item => item.id === selectedPayment,
    );

  const totalItems = summary?.lines.reduce(
    (sum, line) => sum + line.quantity,
    0,
  ) ?? 0;

  // Ao abrir a tela, facilita a navega��o.
  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);

  // Foco do di�logo de fechamento.
  useEffect(() => {
    if (paymentModalOpen) {
      paymentCloseRef.current?.focus();
    }
  }, [paymentModalOpen]);

  // Sem sess�o ativa, descartar a sele��o.
  useEffect(() => {
    if (!hasAuthorizedSession) {
      setPaymentModalOpen(false);
      setSelectedPayment(null);
      setError('');
      setMessage('');
    }
  }, [hasAuthorizedSession]);

  // ESC apenas fecha o di�logo enquanto n�o
  // existir uma opera��o em andamento.
  useEffect(() => {
    if (!paymentModalOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !submitting
      ) {
        setPaymentModalOpen(false);
        setSelectedPayment(null);
      }
    };

    window.addEventListener(
      'keydown',
      onKeyDown,
    );

    return () => {
      window.removeEventListener(
        'keydown',
        onKeyDown,
      );
    };
  }, [paymentModalOpen, submitting]);

  function openPaymentOptions() {
    if (!canRequestBill) return;

    setSelectedPayment(null);
    setError('');
    setMessage('');
    setPaymentModalOpen(true);
  }

  // =================================================
  // 5. SOLICITAR FECHAMENTO
  // =================================================

  async function confirmPaymentChoice() {
    if (
      !selectedOption ||
      !summary?.canRequestBill ||
      isWorking
    ) {
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      if (
        selectedOption.id === 'CALL_WAITER'
      ) {
        await onCallWaiter();

        setMessage(
          'Gar�om solicitado. Aguarde o atendimento.',
        );
      } else {
        const choice =
          selectedOption.serverChoice;

        if (!choice) {
          throw new Error(
            'Op��o de pagamento inv�lida.',
          );
        }

        /**
         * A aplica��o principal chama a RPC
         * request_bill com o m�todo selecionado.
         *
         * N�O chamar close_tab aqui.
         */
        await onRequestBill(choice);

        setMessage(
          'Solicita��o enviada. ' +
          'Aguarde a atualiza��o da comanda.',
        );
      }

      setPaymentModalOpen(false);
      setSelectedPayment(null);

      if (onRefresh) {
        try {
          await onRefresh();
        } catch {
          setMessage(
            'Solicita��o enviada. N�o foi poss�vel ' +
            'atualizar a tela agora. Tente atualizar.',
          );
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'N�o foi poss�vel enviar a solicita��o.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  // =================================================
  // 6. REABERTURA DA COMANDA
  // =================================================

  async function handleReopenBill() {
    if (!canReopenBill) return;

    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      /**
       * O backend � quem decide se a comanda
       * ainda pode ser reaberta.
       *
       * N�o alterar o status local manualmente.
       */
      await onReopenBill();

      setMessage(
        'Solicita��o de reabertura conclu�da. ' +
        'Consulte o status atualizado da comanda.',
      );

      if (onRefresh) {
        try {
          await onRefresh();
        } catch {
          setMessage(
            'Reabertura solicitada, mas a atualiza��o ' +
            'da tela n�o foi conclu�da.',
          );
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'N�o foi poss�vel reabrir a comanda.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshAccount() {
    if (!onRefresh || isWorking) return;

    setError('');

    try {
      await onRefresh();
    } catch {
      setError(
        'N�o foi poss�vel atualizar os gastos. ' +
        'Confira sua conex�o.',
      );
    }
  }

  const surfaceStyle = {
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: `${theme.radius}px`,
  };

  const primaryButtonStyle = {
    backgroundColor: theme.accent,
    color: theme.accentText,
  };

  // =================================================
  // 7. INTERFACE
  // =================================================

  return (
    <section
      className="dc-expenses relative flex h-full min-h-0 flex-col overflow-hidden"
      style={{
        backgroundColor: theme.background,
        color: theme.text,
        fontFamily: theme.fontFamily,
      }}
      aria-label="Meus gastos"
      data-testid="kiosk-expenses"
    >
      {/* HEADER */}

      <header
        className="flex shrink-0 items-center justify-between gap-4 border-b border-black/10 px-5 py-4"
        style={surfaceStyle}
      >
        <div className="flex min-w-0 items-center gap-4">
          <button
            ref={backButtonRef}
            type="button"
            onClick={onBack}
            disabled={submitting}
            aria-label="Voltar ao card�pio"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-black/15"
          >
            <ArrowLeft size={27} />
          </button>

          <div className="min-w-0">
            <h1 className="flex items-center gap-3 text-2xl font-black lg:text-3xl">
              <ReceiptText
                size={30}
                aria-hidden="true"
              />
              Meus gastos
            </h1>

            <p className="mt-1 flex items-center gap-2 text-sm opacity-70">
              <Armchair
                size={17}
                aria-hidden="true"
              />
              {tableLabel}
            </p>
          </div>
        </div>

        {onRefresh && (
          <button
            type="button"
            onClick={() => void refreshAccount()}
            disabled={isWorking}
            aria-label="Atualizar gastos"
            className="flex min-h-14 items-center gap-2 rounded-2xl border border-black/15 px-4 font-bold"
          >
            <RefreshCw size={21} />
            <span className="hidden sm:inline">
              Atualizar
            </span>
          </button>
        )}
      </header>

      {/* AVISOS */}

      {error && (
        <p
          role="alert"
          className="mx-5 mt-4 rounded-xl bg-red-100 p-4 text-sm font-semibold text-red-900"
        >
          {error}
        </p>
      )}

      {message && (
        <p
          role="status"
          className="mx-5 mt-4 rounded-xl bg-emerald-100 p-4 text-sm font-semibold text-emerald-950"
        >
          {message}
        </p>
      )}

      {/* SESS�O N�O DISPON�VEL */}

      {!hasAuthorizedSession && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <ShieldCheck
            size={54}
            aria-hidden="true"
          />

          <h2 className="text-2xl font-black">
            Comanda n�o dispon�vel
          </h2>

          <p className="max-w-md text-base opacity-75">
            Entre na sua mesa e aguarde a autoriza��o
            necess�ria para consultar seus gastos.
          </p>

          <button
            type="button"
            onClick={onBack}
            className="min-h-14 rounded-2xl px-7 font-black"
            style={primaryButtonStyle}
          >
            Voltar ao card�pio
          </button>
        </div>
      )}

      {/* DADOS AUTORIZADOS DA COMANDA */}

      {summary && hasAuthorizedSession && (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
            <div className="mx-auto max-w-5xl space-y-5">
              {/* STATUS */}

              <div
                className="flex flex-wrap items-center justify-between gap-4 border border-black/10 p-5"
                style={surfaceStyle}
              >
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider opacity-60">
                    Situa��o atual
                  </p>

                  <strong className="mt-1 block text-xl font-black">
                    {getBillStatusLabel(summary.status)}
                  </strong>
                </div>

                {isBillPending(summary.status) && (
                  <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-bold text-amber-950">
                    Aguardando atendimento
                  </span>
                )}

                {summary.status === 'CLOSED' && (
                  <span className="flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-950">
                    <CheckCircle2 size={18} />
                    Encerrada
                  </span>
                )}
              </div>

              {/* RELA��O DE CONSUMO */}

              <div
                className="overflow-hidden border border-black/10"
                style={surfaceStyle}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-5 py-5">
                  <div>
                    <h2 className="text-xl font-black">
                      Produtos consumidos
                    </h2>

                    <p className="mt-1 text-sm opacity-65">
                      {canShowTableTotal
                        ? 'Consumo autorizado da mesa'
                        : 'Consumo vinculado � sua sess�o'}
                    </p>
                  </div>

                  <span className="rounded-full border border-black/15 px-4 py-2 text-sm font-bold">
                    {totalItems} itens
                  </span>
                </div>

                <div
                  className="grid grid-cols-[minmax(0,1fr)_64px_110px] gap-3 border-b border-black/10 px-5 py-3 text-xs font-bold uppercase opacity-70 sm:grid-cols-[minmax(0,1fr)_90px_140px]"
                  aria-hidden="true"
                >
                  <span>Produto</span>
                  <span className="text-center">
                    Qtd.
                  </span>
                  <span className="text-right">
                    Valor
                  </span>
                </div>

                {summary.lines.length === 0 ? (
                  <p className="px-5 py-10 text-center text-base opacity-65">
                    Nenhum consumo registrado nesta comanda.
                  </p>
                ) : (
                  <ul className="divide-y divide-black/10">
                    {summary.lines.map((line, index) => (
                      <li
                        key={`${index}-${line.name}`}
                        className="grid grid-cols-[minmax(0,1fr)_64px_110px] items-center gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_90px_140px]"
                      >
                        <div className="min-w-0">
                          <p className="break-words text-base font-extrabold">
                            {line.name}
                          </p>

                          <p className="mt-1 text-xs opacity-65">
                            Unit�rio: {formatMenuMoney(
                              line.unitPriceCents,
                            )}
                          </p>
                        </div>

                        <strong className="text-center text-lg tabular-nums">
                          {line.quantity}�
                        </strong>

                        <strong className="text-right text-base tabular-nums">
                          {formatMenuMoney(
                            line.totalCents,
                          )}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* RESUMO FINANCEIRO */}

              <section
                className="space-y-4 border border-black/10 p-5 sm:p-6"
                style={surfaceStyle}
                aria-label="Resumo de gastos"
              >
                <h2 className="text-xl font-black">
                  Resumo da comanda
                </h2>

                <div className="flex items-center justify-between gap-4 text-base">
                  <span>Subtotal</span>

                  <strong className="tabular-nums">
                    {formatMenuMoney(
                      summary.subtotalCents,
                    )}
                  </strong>
                </div>

                {(tab.serviceFeePercent > 0 ||
                  tab.serviceFeeRemoved) && (
                  <div className="flex items-center justify-between gap-4 text-base">
                    <span>
                      Taxa de servi�o
                      {tab.serviceFeeRemoved
                        ? ' (removida)'
                        : ` (${tab.serviceFeePercent}%)`}
                    </span>

                    <strong className="tabular-nums">
                      {formatMenuMoney(
                        summary.serviceFeeCents,
                      )}
                    </strong>
                  </div>
                )}

                <div
                  className="flex items-center justify-between gap-3 border-t border-black/15 pt-5"
                >
                  <div>
                    <p className="text-sm font-bold opacity-70">
                      Total do consumo
                    </p>

                    <p className="mt-1 text-xs opacity-60">
                      {summary.isEstimate
                        ? 'Valor estimado da sua sess�o'
                        : 'Confira o valor final com a equipe'}
                    </p>
                  </div>

                  <strong
                    className="text-3xl font-black tabular-nums sm:text-4xl"
                    style={{
                      color: theme.accent,
                    }}
                  >
                    {formatMenuMoney(
                      summary.totalCents,
                    )}
                  </strong>
                </div>
              </section>
            </div>
          </div>

          {/* RODAP� FIXO DE A��ES */}

          <footer
            className="shrink-0 border-t border-black/10 p-4"
            style={{
              backgroundColor: theme.surface,
            }}
          >
            <div className="mx-auto flex max-w-5xl flex-wrap gap-3">
              {canReopenBill && (
                <button
                  type="button"
                  onClick={() => void handleReopenBill()}
                  disabled={isWorking}
                  className="flex min-h-16 flex-1 items-center justify-center gap-3 rounded-2xl border border-black/20 px-6 text-base font-black disabled:opacity-50"
                >
                  <RotateCcw size={23} />
                  Reabrir comanda
                </button>
              )}

              {summary.canRequestBill && (
                <button
                  type="button"
                  onClick={openPaymentOptions}
                  disabled={!canRequestBill}
                  className="flex min-h-16 flex-1 items-center justify-center gap-3 rounded-2xl px-6 text-lg font-black disabled:opacity-50"
                  style={primaryButtonStyle}
                  data-testid="kiosk-request-bill"
                >
                  <ReceiptText size={27} />
                  Fechar conta
                </button>
              )}

              {!summary.canRequestBill &&
                !summary.canReopenBill && (
                  <p className="flex min-h-16 flex-1 items-center justify-center text-center text-sm font-semibold opacity-70">
                    {getBillStatusLabel(summary.status)}
                    {' � '}consulte a equipe para mais informa��es.
                  </p>
                )}
            </div>
          </footer>
        </>
      )}

      {/* ================================================
          DI�LOGO: COMO DESEJA FECHAR A CONTA?
      ================================================ */}

      {paymentModalOpen && summary && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="dc-expenses-payment-title"
            className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white text-slate-950 shadow-2xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h2
                  id="dc-expenses-payment-title"
                  className="text-xl font-black sm:text-2xl"
                >
                  Como deseja pagar?
                </h2>

                <p className="mt-1 text-sm text-slate-600">
                  Escolha uma op��o de atendimento.
                </p>
              </div>

              <button
                ref={paymentCloseRef}
                type="button"
                aria-label="Fechar op��es"
                disabled={submitting}
                onClick={() => {
                  setPaymentModalOpen(false);
                  setSelectedPayment(null);
                }}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-slate-200"
              >
                <X size={24} />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {EXPENSE_PAYMENT_OPTIONS.map(option => {
                const Icon =
                  PAYMENT_ICONS[option.id];

                const selected =
                  selectedPayment === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={submitting}
                    aria-pressed={selected}
                    onClick={() =>
                      setSelectedPayment(option.id)
                    }
                    className={[
                      'flex w-full items-center gap-4 rounded-2xl',
                      'border-2 p-4 text-left transition',
                      'min-h-[88px] disabled:opacity-50',
                      selected
                        ? 'border-emerald-700 bg-emerald-50'
                        : 'border-slate-200 bg-white',
                    ].join(' ')}
                  >
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-800">
                      <Icon
                        size={29}
                        aria-hidden="true"
                      />
                    </span>

                    <span className="min-w-0 flex-1">
                      <strong className="block text-base font-black">
                        {option.label}
                      </strong>

                      <span className="mt-1 block text-sm text-slate-600">
                        {PAYMENT_DESCRIPTIONS[option.id]}
                      </span>
                    </span>

                    {selected && (
                      <CheckCircle2
                        size={25}
                        className="shrink-0 text-emerald-700"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}

              <p className="rounded-xl bg-slate-100 p-4 text-xs leading-relaxed text-slate-600">
                Esta etapa solicita o atendimento
                para pagamento. A mesa s� ser�
                liberada ap�s a confirma��o
                do pagamento pelo sistema.
              </p>
            </div>

            <footer className="shrink-0 border-t border-slate-200 p-5">
              <button
                type="button"
                disabled={!selectedPayment || submitting}
                onClick={() =>
                  void confirmPaymentChoice()
                }
                className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-emerald-700 px-5 text-lg font-black text-white disabled:opacity-50"
                data-testid="kiosk-confirm-payment-choice"
              >
                {submitting ? (
                  <>
                    <Loader2
                      size={24}
                      className="animate-spin"
                    />
                    Enviando solicita��o...
                  </>
                ) : (
                  <>
                    <ShieldCheck size={24} />
                    Confirmar solicita��o
                  </>
                )}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

export default DineInExpenses;

```

## Como este arquivo se conecta ao Delivery Channel

O componente foi projetado para receber os dados j� autorizados pela RPC `get_my_tab`, sem consultar diretamente o Supabase. Quando o cliente toca em Fechar conta, ele escolhe uma das quatro op��es:

| Op��o                      | Opera��o existente         |
| -------------------------- | -------------------------- |
| Pagar na mesa � maquininha | `request_bill` com `CARD`  |
| PIX na mesa                | `request_bill` com `PIX`   |
| Pagar no balc�o/caixa      | `request_bill` com `CAIXA` |
| Chamar gar�om              | `call_waiter` com `CALL`   |

Aten��o: os callbacks precisam ser conectados aos fluxos reais do `DineInClientApp`. O `requestBill` atual usa o m�todo de pagamento guardado no estado React; o programador dever� adapt�-lo para receber a escolha como argumento, evitando utilizar um valor antigo do estado. O callback deve lan�ar um erro quando a RPC falhar.

A exibi��o de toda a mesa somente deve ser habilitada quando o servidor realmente autorizar essa visualiza��o. Em totens compartilhados ou instalados no balc�o, os dados de consumo n�o podem ficar dispon�veis sem uma sess�o v�lida; o mecanismo de inatividade j� existente dever� encerrar a sess�o e limpar as informa��es exibidas.

### Regra cr�tica de funcionamento

O bot�o Fechar conta significa solicitar o fechamento, n�o efetuar o fechamento definitivo.

A partir da solicita��o aprovada pelo servidor, o Sal�o, o Dashboard e o App do Gar�om devem indicar a mesa em marrom piscando, conforme o mecanismo de status j� existente no Delivery Channel. A reabertura continuar� utilizando `reopen_tab_from_bill`, com valida��o no backend, e a mesa s� ser� liberada depois da confirma��o do pagamento.

Nenhuma migration SQL � necess�ria para este componente.

Pr�ximo arquivo (5): `src/features/dineInMenu/DineInPremiumMenuAdapter.tsx` � integra��o do card�pio Premium, da tela Meus gastos e dos fluxos atuais do totem, sem duplicar as regras de pedidos, pagamento ou mesa.

Nenhum c�digo do reposit�rio foi alterado.