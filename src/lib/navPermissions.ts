import { hasPermission, Permission } from '../services/rbac';
import { RoleId } from '../types';

/** Permissão exigida por aba do painel do estabelecimento (null = livre para qualquer papel do estabelecimento). */
export const EST_TAB_PERMISSION: Record<string, Permission | null> = {
  'est-dashboard': null,
  'est-orders': 'view_orders',
  'est-products': 'manage_products',
  'est-categories': 'manage_categories',
  'est-marketing': 'manage_offers',
  'est-qrcodes': 'manage_offers',
  'est-customers': 'manage_customers',
  'est-promotions': 'manage_offers',
  'est-offers': 'manage_offers',
  'est-drivers': 'manage_drivers',
  'est-inventory': 'manage_inventory',
  'est-theme': 'manage_theme',
  'est-finance': 'view_finance',
  'est-reports': 'view_finance',
  'est-team': 'manage_team',
  'est-settings': 'manage_settings',
  'est-modules': 'view_modules',
  'est-kitchen': 'manage_settings',
};

/** Apenas filtro de UI; a autorização real continua no backend/RLS. */
export function canAccessEstTab(role: RoleId | null | undefined, tabId: string): boolean {
  if (!(tabId in EST_TAB_PERMISSION)) return true;
  const perm = EST_TAB_PERMISSION[tabId];
  if (perm === null) return true;
  if (!role) return false;
  return hasPermission(role, perm);
}
