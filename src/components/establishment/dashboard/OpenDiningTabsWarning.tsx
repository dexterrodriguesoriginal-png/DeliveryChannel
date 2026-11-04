import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Receipt, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useModules } from '../../../hooks/useModules';
import { formatTableLabel } from '../../../lib/orders/labels';
import { formatBRL } from '../../../lib/pricing/money';
import { preferenceKey, readPreferences } from '../../../lib/notifications/preferences';
import { readSoundPref } from '../../../lib/orders/newOrderAlarm';
import { supabase } from '../../../lib/supabase';
import { ACTIVE_DINING_TAB_STATUSES, tabTotals, type RoundLike } from '../../../lib/salon/tableStatus';
import { playShortBeep } from '../../../utils/audio';
import '../salon/salon.css';

export type DiningTabRow = {
  id: string;
  table_id: string;
  opened_at: string;
  status: string;
  service_fee_percent?: number;
  service_fee_removed?: boolean;
  total_cents?: number;
};
export type DiningTableRow = { id: string; label: string };

export interface OpenDiningTabWarningItem {
  id: string;
  tableId: string;
  tableLabel: string;
  status: string;
  label: string;
  billRequested: boolean;
  strictBillRequested: boolean;
  totalCents: number | null;
  viewHref: string;
  checkoutHref: string;
}

export function isBillToastSoundEnabled(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  tenantId?: string | null,
  userId?: string | null,
): boolean {
  if (!storage) return true;
  try {
    if (tenantId && userId) {
      const raw = storage.getItem(preferenceKey(tenantId, userId));
      if (raw !== null) return readPreferences(storage, tenantId, userId).sound;
    }
    return readSoundPref(storage);
  } catch {
    return true;
  }
}

export function openDiningTabWarnings(
  tabs: readonly DiningTabRow[],
  tables: readonly DiningTableRow[],
  now = Date.now(),
  roundsByTab?: ReadonlyMap<string, RoundLike[]>,
): OpenDiningTabWarningItem[] {
  const labels = openDiningTabLabels(tabs, tables, now);
  const tableMap = new Map(tables.map(table => [table.id, table.label]));
  return tabs.map((tab, index) => {
    const tableLabel = formatTableLabel(tableMap.get(tab.table_id), 'Mesa —');
    const rounds = roundsByTab?.get(tab.id) || [];
    const computedTotal = typeof tab.total_cents === 'number'
      ? tab.total_cents
      : roundsByTab ? tabTotals(
          { service_fee_percent: Number(tab.service_fee_percent ?? 0), service_fee_removed: Boolean(tab.service_fee_removed) },
          rounds,
        ).totalCents : null;
    return {
      id: tab.id,
      tableId: tab.table_id,
      tableLabel,
      status: tab.status,
      label: labels[index],
      billRequested: ['BILL_REQUESTED', 'WAITER_AUTHORIZED'].includes(tab.status),
      strictBillRequested: tab.status === 'BILL_REQUESTED',
      totalCents: computedTotal,
      viewHref: `#/painel/est-salon?table=${encodeURIComponent(tab.table_id)}`,
      checkoutHref: `#/painel/est-salon?table=${encodeURIComponent(tab.table_id)}&checkout=1`,
    };
  });
}

export function openDiningTabLabels(
  tabs: readonly DiningTabRow[],
  tables: readonly DiningTableRow[],
  now = Date.now(),
): string[] {
  const labels = new Map(tables.map(table => [table.id, table.label]));
  return tabs.map(tab => {
    const hours = Math.max(0, Math.floor((now - new Date(tab.opened_at).getTime()) / 3_600_000));
    return `${formatTableLabel(labels.get(tab.table_id), 'Mesa —')} aberta há ${hours} h`;
  });
}

