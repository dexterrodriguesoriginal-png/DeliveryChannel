// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
const api = vi.hoisted(() => ({ createTabPix: vi.fn(), tabPixStatus: vi.fn(), cancelTabPix: vi.fn(), observeTabPix: vi.fn() }));
const receipts = vi.hoisted(() => ({ target: vi.fn(), send: vi.fn() }));
vi.mock('../../../repositories/paymentRepository', () => ({ paymentRepository: api }));
vi.mock('../../../repositories/tabReceiptRepository', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../repositories/tabReceiptRepository')>();
  return { ...actual, tabReceiptRepository: receipts };
});
import { WaiterTableSheet } from '../WaiterTableSheet';
import { deriveTableStatus } from '../../../lib/salon/tableStatus';
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const tab = { id: 'tab1', table_id: 'table1', status: 'AWAITING_PAYMENT' as const, opened_at: '2026-11-04T00:00:00Z', service_fee_percent: 0, service_fee_removed: false };
const charge = { id: 'pix1', tabId: 'tab1', amountCents: 11000, status: 'pending', brcode: '000201PIX', expiresAt: new Date(Date.now() + 600000).toISOString(), needsReview: false, reviewReason: null, tabClosed: false };
beforeEach(() => { vi.useFakeTimers(); Object.values(api).forEach(m => m.mockReset()); Object.values(receipts).forEach(m => m.mockReset()); api.observeTabPix.mockReturnValue(vi.fn()); receipts.target.mockResolvedValue({ exists: true, maskedEmail: 'jo***@gm***.com' }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('Pagamento na mesa do garçom', () => {
  it('mantém confirmação até Concluir quando snapshot realtime remove a comanda paga', async () => {
    api.tabPixStatus.mockResolvedValue({ pix: charge });
    const done = vi.fn(); const manual = vi.fn();
    const props = { table: { id: 'table1', label: 'Mesa 5', area: null, seats: 4 }, info: { ...deriveTableStatus({ tab, calls: [], sessions: [], rounds: [], now: Date.now() }), totalCents: 11000 }, sessions: [], calls: [], rounds: [], holderSessionId: null, features: { reject: false, openTable: true, requestBill: false, holder: false }, busy: null, message: '', onClose: vi.fn(), onApprove: vi.fn(), onReject: vi.fn(), onHandleCall: vi.fn(), onOpenTable: vi.fn(), onOrder: vi.fn(), onResetHolder: vi.fn(), onTransferHolder: vi.fn(), onConfirmPayment: manual, onPaymentSettled: done };
    const { rerender } = render(<WaiterTableSheet {...props} tab={tab} canCollect />); await flush();
    expect(screen.getByTestId('tab-pix-qr')).toBeTruthy();
    // The active tab disappears as soon as confirm_tab_pix closes it.
    rerender(<WaiterTableSheet {...props} tab={undefined} canCollect={false} />); await flush();
    expect(screen.getByTestId('tab-pix-qr')).toBeTruthy();
    api.tabPixStatus.mockResolvedValue({ pix: { ...charge, status: 'paid', tabClosed: true, paidAt: '2026-11-04T01:10:00Z' } });
    await act(async () => { api.observeTabPix.mock.calls[0][1](); await Promise.resolve(); }); await flush();
    expect(screen.getByRole('heading', { name: 'Pagamento confirmado' })).toBeTruthy();
    expect(screen.getByText(/Destinatário: jo\*\*\*@gm\*\*\*\.com/)).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(done).not.toHaveBeenCalled(); expect(manual).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' })); expect(done).toHaveBeenCalledOnce();
  });
  it('habilita Entregue só depois de Servir e informa Aguardando balcão antes da liberação', () => {
    const deliver = vi.fn();
    const openTab = { ...tab, status: 'OPEN' as const };
    const rounds = ['READY', 'OUT_FOR_DELIVERY', 'PREPARING'].map((status, i) => ({ id: `order${i}`, tab_id: tab.id, order_number: i + 10, customer_name: 'Cliente', status, subtotal: 20, created_at: '2026-11-04T01:00:00Z', round_no: i + 1 }));
    render(<WaiterTableSheet table={{ id: 'table1', label: 'Mesa 5', area: null, seats: 4 }} tab={openTab} info={deriveTableStatus({ tab: openTab, calls: [], sessions: [], rounds, now: Date.now() })} sessions={[]} calls={[]} rounds={rounds} holderSessionId={null} features={{ reject: false, openTable: false, requestBill: false, holder: false }} busy={null} message="" onClose={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} onHandleCall={vi.fn()} onOpenTable={vi.fn()} onOrder={vi.fn()} onResetHolder={vi.fn()} onTransferHolder={vi.fn()} onMarkDelivered={deliver} />);
    const buttons = screen.getAllByRole('button', { name: 'Entregue' });
    expect(buttons).toHaveLength(3);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect(buttons[0].getAttribute('title')).toBe('Aguardando balcão');
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[2] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(buttons[0]); fireEvent.click(buttons[1]); fireEvent.click(buttons[2]);
    expect(deliver.mock.calls).toEqual([['order1']]);
  });
  it.each([false, 'reject'] as const)('não anuncia pagamento confirmado quando o fechamento falha (%s)', async failure => {
    const manual = failure === 'reject' ? vi.fn().mockRejectedValue(new Error('PAYMENT_REJECTED')) : vi.fn().mockResolvedValue(false);
    const authTab = { ...tab, status: 'WAITER_AUTHORIZED' as const };
    render(<WaiterTableSheet table={{ id: 'table1', label: 'Mesa 5', area: null, seats: 4 }} tab={authTab} info={{ ...deriveTableStatus({ tab: authTab, calls: [], sessions: [], rounds: [], now: Date.now() }), totalCents: 5500 }} sessions={[]} calls={[]} rounds={[]} holderSessionId={null} features={{ reject: false, openTable: true, requestBill: false, holder: false }} busy={null} message="" onClose={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} onHandleCall={vi.fn()} onOpenTable={vi.fn()} onOrder={vi.fn()} onResetHolder={vi.fn()} onTransferHolder={vi.fn()} canCollect onConfirmPayment={manual} />);
    fireEvent.change(screen.getByLabelText('Forma de pagamento da conta'), { target: { value: 'CASH' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pagamento recebido' }));
    await flush();
    expect(manual).toHaveBeenCalledWith('CASH');
    expect(screen.queryByRole('heading', { name: 'Pagamento confirmado' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('pagamento');
    expect(receipts.target).not.toHaveBeenCalled();
  });
  it('não reaproveita a confirmação antiga quando outra conta ocupa a mesma mesa', async () => {
    let finishPayment!: (confirmed: boolean) => void;
    const manual = vi.fn().mockReturnValue(new Promise<boolean>(resolve => { finishPayment = resolve; }));
    const original = { ...tab, status: 'WAITER_AUTHORIZED' as const };
    const props = { table: { id: 'table1', label: 'Mesa 5', area: null, seats: 4 }, sessions: [], calls: [], rounds: [], holderSessionId: null, features: { reject: false, openTable: true, requestBill: false, holder: false }, busy: null, message: '', onClose: vi.fn(), onApprove: vi.fn(), onReject: vi.fn(), onHandleCall: vi.fn(), onOpenTable: vi.fn(), onOrder: vi.fn(), onResetHolder: vi.fn(), onTransferHolder: vi.fn(), onConfirmPayment: manual, canCollect: true };
    const { rerender } = render(<WaiterTableSheet {...props} tab={original} info={{ ...deriveTableStatus({ tab: original, calls: [], sessions: [], rounds: [], now: Date.now() }), totalCents: 5500 }} />);
    fireEvent.change(screen.getByLabelText('Forma de pagamento da conta'), { target: { value: 'CASH' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pagamento recebido' }));
    await flush();
    const nextTab = { ...original, id: 'new-tab' };
    rerender(<WaiterTableSheet {...props} tab={nextTab} info={{ ...deriveTableStatus({ tab: nextTab, calls: [], sessions: [], rounds: [], now: Date.now() }), totalCents: 7000 }} />);
    await flush();
    await act(async () => finishPayment(true)); await flush();
    expect(screen.queryByRole('heading', { name: 'Pagamento confirmado' })).toBeNull();
    expect(receipts.target).not.toHaveBeenCalled();
    expect(screen.getAllByText(/70,00/)).toHaveLength(2);
  });
  it.each([true, false])('usa a exigência da rodada após alterar a configuração para %s', globalSetting => {
    const openTab = { ...tab, status: 'OPEN' as const };
    const rounds = [true, false].map((required, i) => ({ id: `r${i}`, tab_id: tab.id, order_number: i + 1, customer_name: 'Ana', status: 'OUT_FOR_DELIVERY', subtotal: 20, created_at: '2026-11-04T01:00:00Z', round_no: i + 1, delivery_code_required: required }));
    render(<WaiterTableSheet table={{ id: 'table1', label: 'Mesa 5', area: null, seats: 4 }} tab={openTab} info={deriveTableStatus({ tab: openTab, calls: [], sessions: [], rounds, now: Date.now() })} sessions={[]} calls={[]} rounds={rounds} holderSessionId={null} features={{ reject: false, openTable: false, requestBill: false, holder: false }} busy={null} message="" onClose={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} onHandleCall={vi.fn()} onOpenTable={vi.fn()} onOrder={vi.fn()} onResetHolder={vi.fn()} onTransferHolder={vi.fn()} onMarkDelivered={vi.fn()} requireDeliveryCode={globalSetting} />);
    expect(screen.getByTestId('waiter-delivery-code-r0')).toBeTruthy();
    expect(screen.queryByTestId('waiter-delivery-code-r1')).toBeNull();
    const buttons = screen.getAllByRole('button', { name: 'Entregue' });
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
  });
  it('exibe botão Fechar conta quando garçom está autorizado (estado roxo) e botão Reabrir conta verde', async () => {
    const authTab = { ...tab, status: 'WAITER_AUTHORIZED' as const };
    const manual = vi.fn().mockResolvedValue(true);
    const reopen = vi.fn();
    render(
      <WaiterTableSheet
        table={{ id: 'table1', label: 'Mesa 5', area: null, seats: 4 }}
        tab={authTab}
        info={{ ...deriveTableStatus({ tab: authTab, calls: [], sessions: [], rounds: [], now: Date.now() }), totalCents: 5500 }}
        sessions={[]}
        calls={[]}
        rounds={[{ id: 'r1', tab_id: authTab.id, order_number: 1, customer_name: 'Ana', status: 'DELIVERED', subtotal: 55, created_at: '2026-11-04T01:00:00Z', round_no: 1 }]}
        holderSessionId={null}
        features={{ reject: false, openTable: true, requestBill: false, holder: false }}
        busy={null}
        message=""
        onClose={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onHandleCall={vi.fn()}
        onOpenTable={vi.fn()}
        onOrder={vi.fn()}
        onResetHolder={vi.fn()}
        onTransferHolder={vi.fn()}
        canCollect
        onConfirmPayment={manual}
        onReopenBill={reopen}
      />,
    );
    const closeBtn = screen.getByTestId('waiter-close-tab-btn');
    expect(closeBtn.textContent).toContain('Fechar conta');
    const reopenBtn = screen.getByTestId('waiter-reopen-tab');
    expect(reopenBtn.style.backgroundColor).toBe('#2DBE4E');
    fireEvent.change(screen.getByLabelText('Forma de pagamento da conta'), { target: { value: 'CASH' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pagamento recebido' }));
    await flush();
    expect(manual).toHaveBeenCalledWith('CASH');
    expect(screen.getByRole('heading', { name: 'Pagamento confirmado' })).toBeTruthy();
  });
});
