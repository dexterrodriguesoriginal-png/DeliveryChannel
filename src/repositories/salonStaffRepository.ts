import { supabase } from '../lib/supabase';

/** Staff-side calls for the Salão / App do Garçom. Every call is tenant-scoped by RLS and by the RPC role checks. */
export interface PendingApproval {
  sessionId: string;
  tabId: string;
  tableId: string;
  tableLabel: string;
  displayName: string;
  expiresAt: string;
}

export interface WaiterTable { id: string; label: string; area: string | null; seats: number }
export interface WaiterTab { id: string; table_id: string; status: 'OPEN' | 'BILL_REQUESTED' | 'CLOSED' | 'CANCELLED'; opened_at: string; service_fee_percent: number; service_fee_removed: boolean }
export interface WaiterSession { id: string; tab_id: string; display_name: string; approved_at: string | null; expires_at: string }
export interface WaiterCallRow { id: string; tab_id: string; type: 'CALL' | 'BILL' | 'HELP'; status: string; created_at: string }
export interface WaiterRound { id: string; tab_id: string; order_number: number; customer_name: string; status: string; subtotal: number; created_at: string; round_no: number }
export interface SalonSnapshot { tables: WaiterTable[]; tabs: WaiterTab[]; sessions: WaiterSession[]; calls: WaiterCallRow[]; rounds: WaiterRound[]; releaseRequired: boolean | null }

export interface SalonAccessExtras {
  /** tab id → responsible customer's session id (null when the tab has no responsible). */
  responsibleSessionByTab: Map<string, string | null>;
  claimableTabs: Set<string>;
}

const must = <T>(result: { data: T | null; error: { message?: string } | null }): T => {
  if (result.error) throw Object.assign(new Error(result.error.message || 'Falha na operação.'), { cause: result.error });
  return (result.data ?? ([] as unknown as T));
};

