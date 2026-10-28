import { supabase } from '../lib/supabase';
import { mapStrictRpcError } from '../lib/rpcErrors';
import { isMissingSchemaError } from './mesasQrRepository';
import {
  DEFAULT_SERVICE_SETTINGS, parseServiceSettings, type RosterEntry, type ServiceSettings,
} from '../lib/waiter/waiterRouting';

/** Garçom v2 (migration 20261027004900): login por usuário/senha, modos de atendimento, rastreio e relatório. Tudo some se a migration não estiver aplicada. */

export interface DirectoryMember {
  id: string; userId: string; roleId: string; status: string; createdAt: string;
  name: string; email: string; phone: string; username: string | null; photoUrl: string | null; waiterActive: boolean | null;
}
export interface TableAssignment { table_id: string; waiter_id: string }
export interface WaiterReportRow {
  waiterId: string; name: string; tabsAttended: number; ordersCount: number; totalSold: number;
  callsHandled: number; avgResponseSeconds: number | null; serviceFeeTotal: number;
}
export interface TableWaiter { name: string; photoUrl: string | null }
export interface CreateWaiterInput {
  tenantId: string; name: string; phone: string; username: string; password: string; contactEmail?: string; photoDataUrl?: string;
}
export type WaiterAdminResult =
  | { ok: true; userId?: string; username?: string }
  | { ok: false; code: string; message: string; canReactivate?: boolean; userId?: string };

/** Erro de negócio com o código devolvido pela Edge Function (ex.: USERNAME_INACTIVE → oferecer reativar). */
export class WaiterAdminError extends Error {
  constructor(message: string, readonly code: string, readonly canReactivate = false, readonly userId?: string) { super(message); }
}

/** Mensagem amigável a partir de qualquer erro de RPC (P0409/42501 conhecidos; resto genérico). */
export function waiterRpcMessage(error: unknown): string {
  const err = error as { code?: string; message?: string } | null;
  const msg = String(err?.message || '');
  const known = /^(INVALID_INPUT|WAITER_NOT_FOUND|HYBRID_DISABLED|WAITER_CALL_NOT_OPEN|WAITER_CALL_NOT_FOUND|FORBIDDEN|WAITER_CALL_TAKEN):\s*(.+)$/.exec(msg);
  if (known) return known[2];
  return mapStrictRpcError(err);
}

const mapDirectory = (r: any): DirectoryMember => ({
  id: r.id, userId: r.user_id, roleId: r.role_id, status: r.status, createdAt: r.created_at,
  name: r.name || 'Colaborador', email: r.email || '', phone: r.phone || '', username: r.username ?? null,
  photoUrl: r.photo_url ?? null, waiterActive: typeof r.waiter_active === 'boolean' ? r.waiter_active : null,
});

export const mapReportRow = (r: any): WaiterReportRow => ({
  waiterId: r.waiter_id, name: r.name, tabsAttended: Number(r.tabs_attended) || 0, ordersCount: Number(r.orders_count) || 0,
  totalSold: Number(r.total_sold) || 0, callsHandled: Number(r.calls_handled) || 0,
  avgResponseSeconds: r.avg_response_seconds == null ? null : Number(r.avg_response_seconds),
  serviceFeeTotal: Number(r.service_fee_total) || 0,
});

export const mapRosterRow = (r: any): RosterEntry => ({
  userId: r.user_id, name: r.name, photoUrl: r.photo_url ?? null, online: !!r.online, busy: !!r.busy,
  tableCount: Number(r.table_count) || 0, openCalls: Number(r.open_calls) || 0,
});

async function readInvokeError(error: any): Promise<WaiterAdminError> {
  try {
    const body = await error?.context?.json?.();
    if (body && typeof body.message === 'string') return new WaiterAdminError(body.message, String(body.code || 'ERROR'), body.canReactivate === true, body.userId);
  } catch { /* corpo ilegível */ }
  return new WaiterAdminError('Não foi possível concluir a ação. Tente novamente.', 'ERROR');
}

async function adminCall(payload: Record<string, unknown>): Promise<{ userId?: string; username?: string }> {
  const { data, error } = await supabase.functions.invoke('waiter-admin', { body: payload });
  if (error) throw await readInvokeError(error);
  const res = data as WaiterAdminResult;
  if (!res?.ok) throw new WaiterAdminError((res as any)?.message || 'Não foi possível concluir a ação.', (res as any)?.code || 'ERROR', (res as any)?.canReactivate === true, (res as any)?.userId);
  return res;
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(waiterRpcMessage(error));
  return data as T;
}

