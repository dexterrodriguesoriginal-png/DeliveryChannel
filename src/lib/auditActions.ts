/**
 * Ações de auditoria com grafia legada (fix R3, 14/10).
 * Linhas históricas NÃO são renomeadas no banco; a UI exibe e filtra pelo nome canônico
 * sem perder o valor original (busca pelo valor antigo continua encontrando).
 */
const LEGACY_AUDIT_ACTIONS: Record<string, string> = {
  DRIVER_APPLICATION_REJECTD: 'DRIVER_APPLICATION_REJECTED',
};

export function canonicalAuditAction(action: string | null | undefined): string {
  const a = String(action ?? '');
  return LEGACY_AUDIT_ACTIONS[a] ?? a;
}

/** Filtro de texto que casa tanto o valor gravado quanto o canônico. */
export function auditActionMatches(action: string | null | undefined, filter: string): boolean {
  const f = filter.toLowerCase();
  return String(action ?? '').toLowerCase().includes(f) || canonicalAuditAction(action).toLowerCase().includes(f);
}
