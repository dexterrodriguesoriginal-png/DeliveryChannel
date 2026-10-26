import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolvePublicConfig } from '../../config/publicConfig';

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' ? process.env : {});

/**
 * 19/10: cliente separado para o tablet da cozinha (login anônimo do aparelho).
 * storageKey próprio: a sessão do aparelho nunca se mistura com a do painel.
 */
let client: SupabaseClient | null = null;
export function kitchenClient(): SupabaseClient {
  if (!client) {
    client = createClient(resolvePublicConfig(env).VITE_SUPABASE_URL,
      env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || 'placeholder-key', {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'dc-kitchen-auth' },
      });
  }
  return client;
}
