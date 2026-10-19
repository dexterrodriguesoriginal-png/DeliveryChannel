import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) ? (import.meta as any).env : (typeof process !== 'undefined' ? process.env : {});

/**
 * 19/10: cliente separado para o tablet da cozinha (login anônimo do aparelho).
 * storageKey próprio: a sessão do aparelho nunca se mistura com a do painel.
 */
let client: SupabaseClient | null = null;
export function kitchenClient(): SupabaseClient {
  if (!client) {
    client = createClient(env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
      env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || 'placeholder-key', {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'dc-kitchen-auth' },
      });
  }
  return client;
}
