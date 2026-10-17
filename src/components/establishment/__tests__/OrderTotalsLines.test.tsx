import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderTotalsLines } from '../OrderTotalsLines';
import { ThermalReceiptModal } from '../ThermalReceiptModal';

const order = {
  id: 'o1',
  orderNumber: 1042,
  subtotal: 15,
  discount: 0,
  deliveryFee: 7,
  totalAmount: 22,
  fulfillmentType: 'DELIVERY',
  paymentMethod: 'CASH',
  paymentStatus: 'PAYMENT_ON_DELIVERY',
  createdAt: '2026-10-17T10:00:00Z',
  customerName: 'Cliente Teste',
  items: [
    { productName: 'X', quantity: 1, unitPrice: 10, totalPrice: 10 },
    { productName: 'Y', quantity: 1, unitPrice: 5, totalPrice: 5 },
  ],
} as any;

describe('painel de detalhes do dono — totais', () => {
  it('mostra Subtotal, Taxa de entrega e Total com vírgula', () => {
    const html = renderToStaticMarkup(<OrderTotalsLines order={order} />).replace(/<!-- -->/g, '');
    expect(html).toContain('Subtotal');
    expect(html).toContain('R$ 15,00');
    expect(html).toContain('Taxa de entrega');
    expect(html).toContain('R$ 7,00');
    expect(html).toContain('R$ 22,00');
    expect(html).not.toContain('Desconto');
  });

  it('mostra Desconto quando houver', () => {
    const html = renderToStaticMarkup(<OrderTotalsLines order={{ ...order, discount: 2, totalAmount: 20 }} />).replace(/<!-- -->/g, '');
    expect(html).toContain('Desconto');
    expect(html).toContain('- R$ 2,00');
  });
});

describe('cupom térmico — totais', () => {
  it('inclui a linha "Taxa de entrega" e valores com vírgula', () => {
    const html = renderToStaticMarkup(<ThermalReceiptModal order={order} storeName="Loja" onClose={() => {}} />).replace(/<!-- -->/g, '');
    expect(html).toContain('Taxa de entrega:');
    expect(html).toContain('R$ 7,00');
    expect(html).toContain('R$ 22,00');
    expect(html).not.toMatch(/R\$ \d+\.\d{2}/);
  });
});
