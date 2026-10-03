import { RoleId, AuditLog } from '../types';
import { hasPermission, Permission } from './rbac';

export class AccessDeniedSecurityException extends Error {
  public code: string;
  public details: {
    attemptedTenantId: string;
    actualTenantId?: string;
    userId: string;
    userRole: RoleId;
    action: string;
    reason: string;
  };

  constructor(details: {
    attemptedTenantId: string;
    actualTenantId?: string;
    userId: string;
    userRole: RoleId;
    action: string;
    reason: string;
  }) {
    super(`[ACESSO NEGADO - SEGURANÇA ADEGAFOOD]: Violação de isolamento multi-tenant detectada. Ação "${details.action}" bloqueada no backend.`);
    this.name = 'AccessDeniedSecurityException';
    this.code = 'ERR_CROSS_TENANT_VIOLATION_403';
    this.details = details;
  }
}

export class PrivilegeEscalationSecurityException extends Error {
  public code: string;

  constructor(role: RoleId, requiredPermission: Permission) {
    super(`[ACESSO NEGADO]: O papel "${role}" não possui a permissão requerida "${requiredPermission}". Ação bloqueada.`);
    this.name = 'PrivilegeEscalationSecurityException';
    this.code = 'ERR_INSUFFICIENT_PERMISSIONS_403';
  }
}

export interface SecurityContext {
  userId: string;
  userName: string;
  userRole: RoleId;
  tenantId?: string;
  isCeoSupportMode?: boolean;
}

/**
 * Motor central de validação de isolamento multi-tenant no backend/camada de dados.
 * Garante que mesmo com manipulação de parâmetros, requisições cruzadas são sumariamente bloqueadas.
 */
export function validateTenantAccess(
  context: SecurityContext,
  targetTenantId: string,
  action: string,
  logAuditViolation?: (log: Omit<AuditLog, 'id' | 'timestamp'>) => void
): void {
  // CEO em Modo Suporte explícito pode acessar, mas toda ação é sinalizada
  if ((context.userRole === 'CEO' || context.userRole === 'SUPER_ADMIN') && context.isCeoSupportMode) {
    return;
  }

  // Se o usuário não é do tenant solicitado, bloqueia sumariamente (Zero-Trust)
  if (context.tenantId !== targetTenantId) {
    const errorDetails = {
      attemptedTenantId: targetTenantId,
      actualTenantId: context.tenantId,
      userId: context.userId,
      userRole: context.userRole,
      action,
      reason: `Tentativa de acesso não autorizado: Usuário ${context.userName} (Tenant: ${context.tenantId || 'GLOBAL'}) tentou acessar dados do Tenant ${targetTenantId}.`,
    };

    // Registra violação no Audit Log para rastreabilidade forense
    if (logAuditViolation) {
      logAuditViolation({
        userId: context.userId,
        userName: context.userName,
        userRole: context.userRole,
        tenantId: targetTenantId,
        action: `SECURITY_ALERT_${action.toUpperCase()}`,
        resource: 'TENANT_BOUNDARY',
        resourceId: targetTenantId,
        details: errorDetails.reason,
        ipAddress: '127.0.0.1 (Anti-Tamper Shield)',
        isCeoSupport: false,
      });
    }

    throw new AccessDeniedSecurityException(errorDetails);
  }
}

export function validatePermission(
  context: SecurityContext,
  permission: Permission
): void {
  if (context.userRole === 'CEO' || context.userRole === 'SUPER_ADMIN') {
    return;
  }

  if (!hasPermission(context.userRole, permission)) {
    throw new PrivilegeEscalationSecurityException(context.userRole, permission);
  }
}
