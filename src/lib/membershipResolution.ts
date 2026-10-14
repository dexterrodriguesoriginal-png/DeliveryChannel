import type { DriverApprovalStatus } from '../types';

/**
 * Resolução de vínculos (tenant_users.status) — F1.
 * Dois eixos separados: tenant_users.status (acesso) e drivers.approval_status (aprovação na loja).
 */
export type MembershipKind = 'ACTIVE' | 'PENDING_APPROVAL' | 'SUSPENDED' | 'INACTIVE' | 'EMPTY';

export interface MembershipRowLite {
  role_id: string;
  tenant_id: string;
  status: string;
}

/** Prioridade sem ACTIVE: PENDING > SUSPENDED > INACTIVE. Só a ausência total de linhas vira EMPTY. */
export function classifyMemberships(rows: MembershipRowLite[]): { kind: MembershipKind; row: MembershipRowLite | null } {
  if (!rows || rows.length === 0) return { kind: 'EMPTY', row: null };
  const by = (s: string) => rows.find(r => r.status === s) || null;
  const active = by('ACTIVE');
  if (active) return { kind: 'ACTIVE', row: active };
  const pending = by('PENDING');
  if (pending) return { kind: 'PENDING_APPROVAL', row: pending };
  const suspended = by('SUSPENDED');
  if (suspended) return { kind: 'SUSPENDED', row: suspended };
  const inactive = by('INACTIVE');
  if (inactive) return { kind: 'INACTIVE', row: inactive };
  // Só INVITED (ou valor desconhecido): sem acesso, mas tem linha → nunca "criar estabelecimento".
  return { kind: 'INACTIVE', row: rows[0] };
}

export type DriverScreenVariant = 'PENDING' | 'REJECTED' | 'SUSPENDED' | 'REMOVED' | 'INACTIVE' | 'UNAVAILABLE';

/**
 * Resultado da leitura do PRÓPRIO approval_status (RPC get_my_driver_approval, 0700 v3.2):
 * - um DriverApprovalStatus confirmado pelo servidor;
 * - 'NONE': o servidor confirmou que não há linha em drivers nesta loja;
 * - 'UNAVAILABLE': falha de leitura, RPC ausente, resposta nula ou inválida (NUNCA vira APPROVED);
 * - null: não se aplica (vínculo não é DRIVER).
 */
export type DriverApprovalLookup = DriverApprovalStatus | 'NONE' | 'UNAVAILABLE' | null;

const KNOWN_APPROVAL: readonly DriverApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REMOVED'];

/** Valor conhecido ou null. Sem fallback para APPROVED. */
export function normalizeApprovalStatus(raw: unknown): DriverApprovalStatus | null {
  return typeof raw === 'string' && (KNOWN_APPROVAL as readonly string[]).includes(raw) ? (raw as DriverApprovalStatus) : null;
}

/** Interpreta a resposta da RPC get_my_driver_approval. Qualquer coisa fora do contrato = UNAVAILABLE. */
export function parseOwnApprovalResponse(data: unknown): Exclude<DriverApprovalLookup, null> {
  const raw = (data && typeof data === 'object') ? (data as any).approval_status : undefined;
  if (raw === 'NONE') return 'NONE';
  return normalizeApprovalStatus(raw) ?? 'UNAVAILABLE';
}

/**
 * Qual tela o usuário vê (null = segue o fluxo normal). Eixos separados:
 * membershipStatus vem de tenant_users.status; approval vem de drivers.approval_status.
 * O app do entregador só abre com approval === 'APPROVED' confirmado.
 */
export function resolveDriverScreen(
  membershipStatus: string,
  activeRole: string | null,
  approval: DriverApprovalLookup,
): DriverScreenVariant | null {
  if (approval === 'UNAVAILABLE' && (membershipStatus === 'MEMBERSHIP_PENDING_APPROVAL' || membershipStatus === 'MEMBERSHIP_INACTIVE'
    || (membershipStatus === 'MEMBERSHIP_RESOLVED_WITH_DATA' && activeRole === 'DRIVER'))) {
    return 'UNAVAILABLE';
  }
  if (membershipStatus === 'MEMBERSHIP_PENDING_APPROVAL') {
    if (approval === 'REJECTED' || approval === 'REMOVED' || approval === 'SUSPENDED') return approval;
    return 'PENDING';
  }
  if (membershipStatus === 'MEMBERSHIP_INACTIVE') {
    // REJECTED/REMOVED prevalecem mesmo com tenant_users INACTIVE; ex-staff (approval null) → INACTIVE.
    if (approval === 'REJECTED' || approval === 'REMOVED') return approval;
    return 'INACTIVE';
  }
  if (membershipStatus === 'MEMBERSHIP_RESOLVED_WITH_DATA' && activeRole === 'DRIVER') {
    if (approval === 'APPROVED') return null;
    if (approval === 'PENDING' || approval === 'REJECTED' || approval === 'SUSPENDED' || approval === 'REMOVED') return approval;
    // NONE (vínculo DRIVER sem linha em drivers) ou null: não abre o app.
    return 'INACTIVE';
  }
  return null;
}

/** Defesa no DriverApp: só busca pedidos com aprovação confirmada. */
export function canFetchDriverOrders(approval: DriverApprovalLookup): boolean {
  return approval === 'APPROVED';
}
