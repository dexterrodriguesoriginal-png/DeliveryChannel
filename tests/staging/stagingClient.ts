/**
 * Cliente supabase-js REAL para o projeto de STAGING (login real por e-mail/senha; anon/publishable key).
 * Recusa produção. Nunca usa service_role.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkBuildEnv, PRODUCTION_PROJECT_REF } from '../../src/lib/deployGuard';

const ref = process.env.STAGING_PROJECT_REF || '';
const url = process.env.STAGING_SUPABASE_URL || '';
const key = process.env.STAGING_ANON_KEY || '';
const password = process.env.STAGING_TEST_PASSWORD || '';

const errors = checkBuildEnv({
  VITE_DEPLOY_TARGET: 'staging', VITE_BACKEND_SCHEMA: 'n1n6', VITE_STAGING_PROJECT_REF: ref,
  VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key,
});
if (!password) errors.push('STAGING_TEST_PASSWORD ausente.');
if ([ref, url, key].some(v => v.toLowerCase().includes(PRODUCTION_PROJECT_REF))) errors.push('Valor de PRODUÇÃO detectado.');
if (errors.length) throw new Error('E2E de staging recusado:\n - ' + errors.join('\n - '));

const mk = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const anon = mk();
const sessions = new Map<string, SupabaseClient>();
let current: SupabaseClient = anon;

export const USERS = {
  ownerA: 'stg.owner.a@example.com', managerA: 'stg.manager.a@example.com', cashierA: 'stg.cashier.a@example.com',
  driverA: 'stg.driver.a@example.com', operatorA: 'stg.operator.a@example.com', ownerB: 'stg.owner.b@example.com',
  c1: 'stg.cliente1@example.com', c2: 'stg.cliente2@example.com',
} as const;

/** null = visitante anônimo. Faz login REAL (signInWithPassword) uma vez por usuário. Retorna auth.uid(). */
export async function loginAs(email: string | null): Promise<string | null> {
  if (!email) { current = anon; return null; }
  let c = sessions.get(email);
  if (!c) {
    c = mk();
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`login real falhou para ${email}: ${error.message}`);
    sessions.set(email, c);
  }
  current = c;
  const { data } = await c.auth.getUser();
  return data.user?.id ?? null;
}

/** Proxy: os repositórios do frontend importam `supabase` e usam o cliente do usuário logado no momento. */
export const stagingSupabase = new Proxy({} as SupabaseClient, {
  get: (_t, k) => {
    const v = (current as any)[k];
    return typeof v === 'function' ? v.bind(current) : v;
  },
});
