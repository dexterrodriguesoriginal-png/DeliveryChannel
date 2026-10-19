import { describe, it, expect } from 'vitest';
import { nextStepFor, canCancelOrder, cancelLabel, waitingLabel, buildOrderAlerts, canAcceptOrders, canCallDriverRole, itemsSummary, addressLine, whatsappLink, newPendingIds, lateThresholdMs } from '../orderAlerts';

const NOW = Date.parse('2026-10-19T20:00:00Z');
const MIN = 60000;
let n = 0;
const o = (status: string, agoMin: number, extra: Record<string, unknown> = {}) => ({
  id: `o${++n}`, orderNumber: n, status, createdAt: new Date(NOW - agoMin * MIN).toISOString(),
  fulfillmentType: 'DELIVERY', items: [], totalAmount: 10, customerName: 'C', customerPhone: '', deliveryAddress: 'Rua A, 1', ...extra,
}) as any;

describe('orderAlerts: Novos / Atrasados / Prontos aguardando entregador', () => {
  const novo1 = o('PENDING', 2), novo2 = o('PENDING', 40);
  const prepOk = o('PREPARING', 10), prepLate = o('PREPARING', 50), confLate = o('CONFIRMED', 90);
  const ready = o('READY', 20), waiting = o('WAITING_FOR_DRIVER', 25), readyWithDriver = o('READY', 20, { driverId: 'd1' });
  const readyPickup = o('READY', 20, { fulfillmentType: 'PICKUP' });
  const done = o('DELIVERED', 300), cancel = o('CANCELLED', 5);
  const all = [done, novo2, prepOk, prepLate, confLate, ready, waiting, readyWithDriver, readyPickup, cancel, novo1];

  it('classifica com o preparo da loja (40 min)', () => {
    const a = buildOrderAlerts(all, { prepMinutes: 40, now: NOW });
    expect(a.novos.map(x => x.id)).toEqual([novo1.id, novo2.id]); // novo no topo
    expect(a.atrasados.map(x => x.id)).toEqual([confLate.id, prepLate.id]); // mais atrasado primeiro
    expect(a.prontosAguardando.map(x => x.id).sort()).toEqual([ready.id, waiting.id].sort());
    expect(a.emPreparo.map(x => x.id)).toEqual([prepOk.id]);
    expect(a.prontosRetirada.map(x => x.id)).toEqual([readyPickup.id]);
    expect(a.total).toBe(8);
  });
  it('sem preparo configurado usa 30 min', () => {
    expect(lateThresholdMs(undefined)).toBe(30 * MIN);
    expect(lateThresholdMs(0)).toBe(30 * MIN);
    expect(lateThresholdMs(15)).toBe(15 * MIN);
    expect(buildOrderAlerts([o('PREPARING', 31)], { now: NOW }).atrasados).toHaveLength(1);
  });
  it('lista vazia = tudo vazio', () => {
    expect(buildOrderAlerts([], { now: NOW })).toEqual({ novos: [], atrasados: [], emPreparo: [], prontosAguardando: [], prontosRetirada: [], total: 0 });
  });
  it('papéis: aceitar e chamar entregador espelham update_order_status', () => {
    for (const r of ['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER']) { expect(canAcceptOrders(r)).toBe(true); expect(canCallDriverRole(r)).toBe(true); }
    for (const r of ['DELIVERY_MANAGER', 'DRIVER', 'CUSTOMER', null]) { expect(canAcceptOrders(r as any)).toBe(false); expect(canCallDriverRole(r as any)).toBe(false); }
  });
  it('resumo de itens, endereço/retirada e WhatsApp', () => {
    expect(itemsSummary({ items: [{ quantity: 2, productName: 'Picanha' }, { quantity: 1, productName: 'Coca 2L' }] as any })).toBe('2x Picanha, 1x Coca 2L');
    expect(itemsSummary({ items: [{ quantity: 1, productName: 'x'.repeat(200) }] as any }, 20)).toHaveLength(20);
    expect(addressLine({ fulfillmentType: 'PICKUP', deliveryAddress: 'Retirada no Balcão' })).toBe('Retirada no local');
    expect(addressLine({ fulfillmentType: 'DELIVERY', deliveryAddress: ' Rua B, 2 ' })).toBe('Rua B, 2');
    expect(whatsappLink('(11) 98888-7777')).toBe('https://wa.me/5511988887777');
    expect(whatsappLink('5511988887777')).toBe('https://wa.me/5511988887777');
    expect(whatsappLink('123')).toBeNull();
  });
  it('pedido novo desde a última leitura toca som; primeira leitura não', () => {
    const a = o('PENDING', 1), b = o('PENDING', 0);
    expect(newPendingIds(null, [a])).toEqual([]);
    expect(newPendingIds(new Set([a.id]), [a, b])).toEqual([b.id]);
    expect(newPendingIds(new Set([a.id]), [a, { ...b, status: 'CONFIRMED' }])).toEqual([]);
  });
});

