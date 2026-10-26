import { publicEnvValue, resolvePublicConfig } from '../../src/config/publicConfig';

/** Runtime Express: preserva SUPABASE_URL → VITE_SUPABASE_URL → URL fixa de produção. */
export function resolveServerPublicConfig(env: NodeJS.ProcessEnv) {
  const config = resolvePublicConfig(env);
  return {
    SUPABASE_URL: publicEnvValue(env.SUPABASE_URL, config.VITE_SUPABASE_URL),
    PAYMENTS_PUBLIC_URL: config.PAYMENTS_PUBLIC_URL,
  };
}
