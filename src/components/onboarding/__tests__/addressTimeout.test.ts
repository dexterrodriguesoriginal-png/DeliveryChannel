import { describe, it, expect, vi } from 'vitest';
import { withTimeout } from '../AddressAutocompleteInput';

describe('withTimeout da busca de endereço', () => {
  it('rejeita quando a etapa nunca responde (ex.: callback do Google não chamado)', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 6000, 'Google Places');
    const assertion = expect(p).rejects.toThrow(/Tempo esgotado/);
    vi.advanceTimersByTime(6001);
    await assertion;
    vi.useRealTimers();
  });
  it('repassa o resultado quando responde a tempo', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });
});
