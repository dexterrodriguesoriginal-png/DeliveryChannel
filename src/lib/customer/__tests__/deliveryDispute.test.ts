import { describe, expect, it } from 'vitest';
import { canDisputeDelivery, DELIVERY_DISPUTE_WINDOW_MS, deliveryNoticeLabel, type DeliveryState } from '../deliveryDispute';

const deliveredAt = '2026-11-04T12:00:00.000Z';
const start = Date.parse(deliveredAt);
const delivered: DeliveryState = { status: 'DELIVERED', deliveredAt, canDisputeDelivery: true };

describe('contestação da entrega pelo cliente', () => {
  it('exige permissão do servidor e retira a ação ao atingir exatamente 5 minutos', () => {
    expect(canDisputeDelivery(delivered, start + DELIVERY_DISPUTE_WINDOW_MS - 1)).toBe(true);
    expect(canDisputeDelivery(delivered, start + DELIVERY_DISPUTE_WINDOW_MS)).toBe(false);
    expect(canDisputeDelivery({ ...delivered, canDisputeDelivery: false }, start)).toBe(false);
    expect(canDisputeDelivery({ ...delivered, canDisputeDelivery: undefined }, start)).toBe(false);
    expect(canDisputeDelivery({ ...delivered, deliveredAt: 'invalid' }, start)).toBe(false);
    expect(deliveryNoticeLabel(delivered, start + DELIVERY_DISPUTE_WINDOW_MS)).toBe('Pedido recebido');
  });

  it.each(['OPEN', 'CONFIRMED_DELIVERED', 'RESENT'] as const)('não permite segunda disputa %s e explica a resolução', status => {
    const round = { ...delivered, status: status === 'RESENT' ? 'PREPARING' : 'DELIVERED', deliveryDispute: { id: 'd1', status, createdAt: deliveredAt } };
    expect(canDisputeDelivery(round, start)).toBe(false);
    expect(deliveryNoticeLabel(round, start)).toBe({ OPEN: 'Entrega em verificação', CONFIRMED_DELIVERED: 'Entrega confirmada pela equipe', RESENT: 'Pedido reenviado para produção' }[status]);
  });

  it('uma nova entrega após reenvio volta ao aviso de entregue sem permitir segunda disputa', () => {
    const redelivered = { ...delivered, deliveryDispute: { id: 'd1', status: 'RESENT' as const, createdAt: deliveredAt } };
    expect(deliveryNoticeLabel(redelivered, start)).toBe('Seu pedido foi entregue');
    expect(canDisputeDelivery(redelivered, start)).toBe(false);
  });

  it.each(['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'CANCELLED'])('nunca oferece contestação em %s', status => {
    expect(canDisputeDelivery({ ...delivered, status }, start)).toBe(false);
  });

  it('bloqueia "Não recebi" e exibe "Entrega confirmada com código" quando entregue com código de 4 dígitos', () => {
    const confirmedWithCode: DeliveryState = {
      ...delivered,
      deliveryConfirmedWithCode: true,
    };
    expect(canDisputeDelivery(confirmedWithCode, start)).toBe(false);
    expect(deliveryNoticeLabel(confirmedWithCode, start)).toBe('Entrega confirmada com código');
  });
});
