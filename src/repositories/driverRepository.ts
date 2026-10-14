import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Driver, DriverStatus, DriverApprovalStatus } from '../types';
import { normalizeApprovalStatus, parseOwnApprovalResponse, DriverApprovalLookup } from '../lib/membershipResolution';
import { SecurityContext } from '../services/securityEngine';
import { teamRepository } from './teamRepository';
import { dataStore } from '../services/dataStore';
import { isValidUuid } from '../lib/uuid';
import { localOnly } from '../lib/backend';
import { buildDeliveryCountByUserId, deliveryCountForDriver } from '../lib/driverDeliveryCounts';

export function mapRowToDriver(row: any, completedToday = 0): Driver {
  const isOnline = row.status === 'AVAILABLE' || row.status === 'ON_DELIVERY';
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    name: row.full_name,
    phone: row.phone,
    document: row.document || undefined,
    vehicle: row.vehicle_model ? `${row.vehicle_model} (${row.vehicle_type || 'MOTO'})` : (row.vehicle_type || 'MOTO'),
    vehicleType: row.vehicle_type || 'MOTO',
    vehicleModel: row.vehicle_model || '',
    plate: row.vehicle_plate || 'PLACA N/D',
    status: (row.status as DriverStatus) || 'AVAILABLE',
    // Sem fallback: coluna ausente (antes da 0700), null ou valor inválido = UNKNOWN (não atribuível).
    approvalStatus: normalizeApprovalStatus(row.approval_status) ?? 'UNKNOWN',
    isOnline,
    completedDeliveriesToday: completedToday,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Linha de list_assignable_drivers (0700 v3.4): só id, nome, disponibilidade e aprovação. */
export function mapAssignableRow(row: any, tenantId: string): Driver {
  const status = (row.availability as DriverStatus) || 'UNAVAILABLE';
  return {
    id: row.driver_user_id,
    tenantId,
    userId: row.driver_user_id,
    name: row.display_name || 'Entregador',
    phone: '',
    vehicle: '',
    plate: '',
    status,
    approvalStatus: normalizeApprovalStatus(row.approval_status) ?? 'UNKNOWN',
    isOnline: status === 'AVAILABLE' || status === 'ON_DELIVERY',
    completedDeliveriesToday: 0,
  } as Driver;
}

// ---------------- Onboarding por link/QR (proposta 0700) ----------------

export interface DriverInviteLinkCreated { id: string; token: string; url: string; expiresAt: string }
export type DriverInviteLinkState = 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export interface DriverInviteLink {
  id: string; label: string | null; maxUses: number | null; uses: number;
  expiresAt: string; state: DriverInviteLinkState; createdAt: string;
}
export interface DriverInvitePreview { valid: boolean; storeName?: string; storeLogo?: string | null; expiresAt?: string }
export interface DriverRedeemResult { status: 'INVALID' | 'PENDING' | DriverApprovalStatus; consumed: boolean; tenantId?: string }

const RPC_ERROR_MESSAGES: Record<string, string> = {
  P0410: 'Conflito de papel: esta conta já faz parte da equipe da loja e não pode ser entregador.',
  P0412: 'Este usuário já faz parte da equipe.',
  P0413: 'Já existe um convite pendente para este e-mail.',
  P0414: 'Entregador não aprovado.',
  P0416: 'Vínculo inconsistente. Fale com a loja.',
  P0417: 'Transição inválida.',
  P0418: 'Entregador está com pedido em rota; desatribua antes.',
  P0429: 'Muitas tentativas. Aguarde e tente novamente.',
  '42501': 'Sem permissão para esta ação.',
};

/** Mensagem amigável para erros das RPCs de entregador. Nunca inclui token. */
export function mapDriverRpcError(err: any): string {
  const code = err?.code as string | undefined;
  if (code && RPC_ERROR_MESSAGES[code]) return RPC_ERROR_MESSAGES[code];
  const msg = String(err?.message || '');
  if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(msg)) {
    return 'Recurso ainda não disponível.';
  }
  return 'Não foi possível concluir a ação. Tente novamente.';
}

