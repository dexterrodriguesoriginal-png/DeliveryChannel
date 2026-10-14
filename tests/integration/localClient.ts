/**
 * Cliente supabase-js REAL apontando para PostgREST LOCAL (tests/integration/setup_local_backend.sh).
 * Nenhum acesso remoto. Os repositórios do frontend usam este cliente via vi.mock('src/lib/supabase').
 * A troca de usuário gera um JWT HS256 de teste (segredo local) com sub/role, como o Supabase faria.
 */
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SECRET = process.env.FE_IT_JWT_SECRET || 'local-integration-secret-only-for-tests-0123456789';
export const BASE_URL = process.env.FE_IT_URL || 'http://127.0.0.1:54322';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function signJwt(claims: Record<string, unknown>): string {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const ANON = signJwt({ role: 'anon' });
let current = ANON;

/** null = visitante anônimo; uuid = usuário autenticado (auth.uid()). */
export function loginAs(userId: string | null): void {
  current = userId ? signJwt({ role: 'authenticated', sub: userId }) : ANON;
}

export const localSupabase = createClient(BASE_URL, ANON, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  // Realtime não é exercitado aqui (Node 20 sem WebSocket nativo): transporte inerte.
  realtime: { transport: class { close() {} } as any },
  global: {
    fetch: (input: any, init?: any) => {
      const url = String(typeof input === 'string' ? input : input.url).replace('/rest/v1', '');
      const headers = new Headers(init?.headers || {});
      headers.set('Authorization', `Bearer ${current}`);
      return fetch(url, { ...init, headers });
    },
  },
});
