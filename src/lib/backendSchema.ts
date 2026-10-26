/**
 * Compatibilidade de backend do frontend (estratégia de ativação N1–N6).
 *
 * O frontend escolhe o caminho de servidor pela configuração pública de produção,
 * com possibilidade de sobrescrita por variável de ambiente:
 *
 *   VITE_BACKEND_SCHEMA=legacy-020   (sobrescrita explícita; também usado se o valor for inválido)
 *   VITE_BACKEND_SCHEMA=n1n6         (padrão de produção versionado)
 *
 * - legacy-020: usa apenas RPCs/tabelas existentes em 001–020 (ex.: process_checkout_atomic,
 *   UPDATE de orders sob RLS de staff). Recursos que só existem no N1–N6 (cupons, PDV atômico,
 *   checkout promocional, PIX por pedido, mídia/campanhas N3/N5) ficam indisponíveis com
 *   mensagem clara — nunca caem para localStorage/mock.
 * - n1n6: usa exclusivamente as RPCs novas (update_order_status, process_pos_sale_atomic,
 *   process_checkout_atomic_v2, process_promotional_checkout_atomic, get_order_pix_payload,
 *   validate_coupon[_pos], upsert_tenant_payment_settings, mídia N3, campanhas N5, get_public_store N6).
 *
 * Ver docs/n1-n6/ATIVACAO_FRONTEND.md.
 */
import { resolvePublicConfig } from '../config/publicConfig';

export type BackendSchema = 'legacy-020' | 'n1n6';

export function resolveBackendSchema(raw: unknown): BackendSchema {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'n1n6' ? 'n1n6' : 'legacy-020';
}

const env: Record<string, unknown> =
  typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : {};


/** Modo efetivo (lido do ambiente do build; resolvido na chamada; em testes Node lê process.env). */
export const currentBackendSchema = (): BackendSchema =>
  resolveBackendSchema(
    resolvePublicConfig(typeof process !== 'undefined' && process.env
      ? process.env
      : env).VITE_BACKEND_SCHEMA
  );

/** Valor no carregamento do módulo (exibição/diagnóstico). Decisões usam isN1N6Backend(). */
export const BACKEND_SCHEMA: BackendSchema = currentBackendSchema();

/** true quando o build foi feito para um banco com N1–N6 aplicadas. */
export const isN1N6Backend = (): boolean => currentBackendSchema() === 'n1n6';

export const N1N6_ONLY_MESSAGE =
  'Recurso disponível após a ativação do novo backend (N1–N6). Neste ambiente ele ainda não está ativo.';
