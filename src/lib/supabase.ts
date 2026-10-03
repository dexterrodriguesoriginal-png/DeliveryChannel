import { createClient } from '@supabase/supabase-js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' ? process.env : {});
const supabaseUrl = env.VITE_SUPABASE_URL || '';
const supabasePublishableKey = 
  env.VITE_SUPABASE_PUBLISHABLE_KEY || 
  env.VITE_SUPABASE_ANON_KEY || 
  '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  supabasePublishableKey && 
  supabaseUrl.startsWith('https://')
);

// Cria o cliente Supabase único para todo o frontend.
// Usa estritamente a Publishable Key (Anon), sem secret key ou service_role.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabasePublishableKey || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
    global: {
      fetch: (...args) => fetch(...args),
    },
  }
);
