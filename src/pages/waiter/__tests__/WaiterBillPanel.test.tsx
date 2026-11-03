// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
vi.mock('../../../components/establishment/salon/TabPixPanel', () => ({ TabPixPanel: () => <div data-testid="existing-pix-panel">QR Pix pendente</div> }));
import { WaiterBillPanel } from '../WaiterBillPanel';
afterEach(cleanup);
describe('Cobrança pelo garçom autorizado', () => {
  it('escolhe pagamento antes de exibir Pix e exige confirmar recebimento manual', () => {
    const confirm = vi.fn();
    render(<WaiterBillPanel tabId="a" status="WAITER_AUTHORIZED" totalCents={2200} busy={false} onManualConfirm={confirm} onSettled={vi.fn()} />);
    expect(screen.queryByTestId('existing-pix-panel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirmar pagamento recebido' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Forma de pagamento da conta'), { target: { value: 'CASH' } });
    const button = screen.getByRole('button', { name: 'Confirmar pagamento recebido' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith('CASH');
    fireEvent.change(screen.getByLabelText('Forma de pagamento da conta'), { target: { value: 'PIX' } });
    expect(screen.getByTestId('existing-pix-panel')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmar pagamento recebido' })).toBeNull();
  });
  it('Pix pendente permanece visível e não oferece confirmação manual', () => {
    const confirm = vi.fn();
    render(<WaiterBillPanel tabId="a" status="AWAITING_PAYMENT" totalCents={2200} busy={false} onManualConfirm={confirm} onSettled={vi.fn()} />);
    expect(screen.getByText('Aguardando pagamento')).toBeTruthy();
    expect(screen.getByTestId('existing-pix-panel')).toBeTruthy();
    expect((screen.getByLabelText('Forma de pagamento da conta') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Confirmar pagamento recebido' })).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });
});
