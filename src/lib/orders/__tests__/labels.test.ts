import { describe, it, expect } from 'vitest';
import { paymentMethodLabel, paymentMethodShortLabel, paymentStatusLabel, fulfillmentLabel, orderStatusLabel } from '../labels';

describe('rótulos pt-BR de pedido', () => {
  it('forma de pagamento nunca aparece como enum cru', () => {
    expect(paymentMethodLabel('CASH')).toBe('Dinheiro');
    expect(paymentMethodLabel('PIX')).toBe('PIX');
    expect(paymentMethodLabel('CREDIT_CARD')).toBe('Cartão de crédito');
    expect(paymentMethodLabel('DEBIT_CARD')).toBe('Cartão de débito');
    expect(paymentMethodLabel('cash')).toBe('Dinheiro');
    expect(paymentMethodLabel('BOLETO')).toBe('Outro');
    expect(paymentMethodLabel(undefined)).toBe('—');
    expect(paymentMethodShortLabel('CREDIT_CARD')).toBe('Cartão');
    expect(paymentMethodShortLabel('CASH')).toBe('Dinheiro');
  });
  it('status de pagamento, atendimento e status do pedido', () => {
    expect(paymentStatusLabel('PAYMENT_ON_DELIVERY')).toBe('Pagamento na entrega');
    expect(paymentStatusLabel('PAID')).toBe('Pago');
    expect(fulfillmentLabel('DELIVERY')).toBe('Entrega');
    expect(fulfillmentLabel('PICKUP')).toBe('Retirada');
    expect(orderStatusLabel('OUT_FOR_DELIVERY')).toBe('Saiu para entrega');
    expect(orderStatusLabel('CANCELLED')).toBe('Cancelado');
  });
});
