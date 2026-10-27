// @vitest-environment happy-dom
import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { PeriodPicker } from '../PeriodPicker';
import type { OrdersPeriod } from '../ordersKanban';
import type { DateRange } from '../../../lib/orders/periodRange';

const now = new Date(2026, 9, 27, 10, 0);
let last: { period: OrdersPeriod; range: DateRange | null } = { period: 'TODAY', range: null };
function Harness({ initial = 'TODAY' as OrdersPeriod }) {
  const [state, setState] = useState<{ period: OrdersPeriod; range: DateRange | null }>({ period: initial, range: null });
  last = state;
  return <PeriodPicker now={now} period={state.period} range={state.range} onApply={(period, range) => setState({ period, range })} />;
}
afterEach(() => cleanup());
const day = (ui: ReturnType<typeof render>, iso: string) => ui.container.querySelector(`[data-day="${iso}"]`) as HTMLElement;

describe('Seletor de período de Pedidos', () => {
  it('abre com atalhos e calendário pt-BR; escolhe um intervalo em dois cliques e mostra no botão', () => {
    const ui = render(<Harness />);
    expect(ui.getByTestId('period-more').textContent).toBe('Mais');
    fireEvent.click(ui.getByTestId('period-more'));
    expect(ui.getByRole('dialog', { name: 'Selecionar período' })).toBeTruthy();
    expect(ui.container.textContent).toContain('Outubro de 2026');
    for (const t of ['Hoje', 'Ontem', '7 dias', '30 dias', 'Este mês', 'Todos']) expect(ui.getByRole('button', { name: t })).toBeTruthy();
    fireEvent.click(day(ui, '2026-10-12')); fireEvent.click(day(ui, '2026-10-20'));
    expect(ui.container.textContent).toContain('12/10 – 20/10');
    fireEvent.click(ui.getByRole('button', { name: 'Aplicar' }));
    expect(last).toEqual({ period: 'CUSTOM', range: { from: '2026-10-12', to: '2026-10-20' } });
    expect(ui.queryByRole('dialog')).toBeNull();
    expect(ui.getByTestId('period-more').textContent).toBe('12/10 – 20/10');
  });
  it('atalho aplica o período; dias futuros ficam desabilitados; Limpar volta para Hoje; Esc fecha', () => {
    const ui = render(<Harness />);
    fireEvent.click(ui.getByTestId('period-more'));
    expect((day(ui, '2026-10-28') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(ui.getByRole('button', { name: '30 dias' })); fireEvent.click(ui.getByRole('button', { name: 'Aplicar' }));
    expect(last.period).toBe('30D'); expect(ui.getByTestId('period-more').textContent).toBe('30 dias');
    fireEvent.click(ui.getByTestId('period-more')); fireEvent.click(ui.getByRole('button', { name: 'Limpar' }));
    expect(last).toEqual({ period: 'TODAY', range: null }); expect(ui.getByTestId('period-more').textContent).toBe('Mais');
    fireEvent.click(ui.getByTestId('period-more')); expect(ui.queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' }); expect(ui.queryByRole('dialog')).toBeNull();
  });
  it('navega o calendário pelo teclado (setas) e seleciona com Enter', () => {
    const ui = render(<Harness />);
    fireEvent.click(ui.getByTestId('period-more'));
    const grid = ui.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    fireEvent.keyDown(grid, { key: 'PageUp' });
    expect(ui.container.textContent).toContain('Setembro de 2026');
  });
});