function useOpenDiningTabs(includeTotals = false, allowed = true) {
  const { activeTenant, activeRole, supabaseUser, currentUser } = useAuth();
  const { available, isModuleEnabled } = useModules();
  const enabled = allowed && available && isModuleEnabled('dine_in');
  // Financial rows belong to this authenticated viewer as well as this store.
  const scope = JSON.stringify([activeTenant?.id, supabaseUser?.id ?? currentUser?.id, activeRole, enabled]);
  const [snapshot, setSnapshot] = useState<{ scope: string; warnings: OpenDiningTabWarningItem[] } | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    if (currentScope.current !== scope) return;
    const request = ++latestRequest.current;
    const isCurrent = () => currentScope.current === scope && latestRequest.current === request;
    if (!activeTenant?.id || !enabled) { setSnapshot({ scope, warnings: [] }); return; }
    const tenantId = activeTenant.id;
    try {
      const { data: tabs, error: tabsError } = await supabase.from('dining_tabs')
        .select('id,table_id,opened_at,status,service_fee_percent,service_fee_removed')
        .eq('tenant_id', tenantId)
        .in('status', ACTIVE_DINING_TAB_STATUSES)
        .order('opened_at');
      if (!isCurrent()) return;
      if (tabsError) throw tabsError;
      if (!tabs?.length) { setSnapshot({ scope, warnings: [] }); return; }
      const { data: tables, error: tablesError } = await supabase.from('dining_tables')
        .select('id,label').eq('tenant_id', tenantId);
      if (!isCurrent()) return;
      if (tablesError) throw tablesError;

      let roundsByTab: Map<string, RoundLike[]> | undefined;
      const billTabIds = (tabs as DiningTabRow[]).filter(t => t.status === 'BILL_REQUESTED').map(t => t.id);
      if (includeTotals && billTabIds.length > 0) {
        try {
          const { data: orders, error: ordersError } = await supabase.from('orders')
            .select('id,tab_id,subtotal,status,created_at')
            .eq('tenant_id', tenantId)
            .in('tab_id', billTabIds)
            .neq('status', 'CANCELLED');
          if (!isCurrent()) return;
          if (ordersError) throw ordersError;
          roundsByTab = new Map();
          for (const row of (orders || []) as Array<{ id: string; tab_id: string; subtotal: number; status: string; created_at?: string }>) {
            if (!row?.tab_id || row.status === 'CANCELLED') continue;
            const subtotal = Number(row.subtotal);
            if (!Number.isFinite(subtotal)) throw new Error('INVALID_TOTAL');
            const list = roundsByTab.get(row.tab_id) || [];
            list.push({ id: row.id, tab_id: row.tab_id, subtotal, status: row.status, created_at: row.created_at || '' });
            roundsByTab.set(row.tab_id, list);
          }
        } catch {
          // Keep the bill alert, but never invent a zero balance on a failed read.
          roundsByTab = undefined;
        }
      }

      if (!isCurrent()) return;
      setSnapshot({ scope, warnings: openDiningTabWarnings(tabs as DiningTabRow[], (tables || []) as DiningTableRow[], Date.now(), roundsByTab) });
    } catch (error) {
      if (!isCurrent()) return;
      const err = error as { code?: string };
      if (!['PGRST202', 'PGRST205', '42P01', '42883'].includes(err.code || '')) {
        console.error('[OpenDiningTabsWarning] Falha ao carregar comandas abertas.');
      }
      setSnapshot({ scope, warnings: [] });
    }
  }, [activeTenant?.id, enabled, includeTotals, scope]);

  useEffect(() => {
    void load();
    if (!enabled || !activeTenant?.id) return () => { latestRequest.current += 1; };
    const timer = window.setInterval(() => void load(), 5_000);
    const channel = supabase.channel?.(`open-tabs:${activeTenant.id}`)
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tabs', filter: `tenant_id=eq.${activeTenant.id}` }, () => void load())
      ?.subscribe();
    return () => {
      latestRequest.current += 1;
      window.clearInterval(timer);
      if (channel && supabase.removeChannel) void supabase.removeChannel(channel);
    };
  }, [load, enabled, activeTenant?.id]);

  return { enabled, warnings: snapshot?.scope === scope ? snapshot.warnings : [], activeTenantId: activeTenant?.id ?? null, scope };
}

export const OpenDiningTabsWarning: React.FC = () => {
  const { enabled, warnings } = useOpenDiningTabs(false);
  if (!enabled || !warnings.length) return null;
  return <aside className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status" data-testid="open-dining-tabs-warning">
    <div className="flex items-center gap-2 font-black"><AlertTriangle className="h-4 w-4" />Contas abertas no salão</div>
    <ul className="mt-2 flex flex-wrap gap-3">{warnings.map(warning => <li key={warning.id} className={`rounded-lg p-2 ${warning.billRequested ? 'salon-bill-alert' : ''}`}>
      <span>{warning.label}</span>{warning.billRequested && <a href={warning.checkoutHref} className="ml-3 inline-block rounded-lg border border-current px-3 py-2 font-bold">Fechar conta</a>}
    </li>)}</ul>
  </aside>;
};

