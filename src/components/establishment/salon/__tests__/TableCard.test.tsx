// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(cleanup);
import { TableCard, tableAriaLabel } from '../TableCard';
import { deriveTableStatus } from '../../../../lib/salon/tableStatus';

const NOW = Date.parse('2026-10-26T15:00:00Z');
const tab = (min: number, status: 'OPEN' | 'BILL_REQUESTED' = 'OPEN') => ({ id: 'tab1', table_id: 't1', status, opened_at: new Date(NOW - min * 60000).toISOString(), service_fee_percent: 10, service_fee_removed: false });
const rounds = [{ id: 'r', tab_id: 'tab1', status: 'CONFIRMED', subtotal: 100, created_at: '' }];

describe('TableCard', () => {
  it('mesa livre: número grande, lugares e nenhuma barra de pagamento', () => {
    const info = deriveTableStatus({ now: NOW });
    const onOpen = vi.fn();
    render(<TableCard id="t1" label="Mesa 07" area="Varanda" seats={4} info={info} onOpen={onOpen} />);
    const button = screen.getByTestId('salon-table-t1');
    expect(button.getAttribute('data-status')).toBe('FREE');
    expect(button.textContent).toContain('7');
    expect(button.textContent).toContain('4 lugares');
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith('t1');
  });
  it('ocupada: total parcial com taxa, tempo e % pago acessíveis', () => {
    const info = deriveTableStatus({ tab: tab(25), rounds, paidCents: 5500, now: NOW });
    render(<TableCard id="t1" label="Mesa 07" area={null} seats={4} info={info} onOpen={() => {}} />);
    expect(screen.getByTestId('salon-total-t1').textContent).toMatch(/110,00/);
    expect(screen.getByTestId('salon-elapsed-t1').textContent).toContain('25');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByTestId('salon-table-t1').getAttribute('aria-label')).toContain('50% pago');
  });
  it('estados: longa permanência, conta pedida e sino de chamado', () => {
    const long = deriveTableStatus({ tab: tab(75), rounds, now: NOW, longStayMinutes: 60 });
    const bill = deriveTableStatus({ tab: tab(10, 'BILL_REQUESTED'), rounds, now: NOW });
    const call = deriveTableStatus({ tab: tab(5), rounds, calls: [{ id: 'c', tab_id: 'tab1', type: 'CALL', status: 'OPEN', created_at: '' }], now: NOW });
    const { rerender } = render(<TableCard id="t1" label="Mesa 1" area={null} seats={2} info={long} onOpen={() => {}} />);
    expect(screen.getByTestId('salon-table-t1').getAttribute('data-status')).toBe('LONG_STAY');
    rerender(<TableCard id="t1" label="Mesa 1" area={null} seats={2} info={bill} onOpen={() => {}} />);
    expect(screen.getByTestId('salon-table-t1').getAttribute('data-status')).toBe('BILL');
    expect(screen.queryByTestId('salon-bell-t1')).toBeNull();
    rerender(<TableCard id="t1" label="Mesa 1" area={null} seats={2} info={call} onOpen={() => {}} />);
    expect(screen.getByTestId('salon-bell-t1')).toBeTruthy();
    expect(screen.getByTestId('salon-table-t1').className).toContain('salon-card--CALL');
    expect(tableAriaLabel('Mesa 1', call, 2)).toContain('chamando o garçom');
  });
  it('PIX para conferir aparece no rótulo acessível', () => {
    const info = deriveTableStatus({ tab: tab(5), rounds, needsReview: true, now: NOW });
    expect(tableAriaLabel('Mesa 1', info, 2)).toContain('PIX para conferir');
  });
});
