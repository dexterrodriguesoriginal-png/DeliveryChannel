import { describe, it, expect } from 'vitest';
import { normalizeHandoffCode, isCompleteHandoffCode, driverEarning, pickDriverActiveOrder, handoffErrorMessage, wrongCodeMessage, storeDeliveredNeedsReason } from '../handoff';

describe('handoff', () => {
  it('normaliza o código para 4 dígitos', () => {
    expect(normalizeHandoffCode(' 12a3-45 ')).toBe('1234');
    expect(isCompleteHandoffCode('1234')).toBe(true);
    expect(isCompleteHandoffCode('123')).toBe(false);
  });
  it('ganho do entregador usa driverPayout e cai para a taxa em pedidos antigos', () => {
    expect(driverEarning({ driverPayout: 7, deliveryFee: 3.5 })).toBe(7);
    expect(driverEarning({ driverPayout: undefined, deliveryFee: 6 })).toBe(6);
    expect(driverEarning({ driverPayout: 0, deliveryFee: 6 })).toBe(0);
  });
  it('pedido ativo: em rota tem prioridade; aceito aguardando retirada também conta', () => {
    const os = [
      { id: 'a', status: 'WAITING_FOR_DRIVER', driverId: 'd1' },
      { id: 'b', status: 'OUT_FOR_DELIVERY', driverId: 'd1' },
      { id: 'c', status: 'OUT_FOR_DELIVERY', driverId: 'd2' },
    ] as any[];
    expect(pickDriverActiveOrder(os, 'd1')?.id).toBe('b');
    expect(pickDriverActiveOrder([os[0]], 'd1')?.id).toBe('a');
    expect(pickDriverActiveOrder(os, undefined)).toBeUndefined();
    expect(pickDriverActiveOrder(os, 'd3')).toBeUndefined();
  });
  it('mensagens pt-BR', () => {
    expect(handoffErrorMessage({ message: 'CODE_LOCKED: x' })).toMatch(/bloqueado/);
    expect(handoffErrorMessage(new Error('ORDER_NOT_AVAILABLE: x'))).toMatch(/outro entregador/);
    expect(handoffErrorMessage('FOO: algo deu errado')).toBe('algo deu errado');
    expect(wrongCodeMessage(4)).toBe('Código incorreto. 4 tentativas restantes.');
    expect(wrongCodeMessage(1)).toBe('Código incorreto. 1 tentativa restante.');
    expect(wrongCodeMessage(0)).toMatch(/bloqueado/);
  });
  it('loja precisa de motivo só para DELIVERED de entrega', () => {
    expect(storeDeliveredNeedsReason({ fulfillmentType: 'DELIVERY' } as any, 'DELIVERED')).toBe(true);
    expect(storeDeliveredNeedsReason({ fulfillmentType: 'PICKUP' } as any, 'DELIVERED')).toBe(false);
    expect(storeDeliveredNeedsReason({ fulfillmentType: 'DELIVERY' } as any, 'READY')).toBe(false);
  });
});
