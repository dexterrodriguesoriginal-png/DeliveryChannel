// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
import { DriverOfferStatus, DriverOffersContext, OfferCountdown, remainingOfferSeconds } from '../DriverOfferStatus';
import { DriverRideOffer } from '../../driver/DriverRideOffer';
import { KanbanOrderCard } from '../../establishment/KanbanOrderCard';
import { CompactOrderCard } from '../../establishment/CompactOrderCard';
import { DriverOffer, MyDriverOffer } from '../../../repositories/driverOfferRepository';
import { Order } from '../../../types';
const NOW = Date.parse('2026-10-26T19:00:00Z');
const offer: DriverOffer = { id: 'of', tenant_id: 't', order_id: 'o', driver_user_id: 'd', status: 'OFFERED', created_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + 60000).toISOString(), responded_at: null };
const mine: MyDriverOffer = { id: 'of', tenant_id: 't', order_id: 'o', order_number: 42, store_name: 'Loja A', neighborhood: 'Centro', delivery_fee: 7.5, expires_at: offer.expires_at };
const order = { id: 'o', orderNumber: 42, status: 'READY', fulfillmentType: 'DELIVERY', customerName: 'Cliente', createdAt: new Date(NOW).toISOString(), items: [], totalAmount: 20 } as unknown as Order;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render(el: React.ReactElement) { await act(async () => root.render(el)); }
async function click(text: string) { const b = [...host.querySelectorAll('button')].find(b => b.textContent === text)!; expect(b).toBeTruthy(); await act(async () => b.click()); }
describe('oferta de corrida na loja e no app do entregador', () => {
  it('contagem regressiva chega a zero sem ficar negativa', async () => {
    await render(<OfferCountdown expiresAt={offer.expires_at} />);
    expect(host.textContent).toBe('60s');
    await act(async () => vi.advanceTimersByTime(1000)); expect(host.textContent).toBe('59s');
    await act(async () => vi.advanceTimersByTime(60000)); expect(host.textContent).toBe('0s');
    expect(remainingOfferSeconds(offer.expires_at, NOW + 120000)).toBe(0);
  });
  it.each([KanbanOrderCard, CompactOrderCard])('card tem uma única ação Chamar entregador que abre a escolha', async Card => {
    const call = vi.fn(), update = vi.fn();
    await render(<Card order={order} density="normal" onSelectOrder={vi.fn()} onUpdateStatus={update} onAssignDriverClick={call} />);
    expect([...host.querySelectorAll('button')].filter(b => b.textContent?.includes('Chamar entregador'))).toHaveLength(1);
    await click('Chamar entregador'); expect(call).toHaveBeenCalledWith(order); expect(update).not.toHaveBeenCalled();
  });
  it.each([KanbanOrderCard, CompactOrderCard])('card com oferta viva mostra selo, timer e cancelamento', async Card => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    await render(<DriverOffersContext.Provider value={{ offers: [offer], cancel }}><Card order={order} density="normal" onSelectOrder={vi.fn()} onUpdateStatus={vi.fn()} onAssignDriverClick={vi.fn()} /></DriverOffersContext.Provider>);
    expect(host.textContent).toContain('Aguardando aceite do entregador'); expect(host.querySelector('[role="timer"]')?.textContent).toBe('60s');
    expect(host.textContent).not.toContain('Chamar entregador'); await click('Cancelar chamada'); expect(cancel).toHaveBeenCalledWith('of');
  });
  it.each(['DECLINED', 'EXPIRED'] as const)('%s permite chamar outro', async status => {
    await render(<DriverOffersContext.Provider value={{ offers: [{ ...offer, status }], cancel: vi.fn() }}><KanbanOrderCard order={order} onSelectOrder={vi.fn()} onUpdateStatus={vi.fn()} onAssignDriverClick={vi.fn()} /></DriverOffersContext.Provider>);
    expect(host.textContent).toContain(status === 'DECLINED' ? 'Entregador recusou' : 'Entregador não respondeu');
    expect(host.textContent).toContain('Chamar outro'); expect(host.textContent).not.toContain('Cancelar chamada');
  });
  it('selo também funciona fora de cards no painel lateral', async () => {
    await render(<DriverOffersContext.Provider value={{ offers: [offer], cancel: vi.fn() }}><DriverOfferStatus orderId="o" /></DriverOffersContext.Provider>);
    expect(host.textContent).toContain('Aguardando aceite do entregador');
  });
  it('tela do entregador mostra dados mínimos e envia aceite ou recusa', async () => {
    const respond = vi.fn(); await render(<DriverRideOffer offer={mine} busy={false} onRespond={respond} />);
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Oferta de corrida');
    expect(host.textContent).toContain('Loja A'); expect(host.textContent).toContain('Centro'); expect(host.textContent).toContain('7,50');
    expect(host.textContent).not.toContain('Cliente');
    await click('Aceitar'); expect(respond).toHaveBeenLastCalledWith(true);
    await click('Recusar'); expect(respond).toHaveBeenLastCalledWith(false);
    await act(async () => vi.advanceTimersByTime(60000));
    expect(host.textContent).toContain('Esta chamada expirou');
    expect([...host.querySelectorAll('button')].every(b => b.disabled)).toBe(true);
  });
  it('impede resposta dupla enquanto a RPC está em andamento', async () => {
    await render(<DriverRideOffer offer={mine} busy onRespond={vi.fn()} />);
    expect([...host.querySelectorAll('button')].every(b => b.disabled)).toBe(true);
  });
});
