/**
 * Regras de backend do frontend (N1–N6).
 *
 * - Com Supabase configurado, os fluxos de produção (pedidos, PDV, checkout,
 *   cupons, campanhas, analytics, mídia, configurações de pagamento) usam
 *   EXCLUSIVAMENTE as RPCs/tabelas do servidor. Não existe fallback para
 *   localStorage, mocks ou dataStore: erro do servidor vira erro na tela.
 * - Sem Supabase configurado, o modo demonstração local (dataStore) só é
 *   permitido em desenvolvimento (import.meta.env.DEV). Em build de produção
 *   sem backend, as operações lançam BACKEND_NOT_CONFIGURED.
 * - Nunca usar service_role no frontend (ver src/lib/supabase.ts).
 */
import { isSupabaseConfigured } from './supabase';

const env: Record<string, unknown> =
  typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : {};

/** Modo demonstração local (dataStore) — somente em DEV e sem Supabase. */
export const isLocalDemoAllowed: boolean = !isSupabaseConfigured && env.DEV === true;

export const PREVIEW_BYPASS_SESSION_KEY = 'adegafood_dev_preview_bypass';

/** Verifica se o modo rápido de edição sem login no preview está ativo na sessão atual. */
export function isPreviewBypassActive(): boolean {
  // Segurança: o modo edição sem login só existe no demo local (DEV sem Supabase).
  // Nunca em produção nem com Supabase real, independentemente de ?preview=true ou sessionStorage.
  if (!isLocalDemoAllowed) return false;
  try {
    if (typeof window === 'undefined') return false;
    const search = window.location?.search || '';
    if (search.includes('preview=true') || search.includes('demo=true')) {
      window.sessionStorage?.setItem(PREVIEW_BYPASS_SESSION_KEY, 'true');
      return true;
    }
    return window.sessionStorage?.getItem(PREVIEW_BYPASS_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

export class BackendError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'BackendError';
  }
}

/** Garante que existe backend real ou que o modo demo local é permitido. */
export function requireBackendOrLocalDemo(feature: string): void {
  if (isLocalDemoAllowed || isPreviewBypassActive()) return;
  if (isSupabaseConfigured) {
    // Com Supabase configurado nunca há cópia local (nem para tenant/id não-UUID).
    throw new BackendError(
      'LOCAL_FALLBACK_BLOCKED',
      `"${feature}": não foi possível usar o servidor para esta operação (sem fallback local).`
    );
  }
  throw new BackendError(
    'BACKEND_NOT_CONFIGURED',
    `Servidor não configurado: "${feature}" exige o Supabase (sem fallback local em produção).`
  );
}

/**
 * Executa o caminho do dataStore SOMENTE no modo demonstração local (DEV sem Supabase).
 * Com Supabase configurado lança erro: falha de servidor nunca vira dado fictício no navegador.
 */
export function localOnly<T>(feature: string, fn: () => T): T {
  requireBackendOrLocalDemo(feature);
  return fn();
}

/** Garante backend real (fluxos que nunca têm modo demo: PIX, cupons, PDV, mídia, analytics). */
export function requireBackend(feature: string): void {
  if (!isSupabaseConfigured) {
    throw new BackendError(
      'BACKEND_NOT_CONFIGURED',
      `Servidor não configurado: "${feature}" exige o Supabase.`
    );
  }
}

const KNOWN_PREFIX = /^([A-Z][A-Z0-9_]{2,}):\s*(.*)$/s;

/**
 * Converte o erro de uma RPC em BackendError. As RPCs N1–N6 lançam mensagens
 * no formato "CODIGO: mensagem legível" (ex.: COUPON_EXHAUSTED, PROMO_EXHAUSTED,
 * ORDER_CANCELLED_IS_FINAL, NOTE_REQUIRED, AUTH_REQUIRED).
 */
export function toBackendError(error: unknown, fallback = 'Falha ao comunicar com o servidor.'): BackendError {
  if (error instanceof BackendError) return error;
  const raw =
    (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string')
      ? (error as any).message as string
      : typeof error === 'string' ? error : '';
  const m = raw.match(KNOWN_PREFIX);
  if (m) return new BackendError(m[1], m[2] || raw);
  const pgCode = error && typeof error === 'object' && 'code' in error ? String((error as any).code || '') : '';
  if (pgCode === '42501') return new BackendError('FORBIDDEN', raw || 'Acesso negado.');
  return new BackendError('UNKNOWN', raw || fallback);
}

/** Chave de idempotência por tentativa de compra (reenvio com a mesma chave não duplica o pedido). */
export function newIdempotencyKey(): string {
  const c: any = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // RFC 4122 v4 a partir de getRandomValues
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
