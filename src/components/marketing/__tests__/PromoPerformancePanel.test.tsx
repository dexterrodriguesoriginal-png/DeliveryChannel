// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { PromoPerformancePanel } from '../PromoPerformancePanel';
import { promoPerformanceRepository, type PromoPerformanceResult } from '../../../repositories/promoPerformanceRepository';
import type { Offer } from '../../../types';
import type { SecurityContext } from '../../../services/securityEngine';

vi.mock('../../../repositories/promoPerformanceRepository', () => ({
  promoPerformanceRepository: { getPerformance: vi.fn() },
}));

const card = { id: 'offer-a', tenantId: 'loja-a', title: 'Oferta A', isActive: true, order: 0, hasPromoCheckout: true } as Offer;
const owner: SecurityContext = { userId: 'owner', userName: 'Dono', userRole: 'OWNER', tenantId: 'loja-a' };
const cashier: SecurityContext = { userId: 'cashier', userName: 'Caixa', userRole: 'CASHIER', tenantId: 'loja-a' };
const report = (views: number, clicks: number) => ({
  kind: 'server' as const,
  current: [{
    offer_id: 'offer-a', card_views: views, card_clicks: clicks, valid_orders: 0,
    invalidated_orders: 0, revenue: 0, redeemed_units: 0, discount: 0, last_valid_order_at: null,
  }],
  previous: [],
});
const draw = (securityContext = owner) => render(<PromoPerformancePanel
  tenantId="loja-a" securityContext={securityContext} offers={[card]} onEditCard={() => {}}
/>);

beforeEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Marketing / Desempenho e Vendas', () => {
  it('exibe views e clicks reais retornados pela RPC', async () => {
    vi.mocked(promoPerformanceRepository.getPerformance).mockResolvedValue(report(11, 3));
    draw();
    expect((await screen.findByTestId('events-offer-a')).textContent).toContain('11 / 3');
  });

  it('mostra zero real para período sem eventos, não traço', async () => {
    vi.mocked(promoPerformanceRepository.getPerformance).mockResolvedValue(report(0, 0));
    draw();
    expect((await screen.findByTestId('events-offer-a')).textContent).toContain('0 / 0');
  });

  it('descarta a resposta obsoleta quando o usuário muda de período', async () => {
    const pending: Array<(value: PromoPerformanceResult) => void> = [];
    vi.mocked(promoPerformanceRepository.getPerformance).mockImplementation(
      () => new Promise<PromoPerformanceResult>(resolve => { pending.push(resolve); }),
    );
    draw();
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Últimos 7 dias' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    pending[1](report(22, 4));
    await waitFor(() => expect(screen.getByTestId('events-offer-a').textContent).toContain('22 / 4'));
    pending[0](report(999, 999));
    await waitFor(() => expect(screen.getByTestId('events-offer-a').textContent).toContain('22 / 4'));
  });

  it('não consulta RPC para caixa', async () => {
    draw(cashier);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Somente proprietário ou gerente'));
    expect(promoPerformanceRepository.getPerformance).not.toHaveBeenCalled();
  });
});
