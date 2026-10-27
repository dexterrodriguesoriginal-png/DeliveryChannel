const PANEL_PAGES = new Set([
  'driver',
  'security-lab',
  'ceo-dashboard',
  'ceo-tenants',
  'ceo-sponsors',
  'ceo-finance',
  'ceo-audit',
  'ceo-support',
  'est-dashboard',
  'est-orders',
  'est-salon',
  'est-mesas-qr',
  'est-products',
  'est-quality',
  'est-categories',
  'est-promotions',
  'est-offers',
  'est-customers',
  'est-feedback',
  'est-marketing',
  'est-qrcodes',
  'est-theme',
  'est-drivers',
  'est-inventory',
  'est-finance',
  'est-reports',
  'est-team',
  'est-settings',
  'est-modules',
  'est-kitchen',
]);

/** Endereços "bonitos" do painel. A página interna segue se chamando est-modules; o nome visível é Ferramentas. */
const PAGE_ALIASES: Readonly<Record<string, string>> = { ferramentas: 'est-modules', modulos: 'est-modules' };
const PAGE_SLUGS: Readonly<Record<string, string>> = { 'est-modules': 'ferramentas' };

export interface PanelRoute {
  page: string;
  tab?: string;
}

export function readPanelRoute(hash: string): PanelRoute | null {
  if (!hash.startsWith('#/painel/')) return null;

  try {
    const url = new URL(hash.slice(1), 'https://panel.invalid');
    const raw = decodeURIComponent(url.pathname.slice('/painel/'.length));
    const page = PAGE_ALIASES[raw] || raw;
    if (!PANEL_PAGES.has(page)) return null;

    return { page, tab: url.searchParams.get('tab') || undefined };
  } catch {
    return null;
  }
}

export function panelRouteHash(route: PanelRoute): string {
  const query = new URLSearchParams();
  if (route.tab) query.set('tab', route.tab);
  const search = query.toString();
  return `#/painel/${encodeURIComponent(PAGE_SLUGS[route.page] || route.page)}${search ? `?${search}` : ''}`;
}

export function isPanelPathname(pathname: string): boolean {
  return pathname === '/' || pathname === '/garcom' || pathname === '/entregador';
}

/**
 * Endereço antigo/novo da página Ferramentas por caminho (/modulos, /ferramentas): devolve o destino dentro do painel
 * (/#/painel/ferramentas) ou null para qualquer outro caminho. Quem chama troca o endereço sem recarregar.
 */
export function toolsPathRedirect(pathname: string): string | null {
  return /^\/(modulos|ferramentas)\/?$/i.test(pathname) ? `/${panelRouteHash({ page: 'est-modules' })}` : null;
}
