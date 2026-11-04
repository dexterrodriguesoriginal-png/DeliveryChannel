/** Garçons usam sua área dedicada; links administrativos nunca renderizam o painel do dono. */
export function waiterPanelTarget(role: string | null | undefined, slug: string | null | undefined, location: { pathname: string; hash: string }): string | null {
  if (role !== 'WAITER' || !slug) return null;
  const target = `/garcom/${encodeURIComponent(slug)}`;
  if (location.pathname.startsWith('/painel/') || location.pathname === '/painel' || location.hash.startsWith('#/painel/')) return target;
  if (/^\/(garcom(?:\/|$)|app\/|mesa\/|equipe\/)/.test(location.pathname)) return null;
  return target;
}
