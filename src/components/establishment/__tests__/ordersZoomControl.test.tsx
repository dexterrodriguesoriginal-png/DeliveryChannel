// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { OrdersZoomControl } from '../OrdersZoomControl';
import { OrderStatusPill } from '../OrderStatusPill';

afterEach(cleanup);
describe('controle de zoom', () => {
  it('− / % / + chamam os callbacks e desabilitam nos limites', () => {
    const f = { in: vi.fn(), out: vi.fn(), reset: vi.fn() };
    const ui = render(<OrdersZoomControl zoom={10} onZoomIn={f.in} onZoomOut={f.out} onReset={f.reset} />);
    expect((ui.getByTestId('orders-zoom-out') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(ui.getByTestId('orders-zoom-in')); fireEvent.click(ui.getByTestId('orders-zoom-value'));
    expect(f.in).toHaveBeenCalledTimes(1); expect(f.reset).toHaveBeenCalledTimes(1); expect(f.out).not.toHaveBeenCalled();
    expect(ui.getByTestId('orders-zoom-value').textContent).toBe('10%');
    ui.rerender(<OrdersZoomControl zoom={130} onZoomIn={f.in} onZoomOut={f.out} onReset={f.reset} />);
    expect((ui.getByTestId('orders-zoom-in') as HTMLButtonElement).disabled).toBe(true);
  });
});
describe('selo de status da Lista', () => {
  it.each([['PENDING', '#ef4444'], ['PREPARING', '#f97316'], ['READY', '#a855f7'], ['DELIVERED', '#16a34a'], ['CANCELLED', '#6b7280']] as const)('%s', (status, color) => {
    const ui = render(<OrderStatusPill status={status} />);
    const el = ui.getByTestId('order-status-chip');
    const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    expect([color, `rgb(${r}, ${g}, ${b})`]).toContain(el.style.backgroundColor.toLowerCase());
  });
});