class DriverRpcError extends Error {
  code?: string;
  constructor(err: any) { super(mapDriverRpcError(err)); this.code = err?.code; this.name = 'DriverRpcError'; }
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new DriverRpcError(error);
  return data as T;
}

function mapInviteLinkRow(r: any): DriverInviteLink {
  const state: DriverInviteLinkState = r.state === 'REVOKED' ? 'REVOKED' : r.state === 'EXPIRED' ? 'EXPIRED' : 'ACTIVE';
  return {
    id: r.id, label: r.label ?? null, maxUses: r.max_uses ?? null, uses: Number(r.uses ?? 0),
    expiresAt: r.expires_at, state, createdAt: r.created_at,
  };
}

function mapCreated(d: any): DriverInviteLinkCreated {
  return { id: d?.id, token: d?.token, url: d?.url, expiresAt: d?.expires_at ?? d?.expiresAt };
}

export const driverInviteRepository = {
  async createInviteLink(tenantId: string, label?: string | null, expiresDays = 7, maxUses?: number | null): Promise<DriverInviteLinkCreated> {
    return mapCreated(await callRpc<any>('create_driver_invite_link', {
      p_tenant_id: tenantId, p_label: label ?? null, p_expires_days: expiresDays, p_max_uses: maxUses ?? null,
    }));
  },
  async listInviteLinks(tenantId: string): Promise<DriverInviteLink[]> {
    const rows = await callRpc<any[]>('list_driver_invite_links', { p_tenant_id: tenantId });
    return (rows || []).map(mapInviteLinkRow);
  },
  async renewInviteLink(id: string): Promise<DriverInviteLinkCreated> {
    return mapCreated(await callRpc<any>('renew_driver_invite_link', { p_id: id }));
  },
  async revokeInviteLink(id: string): Promise<void> {
    await callRpc('revoke_driver_invite_link', { p_id: id });
  },
  async reviewApplication(driverId: string, decision: 'APPROVE' | 'REJECT', reason?: string): Promise<any> {
    return callRpc('review_driver_application', { p_driver_id: driverId, p_decision: decision, p_reason: reason || null });
  },
  async setLinkStatus(driverId: string, action: 'SUSPEND' | 'REACTIVATE' | 'REMOVE', reason?: string): Promise<any> {
    return callRpc('set_driver_link_status', { p_driver_id: driverId, p_action: action, p_reason: reason || null });
  },
  async previewInvite(token: string): Promise<DriverInvitePreview> {
    const d = await callRpc<any>('preview_driver_invite', { p_token: token });
    if (!d || d.valid !== true) return { valid: false };
    return { valid: true, storeName: d.store_name, storeLogo: d.store_logo ?? null, expiresAt: d.expires_at };
  },
  async redeemInvite(token: string): Promise<DriverRedeemResult> {
    const d = await callRpc<any>('redeem_driver_invite', { p_token: token });
    const status = (d?.status || 'INVALID') as DriverRedeemResult['status'];
    return { status, consumed: d?.consumed === true, tenantId: d?.tenantId };
  },
  /**
   * approval_status do PRÓPRIO usuário autenticado na loja, via RPC get_my_driver_approval (0700 v3.2).
   * Nunca lê public.drivers direto e nunca envia user_id. Falha/ausência/valor inválido → 'UNAVAILABLE'.
   */
  /**
   * Entregadores atribuíveis (0700 v3.4): OWNER/MANAGER/DELIVERY_MANAGER autorizados no servidor,
   * só APPROVED elegíveis. Erro propaga (sem fallback local nem lista completa).
   */
  async listAssignableDrivers(tenantId: string): Promise<Driver[]> {
    if (!isSupabaseConfigured || !isValidUuid(tenantId)) return [];
    const { data, error } = await supabase.rpc('list_assignable_drivers', { p_tenant_id: tenantId });
    if (error) throw new Error(mapDriverRpcError(error));
    return ((data || []) as any[]).map(r => mapAssignableRow(r, tenantId));
  },

  async getOwnApprovalStatus(tenantId: string): Promise<Exclude<DriverApprovalLookup, null>> {
    if (!isSupabaseConfigured || !isValidUuid(tenantId)) return 'UNAVAILABLE';
    try {
      const { data, error } = await supabase.rpc('get_my_driver_approval', { p_tenant_id: tenantId });
      if (error) return 'UNAVAILABLE';
      return parseOwnApprovalResponse(data);
    } catch {
      return 'UNAVAILABLE';
    }
  },
};