export const waiterV2Repository = {
  /** Nunca lança: qualquer falha = recurso desligado. */
  async available(): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('waiter_v2_capabilities');
      return !error && Number((data as any)?.version) >= 1;
    } catch { return false; }
  },

  async loginStore(slug: string): Promise<{ name: string; slug: string } | null> {
    const { data, error } = await supabase.rpc('get_waiter_login_store', { p_slug: slug });
    if (error || !data) return null;
    return data as { name: string; slug: string };
  },

  /** Entra por loja + usuário + senha (Edge Function com rate limit) e instala a sessão no cliente. */
  async loginWithUsername(slug: string, username: string, password: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke('waiter-login', { body: { slug, username, password } });
    if (error) throw await readInvokeError(error);
    const session = (data as any)?.session;
    if (!(data as any)?.ok || !session?.access_token) throw new WaiterAdminError((data as any)?.message || 'Usuário ou senha incorretos.', (data as any)?.code || 'INVALID_CREDENTIALS');
    const { error: setError } = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (setError) throw new WaiterAdminError('Não foi possível iniciar a sessão. Tente novamente.', 'SESSION');
  },

  createWaiter: (input: CreateWaiterInput) => adminCall({ action: 'create', ...input }),
  reactivateWaiter: (tenantId: string, userId: string, password?: string) => adminCall({ action: 'reactivate', tenantId, userId, password }),
  updateWaiter: (tenantId: string, userId: string, patch: { name: string; phone: string; photoDataUrl?: string; removePhoto?: boolean }) => adminCall({ action: 'update', tenantId, userId, ...patch }),
  resetPassword: (tenantId: string, userId: string, password: string) => adminCall({ action: 'reset_password', tenantId, userId, password }),
  setActive: (tenantId: string, userId: string, active: boolean) => adminCall({ action: 'set_active', tenantId, userId, active }),
  deleteWaiter: (tenantId: string, userId: string) => adminCall({ action: 'delete', tenantId, userId }),

  /** Equipe com nome/telefone (users só é legível pelo próprio usuário; o diretório é feito por RPC para dono/gerente). */
  async directory(tenantId: string): Promise<DirectoryMember[] | null> {
    const { data, error } = await supabase.rpc('list_team_directory', { p_tenant: tenantId });
    if (error) { if (isMissingSchemaError(error)) return null; throw new Error(waiterRpcMessage(error)); }
    return Array.isArray(data) ? data.map(mapDirectory) : [];
  },

  async settings(tenantId: string): Promise<ServiceSettings> {
    const { data, error } = await supabase.from('waiter_service_settings').select('mode,hybrid_help,accept_timeout_seconds,dispatch_timeout_seconds').eq('tenant_id', tenantId).maybeSingle();
    if (error) { if (isMissingSchemaError(error)) return DEFAULT_SERVICE_SETTINGS; throw new Error(waiterRpcMessage(error)); }
    return parseServiceSettings(data);
  },
  saveSettings: (tenantId: string, s: ServiceSettings) => rpc('set_waiter_service_settings', {
    p_tenant: tenantId, p_mode: s.mode, p_hybrid_help: s.hybridHelp, p_accept_seconds: s.acceptTimeoutSeconds, p_dispatch_seconds: s.dispatchTimeoutSeconds,
  }),

  async assignments(tenantId: string): Promise<TableAssignment[]> {
    const { data, error } = await supabase.from('waiter_table_assignments').select('table_id,waiter_id').eq('tenant_id', tenantId);
    if (error) { if (isMissingSchemaError(error)) return []; throw new Error(waiterRpcMessage(error)); }
    return (data || []) as TableAssignment[];
  },
  assignTables: (tenantId: string, waiterId: string | null, tableIds: string[]) => rpc<number>('assign_waiter_tables', { p_tenant: tenantId, p_waiter: waiterId, p_table_ids: tableIds }),
  passTables: (tenantId: string, fromId: string, toId: string, tableIds: string[] | null) => rpc<number>('pass_waiter_tables', { p_tenant: tenantId, p_from: fromId, p_to: toId, p_table_ids: tableIds }),

  async roster(tenantId: string): Promise<RosterEntry[]> {
    const { data, error } = await supabase.rpc('waiter_roster', { p_tenant: tenantId });
    if (error) { if (isMissingSchemaError(error)) return []; throw new Error(waiterRpcMessage(error)); }
    return Array.isArray(data) ? data.map(mapRosterRow) : [];
  },
  async heartbeat(tenantId: string): Promise<void> { try { await supabase.rpc('waiter_heartbeat', { p_tenant: tenantId }); } catch { /* sinal best-effort */ } },
  async goOffline(tenantId: string): Promise<void> { try { await supabase.rpc('waiter_go_offline', { p_tenant: tenantId }); } catch { /* best-effort */ } },

  acceptCall: (callId: string) => rpc('accept_waiter_call', { p_call_id: callId }),
  dispatchCall: (callId: string, waiterId: string) => rpc('dispatch_waiter_call', { p_call_id: callId, p_waiter: waiterId }),
  escalateCall: (callId: string) => rpc('escalate_waiter_call', { p_call_id: callId }),
  async escalateDue(tenantId: string): Promise<void> { try { await supabase.rpc('escalate_due_waiter_calls', { p_tenant: tenantId }); } catch { /* best-effort */ } },
  helpTable: (tenantId: string, tableId: string, callId?: string) => rpc('waiter_help_table', { p_tenant: tenantId, p_table_id: tableId, p_call_id: callId ?? null }),

  async report(tenantId: string, from: Date, to: Date, waiterId?: string): Promise<WaiterReportRow[]> {
    const data = await rpc<any[]>('waiter_performance_report', { p_tenant: tenantId, p_from: from.toISOString(), p_to: to.toISOString(), p_waiter: waiterId ?? null });
    return Array.isArray(data) ? data.map(mapReportRow) : [];
  },

  /** Cliente: só nome e foto do garçom da mesa (LGPD). */
  async myTableWaiter(sessionId: string): Promise<TableWaiter | null> {
    try {
      const { data, error } = await supabase.rpc('get_my_table_waiter', { p_session_id: sessionId });
      if (error || !data) return null;
      const d = data as { name?: string; photo_url?: string | null };
      return d.name ? { name: d.name, photoUrl: d.photo_url ?? null } : null;
    } catch { return null; }
  },
};
