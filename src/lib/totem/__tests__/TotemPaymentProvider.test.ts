import { describe, expect, it } from 'vitest';
import { terminalProviders } from '../TotemPaymentProvider';

describe('pagamento presencial seguro do totem', () => {
  it('mantém terminais sem backend autenticado indisponíveis', () => {
    expect(terminalProviders.length).toBe(7);
    expect(terminalProviders.every(p => p.isAvailable() === false)).toBe(true);
  });
  it('nunca simula aprovação ou cobra pelo browser', async () => {
    for (const provider of terminalProviders) {
      await expect(provider.startPayment({ orderId: 'o', amountCents: 1000 }))
        .rejects.toThrow(/indisponível/);
    }
  });
});