const BILL_ALERT_ROLES = ['OWNER', 'MANAGER', 'CASHIER'];

/**
 * Item 13: Balão/toast global empilhado em qualquer tela do painel quando o cliente pede a conta (BILL_REQUESTED).
 * Usa a mesma assinatura em tempo real de Open Dining Tabs, respeita "Som ligado" e oferece "Ver conta" e "Fechar conta".
 */
export const PanelBillRequestedAlert: React.FC<{
  onViewBill: (tableId: string) => void;
  onCheckoutBill: (tableId: string) => void;
}> = ({ onViewBill, onCheckoutBill }) => {
  const { activeTenant, activeRole, supabaseUser } = useAuth();
  const roleAllowed = BILL_ALERT_ROLES.includes(activeRole || '');
  const { enabled, warnings, scope } = useOpenDiningTabs(true, roleAllowed);
  const [, refreshPreferences] = useState(0);
  useEffect(() => {
    const refresh = () => refreshPreferences(value => value + 1);
    window.addEventListener('dc:notification-preferences', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('dc:notification-preferences', refresh); window.removeEventListener('storage', refresh); };
  }, []);
  let balloonAllowed = true;
  try { if (activeTenant?.id && supabaseUser?.id) balloonAllowed = readPreferences(window.localStorage, activeTenant.id, supabaseUser.id).balloon; } catch { /* storage unavailable */ }
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const seenBillIdsRef = useRef<Set<string>>(new Set());
  const viewerRef = useRef(scope);

  useEffect(() => {
    if (viewerRef.current !== scope) {
      viewerRef.current = scope;
      seenBillIdsRef.current = new Set();
      setDismissedIds(new Set());
    }
  }, [scope]);
  const billWarnings = warnings.filter(w => w.strictBillRequested);

  useEffect(() => {
    if (!enabled || !roleAllowed) return;
    const currentIds = new Set(billWarnings.map(w => w.id));
    let hasNew = false;
    for (const id of currentIds) {
      if (!seenBillIdsRef.current.has(id)) {
        hasNew = true;
      }
    }
    // Se uma comanda saiu de BILL_REQUESTED (ex.: reaberta), limpa o estado de dispensada para alertar caso peça de novo.
    setDismissedIds(prev => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (currentIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    seenBillIdsRef.current = currentIds;
    if (hasNew && isBillToastSoundEnabled(typeof window !== 'undefined' ? window.localStorage : null, activeTenant?.id, supabaseUser?.id)) {
      playShortBeep();
    }
  }, [enabled, roleAllowed, billWarnings, activeTenant?.id, supabaseUser?.id]);

  const visible = billWarnings.filter(w => !dismissedIds.has(w.id));
  if (!enabled || !roleAllowed || !balloonAllowed || !visible.length) return null;

  const dismiss = (tabId: string) => {
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.add(tabId);
      return next;
    });
  };

  return (
    <aside
      role="region"
      aria-label="Contas solicitadas no salão"
      aria-live="assertive"
      data-testid="bill-requested-toast-stack"
      className="fixed bottom-4 right-4 z-[72] flex w-[min(92vw,24rem)] flex-col gap-2.5"
    >
      {visible.map(item => (
        <div
          key={item.id}
          role="alert"
          data-testid={`bill-requested-toast-${item.id}`}
          className="salon-bill-alert rounded-2xl p-3.5 shadow-2xl"
          style={{ backgroundColor: '#8B5A2B', color: '#FFFFFF', borderColor: '#5C3A1B' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="text-sm font-black">
                {item.tableLabel} pediu a conta — {item.totalCents === null ? 'Total indisponível' : formatBRL(item.totalCents / 100)}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Dispensar aviso da ${item.tableLabel}`}
              onClick={() => dismiss(item.id)}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/90 hover:bg-white/15"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                dismiss(item.id);
                onViewBill(item.tableId);
              }}
              className="flex-1 rounded-xl border border-white/40 bg-white/15 px-3 py-2 text-xs font-black text-white hover:bg-white/25"
            >
              Ver conta
            </button>
            <button
              type="button"
              onClick={() => {
                dismiss(item.id);
                onCheckoutBill(item.tableId);
              }}
              className="flex-1 rounded-xl bg-white px-3 py-2 text-xs font-black text-[#0F172A] hover:bg-slate-100"
            >
              Fechar conta
            </button>
          </div>
        </div>
      ))}
    </aside>
  );
};
