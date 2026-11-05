import { describe, expect, it } from 'vitest';
import { canReopenBill } from '../../customer/billReopen';
import { deriveTableStatus, TABLE_STATUS_COLOR, type TabLike } from '../../salon/tableStatus';
import { buildExpenseSummary, EXPENSE_PAYMENT_OPTIONS, type ExpenseTab } from '../premiumTotem.model';

const NOW = Date.parse('2026-11-05T18:00:00Z');
const status = (next: TabLike['status'], paidCents = 0) =>
  deriveTableStatus({
    now: NOW, paidCents,
    tab: {
      id: 'tab-1', table_id: 'mesa-4',
      opened_at: new Date(NOW - 60_000).toISOString(),
      status: next,
      service_fee_percent: 10, service_fee_removed: false,
    },
    rounds: [{
      id: 'round-1', tab_id: 'tab-1',
      subtotal: 100, status: 'DELIVERED',
      created_at: new Date(NOW - 30_000).toISOString(),
    }],
  });

const expense = (next: ExpenseTab['status'], pixStatus: string | null = null): ExpenseTab => ({
  status: next, pixStatus, subtotal: 100, serviceFeePercent: 10, serviceFeeRemoved: false,
  me: { role: 'RESPONSIBLE', approved: true },
  rounds: [{
    orderId: 'round-1', status: 'DELIVERED', mine: true, subtotal: 100,
    items: [{ name: 'Porção', quantity: 2, unitPrice: 50, totalPrice: 100 }],
  }],
});

describe('solicitação de fechamento, sem liberação automática', () => {
  it('expõe CARD/PIX/CAIXA apenas como preferências de request_bill', () => {
    expect(EXPENSE_PAYMENT_OPTIONS.map(x => x.serverChoice)).toEqual(['CARD', 'PIX', 'CAIXA', null]);
    expect(EXPENSE_PAYMENT_OPTIONS.some(x => (x.serverChoice as string | null) === 'CLOSED')).toBe(false);
    expect(buildExpenseSummary(expense('OPEN')).canRequestBill).toBe(true);
  });

  it('mantém a mesa ocupada e marrom enquanto o cliente pede a conta', () => {
    expect(status('BILL_REQUESTED').kind).toBe('BILL');
    expect(status('BILL_REQUESTED').tabId).toBe('tab-1');
    expect(TABLE_STATUS_COLOR.BILL).toBe('#8B5A2B');
    expect(buildExpenseSummary(expense('BILL_REQUESTED')).canRequestBill).toBe(false);
    expect(buildExpenseSummary(expense('BILL_REQUESTED')).canReopenBill).toBe(true);
  });

  it('mantém a mesa ocupada enquanto o garçom autoriza', () => {
    expect(status('WAITER_AUTHORIZED').kind).toBe('AUTHORIZED');
    expect(status('WAITER_AUTHORIZED').tabId).toBe('tab-1');
    expect(TABLE_STATUS_COLOR.AUTHORIZED).toBe('#8B5A2B');
  });

  it('mantém a mesa marrom e ocupada durante PIX pendente, inclusive com valor pago parcial', () => {
    const waiting = status('AWAITING_PAYMENT', 5500);
    expect(waiting.kind).toBe('AWAITING_PAYMENT');
    expect(waiting.tabId).toBe('tab-1');
    expect(TABLE_STATUS_COLOR.AWAITING_PAYMENT).toBe('#8B5A2B');
    expect(waiting.paidCents).toBe(5500);
    expect(buildExpenseSummary(expense('AWAITING_PAYMENT', 'pending')).canReopenBill).toBe(false);
    expect(canReopenBill('BILL_REQUESTED', 'pending')).toBe(false);
  });

  it('permite pedir para reabrir antes de PIX ativo e volta a ocupado só se servidor retornar OPEN', () => {
    expect(canReopenBill('BILL_REQUESTED', null)).toBe(true);
    expect(canReopenBill('WAITER_AUTHORIZED', 'creating')).toBe(false);
    expect(status('OPEN').kind).toBe('OCCUPIED');
    expect(status('OPEN').tabId).toBe('tab-1');
  });

  it('não libera mesa somente porque o total foi pago na interface', () => {
    const paidInFullButStillAwaitingServer = status('AWAITING_PAYMENT', 11000);
    expect(paidInFullButStillAwaitingServer.paidPercent).toBe(100);
    expect(paidInFullButStillAwaitingServer.kind).toBe('AWAITING_PAYMENT');
    expect(paidInFullButStillAwaitingServer.tabId).toBe('tab-1');
  });

  it('só aparece como livre depois de CLOSED/CANCELLED confirmado no status da comanda', () => {
    expect(status('CLOSED').kind).toBe('FREE');
    expect(status('CLOSED').tabId).toBeNull();
    expect(status('CANCELLED').kind).toBe('FREE');
    // A transição para CLOSED é responsabilidade do close_tab/servidor.
    expect(buildExpenseSummary(expense('CLOSED')).canRequestBill).toBe(false);
    expect(buildExpenseSummary(expense('CLOSED')).canReopenBill).toBe(false);
  });

  it('calcula total com serviço, sem aplicar taxa se removida', () => {
    const summary = buildExpenseSummary(expense('OPEN'));
    expect(summary.subtotalCents).toBe(10000);
    expect(summary.serviceFeeCents).toBe(1000);
    expect(summary.totalCents).toBe(11000);
    expect(buildExpenseSummary({...expense('OPEN'),serviceFeeRemoved:true}).totalCents).toBe(10000);
    expect(summary.isEstimate).toBe(true);
  });
});