export const driverRepository = {
  /**
   * Lista os motoristas cadastrados no tenant (public.drivers)
   */
  async listDrivers(context: SecurityContext, tenantId: string): Promise<Driver[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      // 0700 v3.3: leitura só pela RPC list_tenant_drivers (OWNER/MANAGER autorizados no servidor).
      // Sem SELECT direto em public.drivers e sem cair em dados locais quando a RPC falha.
      const { data, error } = await supabase.rpc('list_tenant_drivers', { p_tenant_id: tenantId });
      if (error) {
        throw new Error(mapDriverRpcError(error));
      }
      const rows = (data || []) as any[];

      // Contagem de entregas hoje por motorista (orders.driver_id = drivers.user_id)
      const todayStr = new Date().toISOString().split('T')[0];
      const { data: deliveries } = await supabase
        .from('orders')
        .select('driver_id')
        .eq('tenant_id', tenantId)
        .eq('status', 'DELIVERED')
        .gte('created_at', todayStr);
      const deliveryCountMap = buildDeliveryCountByUserId(deliveries);

      return rows.map(row => mapRowToDriver({ ...row, tenant_id: tenantId }, deliveryCountForDriver(deliveryCountMap, row)));
    }
    return localOnly('entregadores', () => dataStore.getDrivers(context, tenantId));
  },

  /**
   * Convida um novo entregador via convite formal de equipe (role: DRIVER)
   * O motorista nasce exclusivamente após o aceite do convite (accept_team_invite).
   */
  async inviteDriver(context: SecurityContext, tenantId: string, email: string): Promise<any> {
    return teamRepository.createInvite(context, tenantId, email, 'DRIVER');
  },

  /**
   * Atualiza dados de veículo ou status do motorista via RPC segura update_driver_profile
   * (id, user_id e tenant_id são estritamente imutáveis)
   */
  async updateDriverProfile(
    context: SecurityContext, 
    tenantId: string, 
    driverId: string, 
    updates: Partial<Driver>
  ): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('update_driver_profile', {
        p_driver_id: driverId,
        p_full_name: updates.name || null,
        p_phone: updates.phone || null,
        p_document: updates.document || null,
        p_vehicle_type: updates.vehicleType || null,
        p_vehicle_model: updates.vehicleModel || null,
        p_vehicle_plate: updates.plate || null,
        p_status: updates.status || null,
      });

      if (error) {
        throw new Error(error.message);
      }
      return;
    }
  },

  /**
   * Compatibilidade para atualizações de motorista
   */
  async updateDriver(
    context: SecurityContext, 
    tenantId: string, 
    driverId: string, 
    updates: Partial<Driver>
  ): Promise<void> {
    return this.updateDriverProfile(context, tenantId, driverId, updates);
  },

  /**
   * Suspende o motorista via RPC suspend_driver
   */
  async suspendDriver(context: SecurityContext, tenantId: string, driverId: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('suspend_driver', {
        p_driver_id: driverId,
      });

      if (error) {
        throw new Error(error.message);
      }
      return;
    }
  },

  /**
   * Atribui um pedido a um motorista via RPC assign_order_to_driver
   */
  async assignOrder(
    context: SecurityContext, 
    tenantId: string, 
    orderId: string, 
    driverUserId: string
  ): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('assign_order_to_driver', {
        p_order_id: orderId,
        p_driver_user_id: driverUserId,
      });

      if (error) {
        throw new Error(error.code === 'P0414' ? mapDriverRpcError(error) : error.message);
      }
      return;
    }
  },

  /**
   * Desatribui um pedido via RPC unassign_order_driver
   */
  async unassignOrder(context: SecurityContext, tenantId: string, orderId: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('unassign_order_driver', {
        p_order_id: orderId,
      });

      if (error) {
        throw new Error(error.message);
      }
      return;
    }
  }
};
