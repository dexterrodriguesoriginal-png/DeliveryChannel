import type { RoleId } from '../types';

export const TEAM_ROLES: readonly RoleId[] = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'WAITER', 'OPERATOR', 'DELIVERY_MANAGER', 'DRIVER'];
export const TEAM_ROLE_LABELS: Partial<Record<RoleId, string>> = {
  OWNER: 'Dono', MANAGER: 'Gerente', CASHIER: 'Caixa', KITCHEN: 'Cozinha', WAITER: 'Garçom',
  OPERATOR: 'Estoque/Separação', DELIVERY_MANAGER: 'Coordenador de Entregas', DRIVER: 'Entregador',
};
export const STORE_PERMISSION_LABELS: Record<string, string> = {
  view_dashboard: 'Painel da operação', view_orders: 'Ver pedidos', manage_orders: 'Gerenciar pedidos',
  manage_catalog: 'Cardápio e produtos', manage_team: 'Gerenciar equipe', view_reports: 'Relatórios',
  view_finances: 'Financeiro sensível', manage_subscription: 'Assinatura', manage_cashier: 'Caixa e recebimentos',
  manage_tables: 'Mesas', manage_kitchen: 'Cozinha', manage_inventory: 'Estoque e separação',
  dispatch_orders: 'Despachar entregas', view_assigned_orders: 'Ver suas entregas', deliver_orders: 'Realizar suas entregas', waiter: 'Atendimento do garçom',
};
export interface StoreTools { waiter: boolean; kitchen: boolean }
export function visibleTeamRoles(tools: StoreTools): RoleId[] {
  return TEAM_ROLES.filter(role => role !== 'WAITER' || tools.waiter).filter(role => role !== 'KITCHEN' || tools.kitchen);
}
export function roleFromTeamPath(value: string): RoleId | null {
  const role = value.toUpperCase() as RoleId;
  return TEAM_ROLES.includes(role) ? role : null;
}
export function teamRolePath(slug: string, role: RoleId, signup = true): string {
  const base = role === 'WAITER' ? `/garcom/${encodeURIComponent(slug)}` : `/equipe/${encodeURIComponent(slug)}/${role.toLowerCase()}`;
  return signup && role !== 'OWNER' ? `${base}?signup=1` : base;
}

/** Dedicated apps keep a fixed data boundary even when the owner customizes other roles. */
export function canCustomizeRolePermission(role: RoleId, permission: string): boolean {
  if (role === 'OWNER' || ['view_finances', 'manage_subscription'].includes(permission)) return false;
  const ceilings: Partial<Record<RoleId, readonly string[]>> = {
    KITCHEN: ['manage_kitchen'], WAITER: ['waiter', 'manage_tables'], DRIVER: ['view_assigned_orders', 'deliver_orders'],
  };
  return !ceilings[role] || ceilings[role]!.includes(permission);
}
