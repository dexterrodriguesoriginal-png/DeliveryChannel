import { isSupabaseConfigured, supabase } from '../supabase';

/**
 * Chamar somente após o tema ser persistido. Autenticação e autorização por tenant
 * são revalidadas pelo servidor; jamais enviar credenciais na URL.
 * Falhas não revertem uma gravação que já foi concluída.
 */
export async function invalidateStorePwaCache(tenantId: string, slug: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return false;
    const response = await fetch('/api/pwa/invalidate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ tenantId, slug }),
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}
