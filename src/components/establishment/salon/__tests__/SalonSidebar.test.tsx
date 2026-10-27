// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(cleanup);
import { SalonSidebar, SalonSidebarProps } from '../SalonSidebar';

const base = (over: Partial<SalonSidebarProps> = {}): SalonSidebarProps => ({
  tab: 'OPEN', onTabChange: vi.fn(), now: Date.parse('2026-10-26T15:00:00Z'), busyCallId: null, onSelectTable: vi.fn(), onHandleCall: vi.fn(), onClose: vi.fn(), variant: 'panel',
  openTabs: [{ tabId: 'a', tableId: 't1', tableLabel: 'Mesa 01', kind: 'LONG_STAY', elapsedMinutes: 80, totalCents: 12000, paidPercent: 25, needsReview: true }],
  closedToday: [{ tabId: 'c', tableLabel: 'Mesa 09', totalCents: 5000, closedAt: '2026-10-26T14:00:00Z', needsReview: false }],
  orders: [{ id: 'o', tableId: 't1', tableLabel: 'Mesa 01', orderNumber: 41, roundNo: 2, status: 'PREPARING', subtotalCents: 3000, createdAt: '2026-10-26T14:30:00Z' }],
  calls: [{ id: 'k', tableId: 't1', tableLabel: 'Mesa 01', type: 'HELP', createdAt: '2026-10-26T14:55:00Z' }],
  ...over,
});

describe('SalonSidebar', () => {
  it('lista comandas abertas com % pago, tempo e aviso de PIX para conferir', () => {
    const props = base();
    render(<SalonSidebar {...props} />);
    const row = screen.getByTestId('salon-open-a');
    expect(row.textContent).toContain('Mesa 01');
    expect(row.textContent).toContain('25% pago');
    expect(row.textContent).toContain('1h20');
    expect(row.textContent).toContain('PIX para conferir');
    fireEvent.click(row);
    expect(props.onSelectTable).toHaveBeenCalledWith('t1');
  });
  it('tem as 4 abas com contagem e navega por teclado', () => {
    const props = base();
    render(<SalonSidebar {...props} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.textContent?.replace(/\d+$/, ''))).toEqual(['Abertas', 'Fechadas hoje', 'Pedidos', 'Chamados']);
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(props.onTabChange).toHaveBeenCalledWith('CLOSED');
    fireEvent.click(tabs[3]);
    expect(props.onTabChange).toHaveBeenCalledWith('CALLS');
  });
  it('fechadas hoje mostram 100% pago; pedidos mostram rodada e status', () => {
    const { rerender } = render(<SalonSidebar {...base({ tab: 'CLOSED' })} />);
    expect(screen.getByTestId('salon-closed-c').textContent).toContain('100% pago');
    rerender(<SalonSidebar {...base({ tab: 'ORDERS' })} />);
    expect(screen.getByRole('tabpanel').textContent).toContain('rodada 2');
    expect(screen.getByRole('tabpanel').textContent).toContain('Preparando');
  });
  it('chamados: marcar atendido e estado vazio', () => {
    const props = base({ tab: 'CALLS' });
    const { rerender } = render(<SalonSidebar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Atendido/ }));
    expect(props.onHandleCall).toHaveBeenCalledWith('k');
    rerender(<SalonSidebar {...base({ tab: 'CALLS', calls: [] })} />);
    expect(screen.getByText('Nenhum chamado em aberto.')).toBeTruthy();
  });
  it('gaveta móvel fecha com Escape e pelo botão', () => {
    const props = base({ variant: 'drawer' });
    render(<SalonSidebar {...props} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
