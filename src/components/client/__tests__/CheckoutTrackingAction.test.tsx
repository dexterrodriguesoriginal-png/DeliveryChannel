import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CheckoutTrackingAction } from '../CheckoutTrackingAction';

const render = (requiresPayment: boolean, serverPaymentStatus?: string) => renderToStaticMarkup(
  <CheckoutTrackingAction requiresPayment={requiresPayment} serverPaymentStatus={serverPaymentStatus} color="#15803d" onTrack={() => {}} />,
);
describe('acompanhar só após confirmação do pagamento no servidor', () => {
  it.each([undefined, 'PENDING', 'REFUNDED', 'PAYMENT_ON_DELIVERY'])('PIX/online com status %s não abre acompanhamento', status => {
    expect(render(true, status)).not.toContain('Acompanhar Meus Pedidos');
    expect(render(true, status)).toContain('Aguardando pagamento…');
  });
  it('PAID libera o botão', () => expect(render(true, 'PAID')).toContain('Acompanhar Meus Pedidos'));
  it('dinheiro/cartão na entrega preservam o botão', () => expect(render(false, 'PAYMENT_ON_DELIVERY')).toContain('Acompanhar Meus Pedidos'));
});