export const salonStaffRepository = {
  async pendingApprovals(tenantId: string): Promise<PendingApproval[]> {
    const sessions = must(await supabase.from('tab_sessions').select('id,tab_id,display_name,approved_at,expires_at')
      .eq('tenant_id', tenantId).is('approved_at', null).gt('expires_at', new Date().toISOString())) as Array<{ id: string; tab_id: string; display_name: string; expires_at: string }>;
    if (!sessions.length) return [];
    const tabIds = Array.from(new Set(sessions.map(s => s.tab_id)));
    const tabs = must(await supabase.from('dining_tabs').select('id,table_id,status').eq('tenant_id', tenantId).in('id', tabIds).in('status', ['OPEN', 'BILL_REQUESTED'])) as Array<{ id: string; table_id: string }>;
    if (!tabs.length) return [];
    const tables = must(await supabase.from('dining_tables').select('id,label').eq('tenant_id', tenantId).in('id', Array.from(new Set(tabs.map(t => t.table_id))))) as Array<{ id: string; label: string }>;
    const tabById = new Map(tabs.map(t => [t.id, t]));
    const labelById = new Map(tables.map(t => [t.id, t.label]));
    return sessions.filter(s => tabById.has(s.tab_id)).map(s => {
      const tab = tabById.get(s.tab_id)!;
      return { sessionId: s.id, tabId: s.tab_id, tableId: tab.table_id, tableLabel: labelById.get(tab.table_id) || 'Mesa', displayName: s.display_name || 'Cliente', expiresAt: s.expires_at };
    }).sort((a, b) => a.tableLabel.localeCompare(b.tableLabel, 'pt-BR', { numeric: true }));
  },

  /** Everything the waiter app shows, in 2 round trips. */
  async snapshot(tenantId: string): Promise<SalonSnapshot> {
    const [tablesR, tabsR, cfgR] = await Promise.all([
      supabase.from('dining_tables').select('id,label,area,seats').eq('tenant_id', tenantId).eq('active', true).order('label'),
      supabase.from('dining_tabs').select('id,table_id,status,opened_at,service_fee_percent,service_fee_removed').eq('tenant_id', tenantId).in('status', ['OPEN', 'BILL_REQUESTED']).order('opened_at'),
      supabase.from('tenant_modules').select('config').eq('tenant_id', tenantId).eq('module_key', 'dine_in').maybeSingle(),
    ]);
    const tables = must(tablesR) as WaiterTable[];
    const tabs = must(tabsR) as WaiterTab[];
    const cfg = (cfgR.data as { config?: { release_required?: boolean } } | null)?.config;
    const releaseRequired = typeof cfg?.release_required === 'boolean' ? cfg.release_required : null;
    if (!tabs.length) return { tables, tabs, sessions: [], calls: [], rounds: [], releaseRequired };
    const tabIds = tabs.map(t => t.id);
    const [sessR, callR, roundR] = await Promise.all([
      supabase.from('tab_sessions').select('id,tab_id,display_name,approved_at,expires_at').eq('tenant_id', tenantId).in('tab_id', tabIds).gt('expires_at', new Date().toISOString()),
      supabase.from('waiter_calls').select('id,tab_id,type,status,created_at').eq('tenant_id', tenantId).in('tab_id', tabIds).eq('status', 'OPEN').order('created_at'),
      supabase.from('orders').select('id,tab_id,order_number,customer_name,status,subtotal,created_at,round_no').eq('tenant_id', tenantId).eq('fulfillment_type', 'DINE_IN').in('tab_id', tabIds).neq('status', 'CANCELLED').order('round_no'),
    ]);
    return { tables, tabs, sessions: must(sessR) as WaiterSession[], calls: must(callR) as WaiterCallRow[], rounds: must(roundR) as WaiterRound[], releaseRequired };
  },

  /** Only meaningful after migration 20261027004700; callers must check capabilities first. */
  async accessExtras(tenantId: string, tabIds: string[]): Promise<SalonAccessExtras> {
    const out: SalonAccessExtras = { responsibleSessionByTab: new Map(), claimableTabs: new Set() };
    if (!tabIds.length) return out;
    const tabs = must(await supabase.from('dining_tabs').select('id,responsible_user_id,holder_claimable').eq('tenant_id', tenantId).in('id', tabIds)) as Array<{ id: string; responsible_user_id: string | null; holder_claimable: boolean }>;
    const sessions = must(await supabase.from('tab_sessions').select('id,tab_id,auth_user_id').eq('tenant_id', tenantId).in('tab_id', tabIds).gt('expires_at', new Date().toISOString())) as Array<{ id: string; tab_id: string; auth_user_id: string }>;
    for (const tab of tabs) {
      const holder = sessions.find(s => s.tab_id === tab.id && s.auth_user_id === tab.responsible_user_id);
      out.responsibleSessionByTab.set(tab.id, holder?.id ?? null);
      if (tab.holder_claimable) out.claimableTabs.add(tab.id);
    }
    return out;
  },

  async approve(sessionId: string): Promise<void> { const { error } = await supabase.rpc('approve_session', { p_session_id: sessionId }); if (error) throw error; },
  async reject(sessionId: string): Promise<void> { const { error } = await supabase.rpc('reject_session', { p_session_id: sessionId }); if (error) throw error; },
  async handleCall(callId: string): Promise<void> { const { error } = await supabase.rpc('handle_waiter_call', { p_call_id: callId }); if (error) throw error; },
  async resetHolder(tabId: string): Promise<void> { const { error } = await supabase.rpc('staff_reset_tab_holder', { p_tab_id: tabId }); if (error) throw error; },
  async transferHolder(tabId: string, targetSessionId: string, endPrevious = true): Promise<void> {
    const { error } = await supabase.rpc('staff_transfer_tab_holder', { p_tab_id: tabId, p_target_session_id: targetSessionId, p_end_previous: endPrevious }); if (error) throw error;
  },
  async openTab(tableId: string): Promise<{ tabId: string; existing: boolean }> {
    const { data, error } = await supabase.rpc('staff_open_tab', { p_table_id: tableId }); if (error) throw error;
    return data as { tabId: string; existing: boolean };
  },
  async requestBill(tabId: string): Promise<void> { const { error } = await supabase.rpc('staff_request_bill', { p_tab_id: tabId }); if (error) throw error; },
  async submitRound(tabId: string, items: unknown[], idempotencyKey: string): Promise<void> {
    const { error } = await supabase.rpc('submit_round', { p_items: items, p_idempotency_key: idempotencyKey, p_tab_id: tabId }); if (error) throw error;
  },
};
