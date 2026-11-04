// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SalonNightStatsCards } from '../SalonNightStatsCards';
import type { SalonNightStats } from '../../../../lib/salon/nightStats';

const stats = (): SalonNightStats => ({
  window_start: '2026-11-04T21:00:00Z', window_end: '2026-11-04T23:00:00Z',
  window_source: 'OPENED_TODAY', timezone: 'America/Sao_Paulo', orders_count: 17,
  tables_served: 12, revenue_cents: 15000, paid_visits: 10, average_ticket_cents: 1500,
  average_stay_seconds: 3900, calls_handled: 5, average_response_seconds: 45, open_tabs: 4,
});
afterEach(cleanup);

describe('cards de movimento do salão', () => {
  it('mostra oito indicadores e horário da abertura no fuso do salão', () => {
    render(<SalonNightStatsCards stats={stats()} />);
    const cards = screen.getByRole('region', { name: 'Estatísticas da noite' });
    expect(within(cards).getAllByRole('term')).toHaveLength(8);
    expect(cards.textContent).toContain('Desde a abertura às 18:00');
    expect(cards.textContent).toMatch(/Faturamento do salãoR\$\s*150,00/);
    expect(cards.textContent).toMatch(/Ticket médio por mesaR\$\s*15,00/);
    expect(cards.textContent).toContain('Permanência média1h05');
    expect(cards.textContent).toContain('Resposta média45 s');
    expect(cards.textContent).toContain('Contas abertas4');
  });

  it('mostra médias sem amostras como traço e mantém zeros válidos', () => {
    render(<SalonNightStatsCards stats={{ ...stats(), window_source: 'LAST_12_HOURS', average_ticket_cents: null, average_stay_seconds: null, average_response_seconds: null, orders_count: 0 }} />);
    expect(screen.getByText('Últimas 12 horas')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('não apresenta zeros durante carregamento ou falha e oferece nova tentativa', () => {
    const refresh = vi.fn();
    const { rerender } = render(<SalonNightStatsCards stats={null} loading />);
    expect(screen.getByRole('status').textContent).toContain('Carregando estatísticas');
    expect(screen.queryByRole('term')).toBeNull();
    rerender(<SalonNightStatsCards stats={null} error="private payload" onRefresh={refresh} />);
    expect(screen.getByRole('status').textContent).toContain('Estatísticas indisponíveis.');
    expect(screen.queryByText('private payload')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
