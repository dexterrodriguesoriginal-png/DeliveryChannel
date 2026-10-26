/** Configuração pública de produção, versionada. Nunca adicionar chaves ou tokens aqui. */
export const PUBLIC_CONFIG = Object.freeze({
  VITE_SUPABASE_URL: 'https://qjmhlbipmwobnuctzpft.supabase.co',
  VITE_BACKEND_SCHEMA: 'n1n6',
  VITE_DEPLOY_TARGET: 'production',
  VITE_N1N6_PRODUCTION_APPROVED: 'yes',
  PAYMENTS_PUBLIC_URL: 'https://deliverychannel.ai.studio',
});

export type PublicConfigEnv = Readonly<Record<string, unknown>>;

/** Env não vazia tem prioridade; espaços em branco são tratados como ausência. */
export function publicEnvValue(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback;
}

/** Puro e compartilhado pelo Vite, frontend e Express; não lê nem devolve credenciais. */
export function resolvePublicConfig(env: PublicConfigEnv) {
  return {
    VITE_SUPABASE_URL: publicEnvValue(env.VITE_SUPABASE_URL, PUBLIC_CONFIG.VITE_SUPABASE_URL),
    VITE_BACKEND_SCHEMA: publicEnvValue(env.VITE_BACKEND_SCHEMA, PUBLIC_CONFIG.VITE_BACKEND_SCHEMA),
    VITE_DEPLOY_TARGET: publicEnvValue(env.VITE_DEPLOY_TARGET, PUBLIC_CONFIG.VITE_DEPLOY_TARGET),
    VITE_N1N6_PRODUCTION_APPROVED: publicEnvValue(env.VITE_N1N6_PRODUCTION_APPROVED, PUBLIC_CONFIG.VITE_N1N6_PRODUCTION_APPROVED),
    PAYMENTS_PUBLIC_URL: publicEnvValue(env.PAYMENTS_PUBLIC_URL, PUBLIC_CONFIG.PAYMENTS_PUBLIC_URL),
  };
}
