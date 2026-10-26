import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveServerPublicConfig } from '../publicConfig';
import { createPaymentStore } from '../../payments/store';
import { PaymentService } from '../../payments/service';
import { supabaseEnvFrom } from '../../pwa/storeSource';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
import { createClient } from '@supabase/supabase-js';

const productionUrl = 'https://qjmhlbipmwobnuctzpft.supabase.co';
const productionOrigin = 'https://deliverychannel.ai.studio';
afterEach(() => vi.clearAllMocks());

describe('configuração pública do Express', () => {
  it.each([undefined, '', '   '])('usa produção sem env ou com env vazia (%j)', value => {
    const env = { SUPABASE_URL: value, VITE_SUPABASE_URL: value, PAYMENTS_PUBLIC_URL: value };
    expect(resolveServerPublicConfig(env)).toEqual({ SUPABASE_URL: productionUrl, PAYMENTS_PUBLIC_URL: productionOrigin });
    expect(createPaymentStore(env)).toBeNull(); // Nunca inventa service_role.
    const service = new PaymentService(null!, env);
    expect(service.origin).toBe(productionOrigin);
    expect(service.available('mercadopago')).toBe(false);
    expect(service.available('pagbank')).toBe(false);
    expect(supabaseEnvFrom(env)).toBeNull(); // A PWA também continua exigindo chave.
  });

  it.each([
    [{}, productionUrl],
    [{ VITE_SUPABASE_URL: 'https://staging.supabase.co' }, 'https://staging.supabase.co'],
    [{ SUPABASE_URL: '   ', VITE_SUPABASE_URL: 'https://staging.supabase.co' }, 'https://staging.supabase.co'],
    [{ SUPABASE_URL: 'http://127.0.0.1:54322', VITE_SUPABASE_URL: 'https://staging.supabase.co' }, 'http://127.0.0.1:54322'],
  ])('pagamentos preservam a precedência da URL (%j)', (env, expected) => {
    const store = createPaymentStore({ ...env, SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role' });
    expect(store).not.toBeNull();
    expect(createClient).toHaveBeenCalledWith(expected, 'test-only-service-role', { auth: { persistSession: false, autoRefreshToken: false } });
  });

  it('PWA usa a URL fixa e aceita override sem mover a chave para o código', () => {
    expect(supabaseEnvFrom({ VITE_SUPABASE_PUBLISHABLE_KEY: 'test-only' })).toEqual({ url: productionUrl, key: 'test-only' });
    expect(supabaseEnvFrom({ SUPABASE_URL: 'https://staging.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-only' })).toEqual({ url: 'https://staging.supabase.co', key: 'test-only' });
  });

  it('origem de pagamentos aceita override e continua recusando valor inválido/inseguro', () => {
    expect(new PaymentService(null!, { PAYMENTS_PUBLIC_URL: 'https://staging.example' }).origin).toBe('https://staging.example');
    expect(new PaymentService(null!, { PAYMENTS_PUBLIC_URL: 'http://localhost:3000' }).origin).toBe('http://localhost:3000');
    for (const url of ['invalid', 'http://staging.example']) {
      expect(() => new PaymentService(null!, { NODE_ENV: 'production', PAYMENTS_PUBLIC_URL: url }).origin).toThrow();
    }
  });
});
