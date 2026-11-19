/**
 * "Baixar versão atualizada" (src/lib/pwa/appIdentity.ts). Lojas desta lista ficam SEMPRE versionadas (teste).
 * Demais lojas: só depois de trocarem a logo (theme_tokens.meta.appBaseLogoUrl, ver src/lib/pwa/appBaseLogo.ts);
 * até lá nenhum byte muda (manifesto, HTML e /api/pwa/version).
 */
export const IDENTITY_TEST_SLUGS_ENV = 'PWA_IDENTITY_TEST_SLUGS';
export const DEFAULT_IDENTITY_TEST_SLUGS: readonly string[] = ['mercado-teste-dc'];

/** Env definida (mesmo vazia) substitui a lista padrão; valores separados por vírgula/espaço. */
export function resolveIdentityTestSlugs(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[IDENTITY_TEST_SLUGS_ENV];
  if (raw === undefined) return [...DEFAULT_IDENTITY_TEST_SLUGS];
  return raw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}
