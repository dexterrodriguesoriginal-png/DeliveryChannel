import { createClient } from '@supabase/supabase-js';
import { supabase, supabaseUrl } from '../lib/supabase';
import type { TenantTheme } from '../types';

// Cliente isolado: /tv nunca herda nem persiste uma sessão de funcionário.
const config = import.meta.env;
const createTvClient = () => createClient(supabaseUrl || 'https://placeholder.supabase.co', config.VITE_SUPABASE_PUBLISHABLE_KEY || config.VITE_SUPABASE_ANON_KEY || 'placeholder-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const tvClient = createTvClient();
export interface TvEntry { code: string; name: string | null; kind: 'ready' | 'called' }
export interface TvData { ok: true; storeName: string; theme: Partial<TenantTheme>; entries: TvEntry[] }
export interface TvDevice { id: string; label: string; lastSeenAt: string | null }
const key = 'dc.tv.device.v1';
async function admin<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error('Não foi possível gerenciar a TV. Verifique sua permissão e tente novamente.');
  return data as T;
}
export const tvAccessRepository = {
  readToken(): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  clearToken() { try { localStorage.removeItem(key); } catch { /* navegador restrito */ } },
  async pair(code: string): Promise<string> {
    const { data, error } = await tvClient.rpc('tv_pair', { p_code: code });
    if (error) throw new Error('Não foi possível conectar. Tente novamente.');
    if (!data?.ok) throw new Error(data?.reason === 'RATE_LIMITED' ? 'Limite de pareamento atingido (5 tentativas por origem ou limite compartilhado). Aguarde 10 minutos.' : 'Código inválido, expirado ou já utilizado.');
    try { localStorage.setItem(key, data.token); } catch { throw new Error('Permita o armazenamento neste navegador para ativar a TV.'); }
    return data.token;
  },
  async activateAsStaff(slug: string, label: string, email: string, password: string): Promise<string> {
    // Autenticação somente em memória, sem alterar a sessão administrativa deste navegador.
    const staffClient = createTvClient();
    const { error: loginError } = await staffClient.auth.signInWithPassword({ email: email.trim(), password });
    if (loginError) throw new Error('E-mail ou senha inválidos.');
    try {
      const { data, error } = await staffClient.rpc('tv_activate_as_staff', { p_slug: slug, p_label: label });
      if (error || !data?.ok) throw new Error('Somente o dono ou gerente desta loja pode ativar a TV.');
      localStorage.setItem(key, data.token);
      return data.token;
    } finally { await staffClient.auth.signOut({ scope: 'local' }); }
  },
  async read(token: string): Promise<TvData | null> {
    const { data, error } = await tvClient.rpc('tv_read', { p_token: token });
    if (error) throw new Error('Sem conexão. Tentando novamente...');
    return data?.ok ? data as TvData : null;
  },
  subscribe(token: string, refresh: () => void) {
    // Canal opaco calculado localmente. Sem transmissão de linhas de pedidos.
    let disposed = false;
    let channel: ReturnType<typeof tvClient.channel> | undefined;
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)).then(bytes => {
      if (disposed) return;
      const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      channel = tvClient.channel(`tv-${hash}`).on('broadcast', { event: 'refresh' }, refresh).subscribe();
    }).catch(() => { /* polling mantém a atualização se realtime estiver indisponível */ });
    return () => { disposed = true; if (channel) void tvClient.removeChannel(channel); };
  },
  createCode: (tenant: string, label: string) => admin<{ code: string; expiresAt: string }>('admin_create_tv_code', { p_tenant: tenant, p_label: label }),
  list: (tenant: string) => admin<TvDevice[]>('admin_list_tvs', { p_tenant: tenant }),
  revoke: (tenant: string, device: string) => admin<void>('admin_revoke_tv', { p_tenant: tenant, p_device: device }),
};
