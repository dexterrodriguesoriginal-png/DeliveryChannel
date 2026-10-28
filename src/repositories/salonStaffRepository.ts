import { supabase } from '../lib/supabase';
import type { Category, Product } from '../types';
import type { SecurityContext } from '../services/securityEngine';
import { formatTableLabel } from '../lib/orders/labels';
import { productRepository } from './productRepository';
import { categoryRepository } from './categoryRepository';
import { productOptionRepository } from './productOptionRepository';
import { publicStoreRepository } from './publicStoreRepository';

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
export interface WaiterCallRow {
  id: string;
  tab_id: string;
  type: 'CALL' | 'BILL' | 'HELP';
  status: string;
  created_at: string;
  route?: 'ALL' | 'ASSIGNED' | 'CENTRAL';
  assigned_to?: string | null;
  accepted_by?: string | null;
  accepted_at?: string | null;
  dispatched_by?: string | null;
  dispatched_at?: string | null;
  escalated_at?: string | null;
}
export interface WaiterRound { id: string; tab_id: string; order_number: number; customer_name: string; status: string; subtotal: number; created_at: string; round_no: number }
export interface SalonSnapshot { tables: WaiterTable[]; tabs: WaiterTab[]; sessions: WaiterSession[]; calls: WaiterCallRow[]; rounds: WaiterRound[]; releaseRequired: boolean | null }

export interface SalonAccessExtras {
  /** tab id → responsible customer's session id (null when the tab has no responsible). */
  responsibleSessionByTab: Map<string, string | null>;
  claimableTabs: Set<string>;
}

export interface StaffHolderCode {
  code: string;
  expiresAt: string;
  qrToken?: string;
  tableLabel?: string;
  tenantSlug?: string;
}

const must = <T>(result: { data: T | null; error: { message?: string } | null }): T => {
  if (result.error) throw Object.assign(new Error(result.error.message || 'Falha na operação.'), { cause: result.error });
  return (result.data ?? ([] as unknown as T));
};

