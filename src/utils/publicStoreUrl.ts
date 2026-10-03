/**
 * ADEGAFOOD — HELPER CENTRAL CANÔNICO DE URL PÚBLICA DO ESTABELECIMENTO (COMANDO 72)
 * 
 * Regras Estritas:
 * 1. O slug é obrigatório e não pode ser vazio ou nulo.
 * 2. O slug deve seguir o formato canônico regex: ^[a-z0-9]+(-[a-z0-9]+)*$
 * 3. Rejeita categoricamente placeholders genéricos ou fallbacks falsos:
 *    ('estabelecimento', 'seu-negocio', 'nome-da-loja', 'meu-estabelecimento', 'default', 'loja', etc.)
 * 4. Retorna a URL canônica única: ${window.location.origin}/app/${slug}
 * 5. NUNCA fabrica URL falsa quando o slug for inválido ou ausente.
 */

const FORBIDDEN_PLACEHOLDER_SLUGS = new Set([
  'estabelecimento',
  'seu-negocio',
  'nome-da-loja',
  'meu-estabelecimento',
  'default',
  'loja',
  'placeholder',
  'undefined',
  'null',
]);

const SLUG_CANONICAL_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Valida se uma string é um slug válido e permitido para URLs públicas.
 */
export function isValidStoreSlug(slug: unknown): slug is string {
  if (typeof slug !== 'string') return false;
  const clean = slug.trim().toLowerCase();
  if (!clean || clean.length < 3 || clean.length > 64) return false;
  if (FORBIDDEN_PLACEHOLDER_SLUGS.has(clean)) return false;
  return SLUG_CANONICAL_REGEX.test(clean);
}

/**
 * Retorna a URL pública completa para o Web App do estabelecimento.
 * Lança um erro explícito caso o slug seja inválido ou placeholder proibido.
 */
export function getPublicStoreUrl(slug: string | null | undefined): string {
  if (!slug) {
    throw new Error('Identificador da loja (slug) não informado.');
  }

  const cleanSlug = slug.trim().toLowerCase();

  if (!isValidStoreSlug(cleanSlug)) {
    if (FORBIDDEN_PLACEHOLDER_SLUGS.has(cleanSlug)) {
      throw new Error(
        `O identificador "${cleanSlug}" é um placeholder genérico proibido e não pode ser usado para gerar link público.`
      );
    }
    throw new Error(
      `O identificador "${slug}" é inválido. Ele deve conter apenas letras minúsculas, números e hífens.`
    );
  }

  const origin = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin
    : 'https://adegafood.ai.studio';

  return `${origin}/app/${cleanSlug}`;
}

/**
 * Retorna o path relativo /app/:slug de forma validada.
 */
export function getPublicStorePath(slug: string | null | undefined): string {
  if (!isValidStoreSlug(slug)) {
    throw new Error('Identificador da loja (slug) inválido ou ausente.');
  }
  return `/app/${slug.trim().toLowerCase()}`;
}

/**
 * Versão segura que retorna null caso o slug seja inválido (sem disparar exceção),
 * útil para renders condicionais que mostram skeleton ou alerta de carregamento.
 */
export function getSafePublicStoreUrl(slug: string | null | undefined): string | null {
  try {
    return getPublicStoreUrl(slug);
  } catch {
    return null;
  }
}
