// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TotemPendingPayments } from '../TotemPendingPayments';
import { totemAccessRepository } from '../../../repositories/totemAccessRepository';
vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true }));
vi.mock('../../../repositories/totemAccessRepository', () => ({ totemAccessRepository: {
  listPendingPayments: vi.fn(), confirmManualPayment: vi.fn(),
} }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
describe('aprovação manual no PDV', () => {
  it('imprime senha numérica apenas depois da resposta do servidor', async () => {
    vi.mocked(totemAccessRepository.listPendingPayments).mockResolvedValue([{ orderId: 'order1', total: 25.8, createdAt: '', expiresAt: '', status: 'awaiting', autoPrintStore: true }]);
    let approve!: (result: { pickupCode: string }) => void;
    vi.mocked(totemAccessRepository.confirmManualPayment).mockImplementation(() => new Promise(resolve => { approve = resolve; }));
    const print = vi.fn();
    window.print = print;
    render(<TotemPendingPayments tenantId="tenant1" />);
    fireEvent.click(await screen.findByText('Confirmar pagamento'));
    expect(print).not.toHaveBeenCalled();
    expect(screen.queryByText('SENHA 123')).toBeNull();
    approve({ pickupCode: '123' });
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(screen.getByText('SENHA 123')).toBeTruthy();
  });
  it('não imprime quando a aprovação falha', async () => {
    vi.mocked(totemAccessRepository.listPendingPayments).mockResolvedValue([{ orderId: 'order2', total: 10, createdAt: '', expiresAt: '', status: 'awaiting', autoPrintStore: true }]);
    vi.mocked(totemAccessRepository.confirmManualPayment).mockRejectedValue(new Error('Falha no servidor'));
    const print = vi.fn();
    window.print = print;
    render(<TotemPendingPayments tenantId="tenant1" />);
    fireEvent.click(await screen.findByText('Confirmar pagamento'));
    await screen.findByText('Falha no servidor');
    expect(print).not.toHaveBeenCalled();
  });
});
