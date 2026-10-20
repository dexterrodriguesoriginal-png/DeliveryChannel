import { describe, it, expect } from 'vitest';
import { tabCounts, tabTone, pickupActionLabel, paymentBadge, pickupWaitingMinutes, tabOf, matchesFulfillmentTab, dineInOrderLabel, resolveDineInTableLabels } from '../fulfillmentTabs';

const now = Date.now();
const o = (p: any) => ({ id: Math.random().toString(), createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), statusHistory: [], fulfillmentType: 'DELIVERY', status: 'PENDING', ...p });

describe('fulfillmentTabs', () => {
  it('separa por tipo e conta', () => {
    const list = [o({}), o({ fulfillmentType: 'PICKUP' }), o({ fulfillmentType: 'PICKUP', status: 'READY' }), o({ status: 'OUT_FOR_DELIVERY' })] as any;
    expect(tabCounts(list, 'DELIVERY')).toMatchObject({ novo: 1, rota: 1, acionaveis: 1 });
    expect(tabCounts(list, 'PICKUP')).toMatchObject({ novo: 1, pronto: 1, acionaveis: 2 });
    expect(tabOf({ fulfillmentType: 'PICKUP' } as any)).toBe('PICKUP');
  });
  it('mantém salão fora das abas Entrega/Retirada e formata mesa, cliente e rodada', () => {
    const dineIn = o({ fulfillmentType: 'DINE_IN', customerName: 'Ana', tableLabel: 'N', roundNo: 3 });
    expect(matchesFulfillmentTab(dineIn, 'DELIVERY')).toBe(false);
    expect(matchesFulfillmentTab(dineIn, 'PICKUP')).toBe(false);
    expect(matchesFulfillmentTab(dineIn, 'DINE_IN')).toBe(true);
    expect(matchesFulfillmentTab(dineIn, 'ALL')).toBe(true);
    expect(dineInOrderLabel(dineIn)).toBe('Mesa N – Ana · rodada 3');
    expect(dineInOrderLabel({ ...dineIn, tableLabel: undefined, roundNo: undefined })).toBe('Mesa — – Ana');
    const orders = [o({ id: 'tabbed', fulfillmentType: 'DINE_IN', tabId: 'tab-1' }), o({ id: 'existing', fulfillmentType: 'DINE_IN', tabId: 'tab-2', tableLabel: 'Sala 2' })] as any;
    expect(resolveDineInTableLabels(orders, new Map([['tabbed', 'Mesa 1'], ['existing', 'ignored']])).map(order => order.tableLabel))
      .toEqual(['Mesa 1', 'Sala 2']);
  });
  it('uses the label returned for the order without requiring dining-table read access', () => {
    const order = o({ id: 'operator-order', fulfillmentType: 'DINE_IN', tableLabel: undefined });
    expect(dineInOrderLabel(resolveDineInTableLabels(
      [order] as any,
      new Map([['operator-order', 'Varanda 4']])
    )[0])).toBe('Mesa Varanda 4');
  });
  it('atrasado vira vermelho', () => {
    const late = o({ status: 'PREPARING', createdAt: new Date(now - 60 * 60000).toISOString() });
    const c = tabCounts([late] as any, 'DELIVERY', 25);
    expect(c.atrasado).toBe(1);
    expect(tabTone(c)).toBe('red');
  });
  it('rótulos de retirada nunca despacham', () => {
    expect(pickupActionLabel('PENDING')).toBe('Aceitar');
    expect(pickupActionLabel('PREPARING')).toBe('Marcar como pronto');
    expect(pickupActionLabel('READY')).toBe('Confirmar retirada');
    expect(pickupActionLabel('OUT_FOR_DELIVERY')).toBeNull();
  });
  it('selo de pagamento', () => {
    expect(paymentBadge({ paymentStatus: 'PAID' } as any).label).toBe('Pago online');
    expect(paymentBadge({ paymentStatus: 'PAYMENT_ON_DELIVERY' } as any).label).toBe('Pagar na retirada');
  });
  it('tempo aguardando desde PRONTO', () => {
    const r = o({ status: 'READY', statusHistory: [{ status: 'READY', timestamp: new Date(now - 7 * 60000).toISOString() }] });
    expect(pickupWaitingMinutes(r, now)).toBe(7);
    expect(pickupWaitingMinutes(o({}), now)).toBeNull();
  });
});
