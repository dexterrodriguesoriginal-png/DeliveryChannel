/**
 * Seletor de loja do painel (19/10): deixa claro QUAL loja está sendo administrada e mostra, para cada
 * loja do usuário, quantos pedidos novos (PENDING) estão esperando — mesmo vendo outra loja.
 * Só vínculos ATIVOS de equipe (dono/gerente/operador/caixa/gestão de entregas); entregador e cliente ficam de fora.
 */
export const STAFF_ROLES = ['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER', 'DELIVERY_MANAGER'] as const;

export interface MembershipLike {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  roleId: string;
  status: string;
}

export interface StoreSwitcherEntry {
  tenantId: string;
  name: string;
  slug: string;
  roleId: string;
  pending: number | null;
  isActive: boolean;
  /** "BAR DO NEY: 2 novos pedidos" */
  summary: string;
}

export function isStaffMembership(m: Pick<MembershipLike, 'roleId' | 'status'>): boolean {
  return m.status === 'ACTIVE' && (STAFF_ROLES as readonly string[]).includes(m.roleId);
}

export function pendingLabel(n: number | null | undefined): string {
  if (n == null) return '…';
  if (n === 0) return 'nenhum pedido novo';
  return n === 1 ? '1 novo pedido' : `${n} novos pedidos`;
}

export function buildStoreSwitcherEntries(
  memberships: readonly MembershipLike[],
  activeTenantId: string | null | undefined,
  pendingByTenant: Readonly<Record<string, number>> | null
): StoreSwitcherEntry[] {
  const seen = new Set<string>();
  const out: StoreSwitcherEntry[] = [];
  for (const m of memberships) {
    if (!isStaffMembership(m) || seen.has(m.tenantId)) continue;
    seen.add(m.tenantId);
    const name = (m.tenantName || m.tenantSlug || 'Loja').trim();
    const pending = pendingByTenant ? (pendingByTenant[m.tenantId] ?? 0) : null;
    out.push({
      tenantId: m.tenantId, name, slug: m.tenantSlug, roleId: m.roleId, pending,
      isActive: m.tenantId === activeTenantId,
      summary: `${name.toUpperCase()}: ${pendingLabel(pending)}`,
    });
  }
  // Loja atual primeiro; depois quem tem mais pedidos novos; depois nome.
  return out.sort((a, b) =>
    Number(b.isActive) - Number(a.isActive) || (b.pending ?? 0) - (a.pending ?? 0) || a.name.localeCompare(b.name, 'pt-BR'));
}

/** Pedidos novos em OUTRAS lojas (para o alerta "BAR DO NEY: 2 novos pedidos" enquanto vê outra loja). */
export function otherStoresWithPending(entries: readonly StoreSwitcherEntry[]): StoreSwitcherEntry[] {
  return entries.filter(e => !e.isActive && (e.pending ?? 0) > 0);
}

/** Conta PENDING por loja a partir das linhas { tenant_id } devolvidas pela consulta (RLS de equipe). */
export function countPendingRows(rows: readonly { tenant_id: string }[], tenantIds: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of tenantIds) out[id] = 0;
  for (const r of rows) if (r && r.tenant_id in out) out[r.tenant_id]++;
  return out;
}
