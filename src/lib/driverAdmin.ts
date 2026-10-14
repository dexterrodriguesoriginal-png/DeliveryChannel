import type { Driver, DriverApprovalStatus, RoleId } from '../types';

/**
 * Permissões da aba Entregadores (decisão do CEO 14/10):
 * - OWNER/MANAGER: links + aprovar/rejeitar/suspender/reativar/remover.
 * - DELIVERY_MANAGER: só links (criar, listar, renovar, revogar).
 * - Demais papéis (ex.: CASHIER): sem acesso à aba (navPermissions).
 */
export function driverPagePermissions(role: RoleId | null | undefined): { canManageLinks: boolean; canReview: boolean } {
  const reviewer = role === 'OWNER' || role === 'MANAGER';
  return { canManageLinks: reviewer || role === 'DELIVERY_MANAGER', canReview: reviewer };
}

export type DriverLinkAction = 'SUSPEND' | 'REACTIVATE' | 'REMOVE';

/** Ações de vínculo por approval_status (sem reabertura para REJECTED/REMOVED; PENDING vai para Aprovar/Rejeitar). */
export function linkActionsFor(approval: DriverApprovalStatus | 'UNKNOWN' | undefined): DriverLinkAction[] {
  switch (approval) {
    case 'APPROVED': return ['SUSPEND', 'REMOVE'];
    case 'SUSPENDED': return ['REACTIVATE', 'REMOVE'];
    default: return [];
  }
}

/** Quem pode atribuir entregador (espelha assign_order_to_driver / list_assignable_drivers). */
export function canAssignDrivers(role: RoleId | null | undefined): boolean {
  return role === 'OWNER' || role === 'MANAGER' || role === 'DELIVERY_MANAGER' || role === 'CEO' || role === 'SUPER_ADMIN';
}

/** Seletor de atribuição: só APPROVED confirmado (ausente/UNKNOWN não entra). */
export function assignableDrivers(drivers: Driver[]): Driver[] {
  return drivers.filter(d => d.approvalStatus === 'APPROVED');
}

export function pendingApplications(drivers: Driver[]): Driver[] {
  return drivers.filter(d => d.approvalStatus === 'PENDING');
}

export function nonPendingDrivers(drivers: Driver[]): Driver[] {
  return drivers.filter(d => d.approvalStatus !== 'PENDING');
}
