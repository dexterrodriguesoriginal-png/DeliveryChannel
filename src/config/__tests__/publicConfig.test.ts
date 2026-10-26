import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePublicConfig } from '../publicConfig';
import { currentBackendSchema } from '../../lib/backendSchema';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
import { createClient } from '@supabase/supabase-js';

const production = {
  VITE_SUPABASE_URL: 'https://qjmhlbipmwobnuctzpft.supabase.co',
  VITE_BACKEND_SCHEMA: 'n1n6',
  VITE_DEPLOY_TARGET: 'production',
  VITE_N1N6_PRODUCTION_APPROVED: 'yes',
  PAYMENTS_PUBLIC_URL: 'https://deliverychannel.ai.studio',
};

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.clearAllMocks(); });

describe('configuração pública', () => {
  it('sem env usa os cinco valores fixos de produção', () => {
    expect(resolvePublicConfig({})).toEqual(production);
    vi.stubEnv('VITE_BACKEND_SCHEMA', undefined);
    expect(currentBackendSchema()).toBe('n1n6');
  });

  it.each(['', '   '])('env vazia (%j) usa os fallbacks', value => {
    expect(resolvePublicConfig(Object.fromEntries(Object.keys(production).map(key => [key, value])))).toEqual(production);
    vi.stubEnv('VITE_BACKEND_SCHEMA', value);
    expect(currentBackendSchema()).toBe('n1n6');
  });

  it('env sobrescreve todos os valores sem aceitar credenciais na configuração pública', () => {
    const overrides = {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54322',
      VITE_BACKEND_SCHEMA: 'legacy-020',
      VITE_DEPLOY_TARGET: 'staging',
      VITE_N1N6_PRODUCTION_APPROVED: 'no',
      PAYMENTS_PUBLIC_URL: 'http://localhost:3000',
    };
    expect(resolvePublicConfig({ ...overrides, SUPABASE_SERVICE_ROLE_KEY: 'test-only', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-only' })).toEqual(overrides);
    vi.stubEnv('VITE_BACKEND_SCHEMA', 'legacy-020');
    expect(currentBackendSchema()).toBe('legacy-020');
  });

  it.each([undefined, '', '   ', 'http://127.0.0.1:54322'])('clientes frontend e cozinha usam a URL efetiva (%j)', async url => {
    vi.stubEnv('VITE_SUPABASE_URL', url);
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', undefined);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', undefined);
    const { supabaseUrl, isSupabaseConfigured } = await import('../../lib/supabase');
    const { kitchenClient } = await import('../../lib/kitchen/kitchenClient');
    kitchenClient();
    const expected = url?.trim() || production.VITE_SUPABASE_URL;
    expect(supabaseUrl).toBe(expected);
    expect(isSupabaseConfigured).toBe(false); // A chave continua obrigatória no env.
    expect(createClient).toHaveBeenCalledTimes(2);
    for (const args of vi.mocked(createClient).mock.calls) expect(args.slice(0, 2)).toEqual([expected, 'placeholder-key']);
  });
});
