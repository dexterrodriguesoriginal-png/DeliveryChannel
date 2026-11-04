// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
const api = vi.hoisted(() => ({ createTabPix: vi.fn(), tabPixStatus: vi.fn(), cancelTabPix: vi.fn(), observeTabPix: vi.fn() }));
const receipts = vi.hoisted(() => ({ target: vi.fn(), send: vi.fn() }));
vi.mock('../../../repositories/paymentRepository', () => ({ paymentRepository: api }));
vi.mock('../../../repositories/tabReceiptRepository', () => ({ tabReceiptRepository: receipts }));
import { WaiterTableSheet } from '../WaiterTableSheet';
import { deriveTableStatus } from '../../../lib/salon/tableStatus';
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const tab = { id: 'tab1', table_id: 'table1', status: 'AWAITING_PAYMENT' as const, opened_at: '2026-11-04T00:00:00Z', service_fee_percent: 0, service_fee_removed: false };
const charge = { id: 'pix1', tabId: 'tab1', amountCents: 11000, status: 'pending', brcode: '000201PIX', expiresAt: new Date(Date.now() + 600000).toISOString(), needsReview: false, reviewReason: null, tabClosed: false };
beforeEach(() => { vi.useFakeTimers(); Object.values(api).forEach(m => m.mockReset()); api.observeTabPix.mockReturnValue(vi.fn()); receipts.target.mockResolvedValue({ exists: true, maskedEmail: 'jo***@gm***.com' }); });
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
});
