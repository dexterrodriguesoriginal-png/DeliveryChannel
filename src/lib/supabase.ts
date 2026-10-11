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

/**
 * Garante que a sessão Supabase atual esteja válida antes de operações autenticadas (como Storage).
 * Se o token estiver prestes a expirar ou expirado, faz refresh automático via auth.refreshSession().
 */
export async function ensureValidSession(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) {
      console.warn('[SupabaseAuth] Erro ao obter sessão atual:', sessionErr.message);
    }
    const session = sessionData?.session;
    const nowSec = Math.floor(Date.now() / 1000);
    // Se não há sessão, ou se o token expira nos próximos 60 segundos ou já expirou:
    const expiresAt = session?.expires_at ?? 0;
    const isExpiringSoon = !session || expiresAt <= nowSec + 60;

    if (isExpiringSoon) {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) {
        console.warn('[SupabaseAuth] Falha ao renovar sessão:', refreshErr.message);
        return Boolean(session);
      }
      return Boolean(refreshed.session);
    }
    return true;
  } catch (err) {
    console.warn('[SupabaseAuth] Falha inesperada ao validar sessão:', err);
    return false;
  }
}
