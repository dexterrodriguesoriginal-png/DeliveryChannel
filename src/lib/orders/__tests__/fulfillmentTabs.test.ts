import { describe, it, expect } from 'vitest';
import { tabCounts, tabTone, pickupActionLabel, paymentBadge, pickupWaitingMinutes, tabOf } from '../fulfillmentTabs';

const now = Date.now();
const o = (p: any) => ({ id: Math.random().toString(), createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), statusHistory: [], fulfillmentType: 'DELIVERY', status: 'PENDING', ...p });

describe('fulfillmentTabs', () => {
  it('separa por tipo e conta', () => {
    const list = [o({}), o({ fulfillmentType: 'PICKUP' }), o({ fulfillmentType: 'PICKUP', status: 'READY' }), o({ status: 'OUT_FOR_DELIVERY' })] as any;
    expect(tabCounts(list, 'DELIVERY')).toMatchObject({ novo: 1, rota: 1, acionaveis: 1 });
    expect(tabCounts(list, 'PICKUP')).toMatchObject({ novo: 1, pronto: 1, acionaveis: 2 });
    expect(tabOf({ fulfillmentType: 'PICKUP' } as any)).toBe('PICKUP');
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
