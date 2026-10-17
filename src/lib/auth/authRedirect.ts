/**
 * URLs de retorno do Supabase Auth (link de confirmação de e-mail) e a "última loja visitada".
 *
 * O link de confirmação volta para a loja em que o cliente se cadastrou (/app/<slug>). Se o Supabase não
 * tiver a URL na allow-list, ele cai no Site URL (raiz); por isso a raiz oferece "Voltar para a loja"
 * usando a última loja visitada (localStorage).
 */
export const DEFAULT_APP_ORIGIN = 'https://deliverychannel.ai.studio';
export const LAST_STORE_SLUG_KEY = 'deliverychannel_last_store_slug';

/** Slug de /app/<slug>[/...]; null fora da vitrine ou slug inválido. */
export function storeSlugFromPath(pathname: string | null | undefined): string | null {
  const m = String(pathname || '').match(/^\/app\/([^/?#]+)/);
  if (!m) return null;
  let slug: string;
  try { slug = decodeURIComponent(m[1]); } catch { return null; }
  return /^[a-z0-9][a-z0-9-]{0,99}$/i.test(slug) ? slug : null;
}

/** URL de retorno do e-mail de confirmação: origem + /app/<slug> quando o cadastro veio de uma loja. */
export function emailRedirectUrl(loc?: { origin?: string; pathname?: string } | null): string {
  const origin = loc?.origin && /^https?:\/\//.test(loc.origin) ? loc.origin.replace(/\/+$/, '') : DEFAULT_APP_ORIGIN;
  const slug = storeSlugFromPath(loc?.pathname);
  return slug ? `${origin}/app/${encodeURIComponent(slug)}` : origin;
}

/** URL de retorno no navegador atual (fallback para a origem pública da Delivery Channel fora do navegador). */
export function currentEmailRedirectUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_APP_ORIGIN;
  return emailRedirectUrl({ origin: window.location.origin, pathname: window.location.pathname });
}

type KV = Pick<Storage, 'getItem' | 'setItem'>;

export function rememberLastStoreSlug(storage: KV | null | undefined, slug: string | null | undefined): void {
  const s = storeSlugFromPath(`/app/${slug || ''}`);
  if (!storage || !s) return;
  try { storage.setItem(LAST_STORE_SLUG_KEY, s); } catch { /* armazenamento indisponível */ }
}

export function readLastStoreSlug(storage: KV | null | undefined): string | null {
  if (!storage) return null;
  try { return storeSlugFromPath(`/app/${storage.getItem(LAST_STORE_SLUG_KEY) || ''}`); } catch { return null; }
}
