/**
 * Fonte da identidade pública da loja para o servidor PWA.
 * Lê SOMENTE pela RPC pública `get_public_store(p_slug)` (a mesma usada pela vitrine),
 * com a chave publicável/anon já usada pelo app (variáveis de ambiente, nunca no código).
 * Não usa service_role nem escreve nada no banco.
 */
import type { StoreIdentityInput } from '../../src/lib/pwa/storeManifest';
import { resolveServerPublicConfig } from '../config/publicConfig';

export type StoreLookup =
  | { status: 'ok'; store: StoreIdentityInput }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export type StoreResolver = (slug: string) => Promise<StoreLookup>;

/** Slug público: minúsculas, dígitos e hífen (1–64), sem hífen nas pontas. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export function isValidSlug(slug: string): boolean {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

function str(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
function pick(o: Record<string, unknown> | undefined, a: string, b: string): string {
  return o ? str(o[a]) || str(o[b]) : '';
}

/** Extrai a identidade (id/slug/nome/tema) do payload do get_public_store. Rejeita payload de outra loja. */
export function identityFromPayload(payload: unknown, slug: string): StoreIdentityInput | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const tenant = p.tenant as Record<string, unknown> | undefined;
  const theme = (p.theme || undefined) as Record<string, unknown> | undefined;
  const tokens = (theme?.theme_tokens || theme?.tokens || undefined) as Record<string, unknown> | undefined;
  const bars = ((tokens?.meta as Record<string, unknown> | undefined)?.systemBars || undefined) as Record<string, unknown> | undefined;
  const palette = (tokens?.palette || undefined) as Record<string, unknown> | undefined;
  const id = str(tenant?.id);
  const tSlug = str(tenant?.slug);
  if (!id || tSlug !== slug) return null; // nunca misturar lojas
  const name = str(tenant?.name);
  return {
    id,
    slug: tSlug,
    name,
    theme: {
      storeName: pick(theme, 'storeName', 'store_name') || name,
      shortName: pick(theme, 'shortName', 'short_name') || undefined,
      logoUrl: pick(theme, 'logoUrl', 'logo_url') || undefined,
      primaryColor: pick(theme, 'primaryColor', 'primary_color') || undefined,
      backgroundColor: pick(theme, 'backgroundColor', 'background_color') || undefined,
      tagline: pick(theme, 'tagline', 'tagline') || undefined,
      headerColor: str(palette?.bgHeader) || undefined,
      statusBarColor: str(bars?.statusBarColor) || undefined,
      navBarColor: str(bars?.navBarColor) || undefined,
    },
  };
}

export interface SupabaseEnv { url: string; key: string; }

export function supabaseEnvFrom(env: NodeJS.ProcessEnv): SupabaseEnv | null {
  const url = resolveServerPublicConfig(env).SUPABASE_URL;
  const key = (env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url.startsWith('https://') || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

export function supabaseResolver(cfg: SupabaseEnv, fetchImpl: typeof fetch = fetch): StoreResolver {
  return async (slug) => {
    try {
      const res = await fetchImpl(`${cfg.url}/rest/v1/rpc/get_public_store`, {
        method: 'POST',
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_slug: slug }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (/not.?found|não encontrad/i.test(text)) return { status: 'not_found' };
        return { status: 'error', message: `HTTP ${res.status}` };
      }
      const data = await res.json().catch(() => null);
      if (data === null || data === undefined) return { status: 'not_found' };
      const store = identityFromPayload(data, slug);
      return store ? { status: 'ok', store } : { status: 'not_found' };
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : 'falha' };
    }
  };
}

/** Lojas demonstrativas locais (somente desenvolvimento / PWA_DEMO_STORES=true). */
export function demoResolver(): StoreResolver {
  return async (slug) => {
    const { dataStore } = await import('../../src/services/dataStore');
    const t = dataStore.getTenantBySlug(slug) as unknown as { id: string; slug: string; name: string; theme?: StoreIdentityInput['theme'] } | undefined;
    if (!t || t.slug !== slug) return { status: 'not_found' };
    return { status: 'ok', store: { id: t.id, slug: t.slug, name: t.name, theme: t.theme } };
  };
}