export const salonStaffRepository = {
  async pendingApprovals(tenantId: string): Promise<PendingApproval[]> {
    const sessions = must(await supabase.from('tab_sessions').select('id,tab_id,display_name,approved_at,expires_at')
      .eq('tenant_id', tenantId).is('approved_at', null).gt('expires_at', new Date().toISOString())) as Array<{ id: string; tab_id: string; display_name: string; approved_at?: string | null; expires_at: string }>;
    const unapproved = sessions.filter(s => !s.approved_at);
    if (!unapproved.length) return [];
    const tabIds = Array.from(new Set(unapproved.map(s => s.tab_id)));
    const tabs = must(await supabase.from('dining_tabs').select('id,table_id,status').eq('tenant_id', tenantId).in('id', tabIds).in('status', ['OPEN', 'BILL_REQUESTED'])) as Array<{ id: string; table_id: string }>;
    if (!tabs.length) return [];
    const tables = must(await supabase.from('dining_tables').select('id,label').eq('tenant_id', tenantId).in('id', Array.from(new Set(tabs.map(t => t.table_id))))) as Array<{ id: string; label: string }>;
    const tabById = new Map(tabs.map(t => [t.id, t]));
    const labelById = new Map(tables.map(t => [t.id, t.label]));
    return unapproved.filter(s => tabById.has(s.tab_id)).map(s => {
      const tab = tabById.get(s.tab_id)!;
      return { sessionId: s.id, tabId: s.tab_id, tableId: tab.table_id, tableLabel: formatTableLabel(labelById.get(tab.table_id), 'Mesa'), displayName: s.display_name || 'Cliente', expiresAt: s.expires_at };
    }).sort((a, b) => a.tableLabel.localeCompare(b.tableLabel, 'pt-BR', { numeric: true }));
  },

  async fetchRoundsForTabs(tenantId: string, tabIds: string[]): Promise<WaiterRound[]> {
    if (!tabIds.length) return [];
    const roundR = await supabase.from('orders')
      .select('id,tab_id,order_number,customer_name,status,subtotal,created_at,round_no')
      .eq('tenant_id', tenantId).eq('fulfillment_type', 'DINE_IN').in('tab_id', tabIds).neq('status', 'CANCELLED').order('round_no');
    const direct = must(roundR) as WaiterRound[];
    if (direct.length > 0) return direct;
    try {
      if (typeof fetch !== 'function' || typeof supabase?.auth?.getSession !== 'function') return [];
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return [];
      const res = await fetch(`/api/payments/tabs/rounds/${encodeURIComponent(tenantId)}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const body = await res.json() as { rounds?: WaiterRound[] };
      const set = new Set(tabIds);
      return Array.isArray(body?.rounds) ? body.rounds.filter(r => set.has(r.tab_id)) : [];
    } catch {
      return [];
    }
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
    const loadCalls = async () => {
      const resV2 = await supabase.from('waiter_calls').select('id,tab_id,type,status,created_at,route,assigned_to,accepted_by,accepted_at,dispatched_by,dispatched_at,escalated_at').eq('tenant_id', tenantId).in('tab_id', tabIds).eq('status', 'OPEN').order('created_at');
      if (!resV2.error) return resV2;
      return supabase.from('waiter_calls').select('id,tab_id,type,status,created_at').eq('tenant_id', tenantId).in('tab_id', tabIds).eq('status', 'OPEN').order('created_at');
    };
    const [sessR, callR, rounds] = await Promise.all([
      supabase.from('tab_sessions').select('id,tab_id,display_name,approved_at,expires_at').eq('tenant_id', tenantId).in('tab_id', tabIds).gt('expires_at', new Date().toISOString()),
      loadCalls(),
      salonStaffRepository.fetchRoundsForTabs(tenantId, tabIds),
    ]);
    return { tables, tabs, sessions: must(sessR) as WaiterSession[], calls: must(callR) as WaiterCallRow[], rounds, releaseRequired };
  },

  /**
   * Carrega o cardápio da loja (produtos ativos + categorias + adicionais) para lançar pedido na mesa.
   * Usa fallback via get_public_store quando o cargo WAITER não recebe linhas do SELECT direto em products/categories.
   */
  async loadMenu(
    tenantId: string,
    tenantSlug?: string | null,
    securityContext?: SecurityContext | null,
  ): Promise<{ products: Product[]; categories: Category[] }> {
    let rawProducts: Product[] = [];
    let rawCategories: Category[] = [];
    const ctx = (securityContext ?? {}) as SecurityContext;
    try {
      rawProducts = await productRepository.getProducts(ctx, tenantId);
    } catch {
      rawProducts = [];
    }
    try {
      if (typeof categoryRepository?.getCategories === 'function') {
        rawCategories = await categoryRepository.getCategories(ctx, tenantId);
      }
    } catch {
      rawCategories = [];
    }

    let activeProducts = rawProducts.filter(p => p.isActive !== false);
    let activeCategories = rawCategories.filter(c => c.isActive !== false);

    if (activeProducts.length === 0) {
      try {
        let slug = (tenantSlug || '').trim();
        if (!slug && typeof supabase?.from === 'function') {
          const { data } = await supabase.from('tenants').select('slug').eq('id', tenantId).maybeSingle();
          slug = String((data as { slug?: string } | null)?.slug || '').trim();
        }
        if (slug && typeof publicStoreRepository?.loadPublicStore === 'function') {
          const pub = await publicStoreRepository.loadPublicStore(slug);
          if (pub.status === 'ok') {
            activeProducts = pub.data.products.filter(p => p.isActive !== false);
            if (activeCategories.length === 0) {
              activeCategories = pub.data.categories.filter(c => c.isActive !== false);
            }
          }
        }
      } catch {
        // fallback silencioso
      }
    }

    if (activeProducts.length > 0) {
      try {
        const groups = await productOptionRepository.getPublicForProducts(
          tenantId,
          activeProducts.map(p => p.id),
        );
        activeProducts = activeProducts.map(p => ({ ...p, optionGroups: groups.get(p.id) || p.optionGroups || [] }));
      } catch {
        // sem adicionais
      }
    }

    return { products: activeProducts, categories: activeCategories };
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
  async createHolderCode(tabId: string): Promise<StaffHolderCode> {
    const { data, error } = await supabase.rpc('staff_create_holder_code', { p_tab_id: tabId });
    if (error) throw error;
    return data as StaffHolderCode;
  },
  async releaseEmptyTab(tabId: string, reason?: string): Promise<void> {
    const { error } = await supabase.rpc('release_empty_tab', { p_tab_id: tabId, p_reason: reason?.trim() || null });
    if (error) throw error;
  },
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