describe('orderAlerts: fluxo inteiro pelo Dashboard (um botão por etapa)', () => {
  const d = (status: string, extra: Record<string, unknown> = {}) => ({ status, fulfillmentType: 'DELIVERY', ...extra }) as any;
  it('entrega: Aceitar -> Iniciar preparo -> Marcar como pronto -> Chamar entregador', () => {
    expect(nextStepFor(d('PENDING'), 'OWNER')).toMatchObject({ label: 'Aceitar', to: 'CONFIRMED' });
    expect(nextStepFor(d('CONFIRMED'), 'OWNER')).toMatchObject({ label: 'Iniciar preparo', to: 'PREPARING' });
    expect(nextStepFor(d('PREPARING'), 'OWNER')).toMatchObject({ label: 'Marcar como pronto', to: 'READY' });
    expect(nextStepFor(d('READY'), 'OWNER')).toMatchObject({ label: 'Chamar entregador', to: 'WAITING_FOR_DRIVER', note: 'Chamando motoboy' });
    expect(nextStepFor(d('READY', { driverId: 'x' }), 'OWNER')).toBeNull();
    expect(nextStepFor(d('WAITING_FOR_DRIVER'), 'OWNER')).toBeNull();
    expect(nextStepFor(d('OUT_FOR_DELIVERY'), 'OWNER')).toBeNull();
    expect(nextStepFor(d('DELIVERED'), 'OWNER')).toBeNull();
  });
  it('retirada: pronto -> Confirmar retirada (DELIVERED, sem motivo)', () => {
    expect(nextStepFor(d('READY', { fulfillmentType: 'PICKUP' }), 'CASHIER')).toMatchObject({ label: 'Confirmar retirada', to: 'DELIVERED' });
  });
  it('papel sem permissão não vê botão', () => {
    expect(nextStepFor(d('PENDING'), 'DELIVERY_MANAGER')).toBeNull();
    expect(nextStepFor(d('PENDING'), 'DRIVER')).toBeNull();
  });
  it('Recusar/Cancelar como o servidor permite', () => {
    expect(canCancelOrder(d('PENDING'), 'OPERATOR')).toBe(true);
    expect(canCancelOrder(d('PREPARING'), 'OPERATOR')).toBe(false);
    expect(canCancelOrder(d('READY'), 'OWNER')).toBe(true);
    expect(canCancelOrder(d('DELIVERED'), 'OWNER')).toBe(false);
    expect(canCancelOrder(d('PENDING'), 'DELIVERY_MANAGER')).toBe(false);
    expect(cancelLabel(d('PENDING'))).toBe('Recusar');
    expect(cancelLabel(d('CONFIRMED'))).toBe('Cancelar');
    expect(waitingLabel(d('WAITING_FOR_DRIVER'))).toBe('Aguardando um entregador aceitar');
  });
});
