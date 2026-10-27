import { hasPermission, Permission } from '../services/rbac';
import { RoleId } from '../types';

/** Permissão exigida por aba do painel do estabelecimento (null = livre para qualquer papel do estabelecimento). */
export const EST_TAB_PERMISSION: Record<string, Permission | null> = {
  'est-dashboard': null,
  'est-orders': 'view_orders',
  'est-salon': 'view_orders',
  'est-products': 'manage_products',
  'est-quality': 'manage_products',
  'est-categories': 'manage_categories',
  'est-marketing': 'manage_offers',
  'est-qrcodes': 'manage_offers',
  'est-customers': 'manage_customers',
  'est-feedback': null,
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

export const CASHIER_ALLOWED_TABS: ReadonlySet<string> = new Set([
  'est-dashboard',
  'est-orders',
  'est-salon',
  'est-customers',
]);

export const WAITER_ALLOWED_TABS: ReadonlySet<string> = new Set([
  'est-orders',
  'est-salon',
]);

export const KITCHEN_ALLOWED_TABS: ReadonlySet<string> = new Set([
  'est-orders',
  'est-kitchen',
]);

/** Aba padrão permitida para redirecionamento quando o usuário tenta acessar uma aba proibida. */
export function getDefaultAllowedTab(role: RoleId | null | undefined): string {
  if (role === 'WAITER' || role === 'KITCHEN') return 'est-orders';
  return 'est-dashboard';
}

/**
 * Filtro de UI e rotas; a autorização real continua no backend/RLS.
 * Matriz estrita:
 * - DRIVER: nunca vê o painel do estabelecimento (vai para DriverApp)
 * - CASHIER: Dashboard, Pedidos, Salão, Clientes
 * - WAITER: Pedidos, Salão
 * - KITCHEN: Pedidos, Cozinha
 * - security-lab: estritamente restrito a CEO e SUPER_ADMIN
 */
export function canAccessEstTab(role: RoleId | null | undefined, tabId: string): boolean {
  if (!role) return false;
  if (tabId === 'est-feedback') return role === 'OWNER' || role === 'MANAGER';
  if (role === 'DRIVER' || role === 'CUSTOMER') return false;

  // Laboratório de segurança: somente CEO e SUPER_ADMIN
  if (tabId === 'security-lab') {
    return role === 'CEO' || role === 'SUPER_ADMIN';
  }

  if (role === 'CEO' || role === 'SUPER_ADMIN' || role === 'OWNER') {
    return true;
  }

  if (role === 'CASHIER') {
    return CASHIER_ALLOWED_TABS.has(tabId);
  }

  if (role === 'WAITER') {
    return WAITER_ALLOWED_TABS.has(tabId);
  }

  if (role === 'KITCHEN') {
    return KITCHEN_ALLOWED_TABS.has(tabId);
  }

  // MANAGER, OPERATOR, DELIVERY_MANAGER, etc.
  if (tabId === 'est-salon') {
    return role === 'MANAGER';
  }

  if (!(tabId in EST_TAB_PERMISSION)) {
    return false;
  }

  const perm = EST_TAB_PERMISSION[tabId];
  if (perm === null) return true;
  return hasPermission(role, perm);
}
