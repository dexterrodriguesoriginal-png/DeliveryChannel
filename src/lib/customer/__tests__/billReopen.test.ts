import { describe, expect, it } from 'vitest';
import { canReopenBill } from '../billReopen';

describe('reabertura da conta pelo cliente', () => {
  it.each(['BILL_REQUESTED', 'WAITER_AUTHORIZED'])('permite %s sem PIX ativo ou pago', status => {
    for (const pix of [null, undefined, 'expired', 'failed', 'cancelled']) expect(canReopenBill(status, pix)).toBe(true);
  });

  it.each(['creating', 'pending', 'paid'])('recusa PIX %s mesmo durante a solicitação da conta', pix => {
    expect(canReopenBill('BILL_REQUESTED', pix)).toBe(false);
    expect(canReopenBill('WAITER_AUTHORIZED', pix)).toBe(false);
  });

  it.each(['OPEN', 'AWAITING_PAYMENT', 'CLOSED', 'CANCELLED', undefined])('não oferece reabertura em %s', status => {
    expect(canReopenBill(status)).toBe(false);
  });
});

