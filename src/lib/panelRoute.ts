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
  'est-products',
  'est-categories',
  'est-promotions',
  'est-offers',
  'est-customers',
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

export interface PanelRoute {
  page: string;
  tab?: string;
}

export function readPanelRoute(hash: string): PanelRoute | null {
  if (!hash.startsWith('#/painel/')) return null;

  try {
    const url = new URL(hash.slice(1), 'https://panel.invalid');
    const page = decodeURIComponent(url.pathname.slice('/painel/'.length));
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
  return `#/painel/${encodeURIComponent(route.page)}${search ? `?${search}` : ''}`;
}

export function isPanelPathname(pathname: string): boolean {
  return pathname === '/' || pathname === '/garcom' || pathname === '/entregador';
}
