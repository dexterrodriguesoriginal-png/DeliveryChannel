import { RoleId } from '../types';

export type Permission = 
  | 'view_orders'
  | 'manage_orders'
  | 'manage_products'
  | 'manage_categories'
  | 'manage_inventory'
  | 'manage_offers'
  | 'manage_customers'
  | 'view_finance'
  | 'manage_theme'
  | 'manage_team'
  | 'manage_drivers'
  | 'access_support_mode'
  | 'manage_tenants'
  | 'manage_sponsors'
  | 'view_audit_logs'
  | 'deliver_orders'
  | 'manage_settings';

export const ROLE_HIERARCHY: Record<RoleId, number> = {
  CEO: 100,
  SUPER_ADMIN: 95,
  OWNER: 80,
  MANAGER: 60,
  OPERATOR: 40,
  CASHIER: 35,
  DELIVERY_MANAGER: 30,
  DRIVER: 20,
  CUSTOMER: 10,
};

export const ROLE_PERMISSIONS: Record<RoleId, Permission[]> = {
  CEO: [
    'view_orders',
    'manage_orders',
    'manage_products',
    'manage_categories',
    'manage_inventory',
    'manage_offers',
    'manage_customers',
    'view_finance',
    'manage_theme',
    'manage_team',
    'manage_drivers',
    'access_support_mode',
    'manage_tenants',
    'manage_sponsors',
    'view_audit_logs',
    'manage_settings',
  ],
  SUPER_ADMIN: [
    'view_orders',
    'manage_orders',
    'manage_products',
    'manage_categories',
    'manage_inventory',
    'manage_offers',
    'manage_customers',
    'view_finance',
    'manage_theme',
    'manage_team',
    'manage_drivers',
    'access_support_mode',
    'manage_tenants',
    'view_audit_logs',
    'manage_settings',
  ],
  OWNER: [
    'view_orders',
    'manage_orders',
    'manage_products',
    'manage_categories',
    'manage_inventory',
    'manage_offers',
    'manage_customers',
    'view_finance',
    'manage_theme',
    'manage_team',
    'manage_drivers',
    'manage_settings',
  ],
  MANAGER: [
    'view_orders',
    'manage_orders',
    'manage_products',
    'manage_categories',
    'manage_inventory',
    'manage_offers',
    'manage_customers',
    'manage_drivers',
  ],
  OPERATOR: [
    'view_orders',
    'manage_orders',
    'manage_inventory',
  ],
  CASHIER: [
    'view_orders',
    'manage_orders',
  ],
  DELIVERY_MANAGER: [
    'view_orders',
    'manage_orders',
    'manage_drivers',
  ],
  DRIVER: [
    'deliver_orders',
  ],
  CUSTOMER: [],
};

export function hasPermission(role: RoleId, permission: Permission): boolean {
  const allowed = ROLE_PERMISSIONS[role] || [];
  return allowed.includes(permission);
}

export function canManageTenant(userRole: RoleId, userTenantId?: string, targetTenantId?: string): boolean {
  if (userRole === 'CEO' || userRole === 'SUPER_ADMIN') {
    return true;
  }
  if (!userTenantId || !targetTenantId) return false;
  return userTenantId === targetTenantId && (userRole === 'OWNER' || userRole === 'MANAGER');
}
