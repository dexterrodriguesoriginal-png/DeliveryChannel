import { RoleId } from '../types';
import { panelRouteHash } from './panelRoute';

/** Names mirror has_store_permission; server remains the authority. */
export const EST_TAB_PERMISSION: Record<string, string> = {
  'est-dashboard': 'view_dashboard',
  'est-orders': 'view_orders',
  'est-salon': 'manage_tables',
  'est-mesas-qr': 'manage_tables',
  'est-products': 'manage_catalog',
  'est-quality': 'manage_catalog',
  'est-categories': 'manage_catalog',
  'est-marketing': 'manage_catalog',
  'est-qrcodes': 'manage_catalog',
  'est-customers': 'manage_cashier',
  'est-feedback': 'view_reports',
  'est-promotions': 'manage_catalog',
  'est-offers': 'manage_catalog',
  'est-drivers': 'dispatch_orders',
  'est-inventory': 'manage_inventory',
  'est-theme': 'manage_subscription',
  'est-finance': 'view_finances',
  'est-reports': 'view_reports',
  'est-team': 'manage_team',
  'est-settings': 'manage_subscription',
  'est-modules': 'manage_subscription',
  'est-kitchen': 'manage_kitchen',
};

const DEFAULT_PERMISSIONS: Partial<Record<RoleId, readonly string[]>> = {
  MANAGER: ['view_dashboard','view_orders','manage_orders','manage_catalog','manage_team','view_reports','manage_inventory','manage_tables','manage_kitchen','dispatch_orders'],
  CASHIER: ['view_orders','manage_orders','manage_cashier','manage_tables'],
  KITCHEN: ['manage_kitchen'],
  WAITER: ['waiter','manage_tables'],
  OPERATOR: ['manage_inventory','manage_catalog'],
  DELIVERY_MANAGER: ['view_orders','dispatch_orders'],
};

export const CASHIER_ALLOWED_TABS: ReadonlySet<string> = new Set(['est-orders', 'est-salon', 'est-customers']);
export const WAITER_ALLOWED_TABS: ReadonlySet<string> = new Set(['est-salon']);
export const KITCHEN_ALLOWED_TABS: ReadonlySet<string> = new Set(['est-kitchen']);

/** Null is used only before the server's permission snapshot is available. */
export function canAccessEstTab(role: RoleId | null | undefined, tabId: string, permissions?: readonly string[] | null): boolean {
  if (!role) return false;
  if (tabId === 'security-lab') return role === 'CEO' || role === 'SUPER_ADMIN';
  if (!(tabId in EST_TAB_PERMISSION)) return false;
  // Feedback is private to the establishment; global support roles do not enter it.
  if (tabId === 'est-feedback' && role !== 'OWNER' && role !== 'MANAGER') return false;
  if (tabId === 'est-mesas-qr' && !['OWNER','MANAGER','CEO','SUPER_ADMIN'].includes(role)) return false;
  if (role === 'CEO' || role === 'SUPER_ADMIN' || role === 'OWNER') return true;
  if (role === 'DRIVER' || role === 'CUSTOMER') return false;
  // Dedicated roles never open the full OrdersPage, which contains customer data.
  if (role === 'KITCHEN' && !KITCHEN_ALLOWED_TABS.has(tabId)) return false;
  if (role === 'WAITER' && !WAITER_ALLOWED_TABS.has(tabId)) return false;
  // Sensitive finance/subscription is reserved for the owner, including custom grants.
  if (['view_finances', 'manage_subscription'].includes(EST_TAB_PERMISSION[tabId])) return false;
  const effective = permissions ?? DEFAULT_PERMISSIONS[role] ?? [];
  return effective.includes(EST_TAB_PERMISSION[tabId]);
}

/** First screen after login, or when a forbidden route is requested. */
export function getDefaultAllowedTab(role: RoleId | null | undefined, permissions?: readonly string[] | null): string {
  const preferred: Partial<Record<RoleId, string>> = {
    CEO: 'ceo-dashboard', SUPER_ADMIN: 'ceo-dashboard', OWNER: 'est-dashboard', MANAGER: 'est-dashboard',
    CASHIER: 'est-orders', KITCHEN: 'est-kitchen', WAITER: 'est-salon',
    OPERATOR: 'est-inventory', DELIVERY_MANAGER: 'est-drivers',
  };
  const tab = role ? preferred[role] : undefined;
  if (role === 'CEO' || role === 'SUPER_ADMIN') return 'ceo-dashboard';
  if (tab && canAccessEstTab(role, tab, permissions)) return tab;
  return Object.keys(EST_TAB_PERMISSION).find(candidate => canAccessEstTab(role, candidate, permissions)) || 'access-denied';
}

export function roleDestination(role: RoleId | null | undefined, slug: string, permissions?: readonly string[] | null): string {
  if (role === 'WAITER') return `/garcom/${encodeURIComponent(slug)}`;
  if (role === 'KITCHEN') return '/cozinha';
  if (role === 'DRIVER') return '/entregador';
  return `/${panelRouteHash({ page: getDefaultAllowedTab(role, permissions) })}`;
}

