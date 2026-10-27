/**
 * Atualização rápida do app do cliente quando a loja salva o Design do App.
 *
 * Canal de Realtime *broadcast* público por loja (`store-theme:<tenantId>`): o painel envia só um aviso
 * ("tema atualizado", sem dados) e o app aberto relê o tema pela RPC pública get_public_store. Nenhuma
 * tabela é exposta ao anon (RLS intacto, somente leitura). Um aviso falso só causa uma releitura, limitada
 * por intervalo mínimo. Se o Realtime falhar, o app ainda atualiza ao voltar para o primeiro plano e por poll curto.
 */
export const THEME_PING_EVENT = 'theme-updated';
/** Intervalos (ms): releitura mínima por aviso/foco e poll enquanto o app está visível. */
export const THEME_PING_MIN_MS = 3_000;
export const THEME_POLL_MS = 30_000;

export const themeChannelName = (tenantId: string) => `store-theme:${tenantId}`;

interface RealtimeLike {
  channel: (name: string, opts?: unknown) => {
    on: (type: string, filter: unknown, cb: (p: unknown) => void) => any;
    subscribe: (cb?: (status: string) => void) => any;
    send: (msg: unknown) => Promise<unknown>;
  };
  removeChannel: (ch: unknown) => Promise<unknown> | unknown;
}

/** Painel do lojista: avisa os apps abertos (melhor esforço; nunca quebra o salvar). */
export async function announceThemeUpdated(client: RealtimeLike, tenantId: string): Promise<void> {
  if (!tenantId) return;
  try {
    const ch = client.channel(themeChannelName(tenantId));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 4000);
      ch.subscribe((status: string) => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } });
    });
    await ch.send({ type: 'broadcast', event: THEME_PING_EVENT, payload: { at: Date.now() } });
    setTimeout(() => { void client.removeChannel(ch); }, 1500);
  } catch { /* melhor esforço */ }
}

/** App do cliente: chama onPing a cada aviso. Retorna a função de cancelar. */
export function subscribeThemeUpdates(client: RealtimeLike, tenantId: string, onPing: () => void): () => void {
  if (!tenantId) return () => {};
  try {
    const ch = client.channel(themeChannelName(tenantId));
    ch.on('broadcast', { event: THEME_PING_EVENT }, () => onPing()).subscribe();
    return () => { void client.removeChannel(ch); };
  } catch {
    return () => {};
  }
}

export function shouldRefetchTheme(lastAt: number, now: number, minMs: number): boolean {
  return now - lastAt >= minMs;
}

/** Painel: avisa os apps abertos que o tema desta loja mudou (carrega o cliente Supabase só quando precisa). */
export async function announceThemeSaved(tenantId: string): Promise<void> {
  try {
    const mod = await import('../supabase');
    if (!mod.isSupabaseConfigured) return;
    await announceThemeUpdated(mod.supabase as unknown as RealtimeLike, tenantId);
  } catch { /* melhor esforço */ }
}
