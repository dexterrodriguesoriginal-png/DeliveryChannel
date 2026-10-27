import { describe, it, expect } from 'vitest';
import { paymentMethodLabel, paymentMethodShortLabel, paymentStatusLabel, fulfillmentLabel, orderStatusLabel, formatTableLabel, orderTypeLabel } from '../labels';

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
    expect(fulfillmentLabel('DINE_IN')).toBe('Salão');
    expect(orderStatusLabel('OUT_FOR_DELIVERY')).toBe('Saiu para entrega');
    expect(orderStatusLabel('CANCELLED')).toBe('Cancelado');
  });
  it('formatTableLabel não duplica "Mesa" quando o rótulo já começa com Mesa', () => {
    expect(formatTableLabel('04')).toBe('Mesa 04');
    expect(formatTableLabel('Mesa 04')).toBe('Mesa 04');
    expect(formatTableLabel('Mesa Mesa 04')).toBe('Mesa 04');
    expect(formatTableLabel('mesa 3')).toBe('mesa 3');
    expect(formatTableLabel(undefined)).toBe('Mesa');
    expect(formatTableLabel('', 'Mesa —')).toBe('Mesa —');
  });
  it('orderTypeLabel retorna Entrega, Retirada ou Mesa (com o nome da mesa)', () => {
    expect(orderTypeLabel({ fulfillmentType: 'DELIVERY' })).toBe('Entrega');
    expect(orderTypeLabel({ fulfillmentType: 'PICKUP' })).toBe('Retirada');
    expect(orderTypeLabel({ fulfillmentType: 'DINE_IN', tableLabel: 'Mesa 04' })).toBe('Mesa 04');
    expect(orderTypeLabel({ fulfillmentType: 'DINE_IN', tableLabel: '04' })).toBe('Mesa 04');
    expect(orderTypeLabel({ fulfillmentType: 'DINE_IN', tableLabel: 'Mesa Mesa 04' })).toBe('Mesa 04');
    expect(orderTypeLabel({ fulfillmentType: 'DINE_IN', tableLabel: undefined })).toBe('Mesa');
    expect(orderTypeLabel('DELIVERY')).toBe('Entrega');
    expect(orderTypeLabel('PICKUP')).toBe('Retirada');
    expect(orderTypeLabel('DINE_IN', 'Mesa 04')).toBe('Mesa 04');
  });
});
