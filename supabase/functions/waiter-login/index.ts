// Edge Function `waiter-login` — login do garçom por loja + usuário + senha, com rate limit (5/min por usuário+IP).
// Resposta de falha é sempre genérica (não revela se o usuário existe). A senha nunca é registrada em log.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';
import { isValidWaiterPassword, normalizeWaiterUsername, waiterSyntheticEmail } from '../_shared/waiterIdentity.ts';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, code: 'INVALID_INPUT', message: 'Requisição inválida.' }, 400); }

  const slug = String(body?.slug ?? '').trim().toLowerCase();
  const username = normalizeWaiterUsername(body?.username);
  const password = body?.password;
  const GENERIC = { ok: false, code: 'INVALID_CREDENTIALS', message: 'Usuário ou senha incorretos.' };
  if (!slug || !username || !isValidWaiterPassword(password)) return json(GENERIC, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  const ipHash = ip ? await sha256(`${Deno.env.get('WAITER_LOGIN_IP_SALT') ?? ''}|${ip}`) : null;

  const { data: check } = await admin.rpc('waiter_login_check', { p_slug: slug, p_username: username, p_ip_hash: ipHash });
  if (check?.reason === 'RATE_LIMITED') {
    return json({ ok: false, code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde um minuto e tente de novo.' }, 429);
  }
  if (check?.allowed !== true) return json(GENERIC, 401);

  const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: waiterSyntheticEmail(username, slug), password: String(password) });
  if (error || !data.session) return json(GENERIC, 401);
  return json({ ok: true, session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token } });
});
