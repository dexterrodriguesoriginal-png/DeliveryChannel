import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));
import { PrimaryPaymentAccountChoice } from '../PrimaryPaymentAccountChoice';
import { FreeDeliverySetting, deliveryFeeForFreeDelivery } from '../FreeDeliverySetting';
import { settingsToDb } from '../../../repositories/tenantRepository';
import { PaymentAccount } from '../../../repositories/paymentRepository';
const first: PaymentAccount = { provider: 'manual_pix', status: 'connected', account_label: 'Minha conta', is_primary: true, accepts_pix: true, accepts_card: false };
const choice = (accounts: PaymentAccount[]) => renderToStaticMarkup(<PrimaryPaymentAccountChoice accounts={accounts} busy={false} onChoose={() => {}} />);

describe('escolha da conta para receber', () => {
  it('fica oculta com zero ou uma conta conectada', () => {
    expect(choice([])).toBe('');
    expect(choice([first, { ...first, provider: 'pagbank', status: 'disconnected' }])).toBe('');
  });
  it('mostra apenas contas conectadas, com a escolha atual e orientação simples', () => {
    const html = choice([first, { ...first, provider: 'pagbank', account_label: 'Minha outra conta', is_primary: false }, { ...first, provider: 'infinitepay', status: 'disconnected' }]);
    expect(html).toContain('Escolha a conta em que deseja receber');
    expect(html.match(/Receber nesta conta/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('aparece primeiro para o cliente');
  });
});
describe('entrega grátis', () => {
  it('salva zero em ambos os esquemas e mantém a opção ligada depois da leitura', () => {
    const fee = deliveryFeeForFreeDelivery(true);
    expect(fee).toBe(0);
    for (const n1n6 of [true, false]) expect(settingsToDb({ deliveryFee: fee }, n1n6)).toEqual({ delivery_fee: 0 });
    const html = renderToStaticMarkup(<FreeDeliverySetting fee={fee} disabled={false} onChange={() => {}} />);
    expect(html).toContain('role="switch" checked=""');
    expect(html).toContain('O cliente paga R$ 0,00. Sua loja paga R$ 7,00');
  });
  it('desligada representa cobrança compartilhada', () => {
    const html = renderToStaticMarkup(<FreeDeliverySetting fee={deliveryFeeForFreeDelivery(false)} disabled={false} onChange={() => {}} />);
    expect(html).not.toContain('checked=""');
    expect(html).toContain('O cliente paga R$ 3,50 e sua loja paga R$ 3,50');
  });
});
