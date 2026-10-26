import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
import { PaymentConfirmationList } from '../PaymentsToConfirm';
describe('minimal manual confirmation UI', () => {
  it('shows the simple Brazilian labels and no order details', () => {
    const html = renderToStaticMarkup(<PaymentConfirmationList rows={[{ order_number:42,amount:19.9,method:'PIX',created_at:'2026-10-26T12:00:00Z',customer_first_name:'Maria' }]} busy={false} onConfirm={() => {}} />);
    expect(html).toContain('Pagamentos para conferir'); expect(html).toContain('Confirmar recebimento');
    expect(html).toContain('Pedido #42'); expect(html).toContain('Maria'); expect(html).toContain('19,90');
    expect(html).not.toMatch(/Endereço|Itens|Telefone/);
  });
});
