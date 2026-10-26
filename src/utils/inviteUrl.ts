/**
 * URL pública do convite de entregador (F7).
 * O banco devolve só o caminho relativo '/entregador/convite/<token>'; o domínio NÃO é fixo no código:
 * usa VITE_PUBLIC_APP_ORIGIN e, se não houver, window.location.origin (decisão 14/10).
 */
export const INVITE_PATH_PREFIX = '/entregador/convite/';

export function buildInviteUrl(relative: string, origin?: string): string {
  if (typeof relative !== 'string' || !relative.startsWith(INVITE_PATH_PREFIX) || relative.length <= INVITE_PATH_PREFIX.length) {
    throw new Error('URL de convite inesperada');
  }
  const configured = origin ?? (import.meta.env.VITE_PUBLIC_APP_ORIGIN as string | undefined);
  const base = (configured || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  // Nunca gerar QR com URL relativa.
  if (!/^https?:\/\/[^/]+$/i.test(base)) throw new Error('Origem pública inválida para o convite');
  return base + relative;
}

/** Link do WhatsApp com a mesma URL do QR/Copiar. */
export function buildWhatsAppInviteLink(storeName: string, publicUrl: string): string {
  return 'https://wa.me/?text=' + encodeURIComponent(`Cadastre-se como entregador da ${storeName}: ${publicUrl}`);
}

/** Extrai o token de /entregador/convite/:token (null se não for a rota). */
export function inviteTokenFromPath(pathname: string): string | null {
  if (!pathname.startsWith(INVITE_PATH_PREFIX)) return null;
  const t = pathname.slice(INVITE_PATH_PREFIX.length).split('/')[0];
  try { return t ? decodeURIComponent(t) : null; } catch { return null; }
}

export const INVITE_TOKEN_SESSION_KEY = 'driver_invite_token';

/** Rota curta de retorno do OAuth: token recuperado só da sessão da aba. */
export function inviteTokenFromLocation(loc: { pathname: string; search: string }, session: Pick<Storage, 'getItem'>): string | null {
  const pathToken = inviteTokenFromPath(loc.pathname);
  if (pathToken) return pathToken;
  if (loc.pathname !== '/convite-entregador' && loc.pathname !== '/entregador/convite') return null;
  try { return new URLSearchParams(loc.search).get('token') || session.getItem(INVITE_TOKEN_SESSION_KEY); }
  catch { return null; }
}
