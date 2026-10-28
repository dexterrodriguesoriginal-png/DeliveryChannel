/**
 * Identidade do garçom (login simples): usuário único por loja + senha. Sem e-mail para o garçom.
 * ATENÇÃO: este arquivo é espelhado em supabase/functions/_shared/waiterIdentity.ts (Edge Functions rodam em Deno
 * e não importam de src/). Um teste garante que os dois são idênticos.
 */
export const WAITER_EMAIL_DOMAIN = 'garcom.deliverychannel.local';
export const WAITER_USERNAME_RE = /^[a-z0-9_]{3,24}$/;
export const WAITER_PASSWORD_MIN = 6;

/** "João Silva" → "joaosilva" (minúsculas, sem acento, só a-z 0-9 _). */
export function normalizeWaiterUsername(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24);
}

export function isValidWaiterUsername(value: unknown): boolean {
  return typeof value === 'string' && WAITER_USERNAME_RE.test(value);
}

export function isValidWaiterPassword(value: unknown): boolean {
  return typeof value === 'string' && value.length >= WAITER_PASSWORD_MIN && value.length <= 72;
}

/** E-mail sintético (nunca exibido): `<usuario>.<slug>@garcom.deliverychannel.local`. */
export function waiterSyntheticEmail(username: string, tenantSlug: string): string {
  return `${normalizeWaiterUsername(username)}.${String(tenantSlug).trim().toLowerCase()}@${WAITER_EMAIL_DOMAIN}`;
}

export function isWaiterSyntheticEmail(email: unknown): boolean {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${WAITER_EMAIL_DOMAIN}`);
}

/** Telefone: 10–13 dígitos (com DDD, opcional 55). */
export function cleanWaiterPhone(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 13 ? digits : null;
}

/** Senha aleatória legível (sem 0/O/1/l/I) para o botão "gerar senha". */
export function generateWaiterPassword(random: (max: number) => number, length = 8): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < Math.max(length, WAITER_PASSWORD_MIN); i += 1) out += alphabet[random(alphabet.length)];
  return out;
}

/** Slug a partir de /garcom/<slug>. */
export function parseWaiterLoginPath(pathname: string): string | null {
  const m = /^\/garcom\/([a-z0-9][a-z0-9-]{0,63})\/?$/i.exec(pathname);
  return m ? m[1].toLowerCase() : null;
}
