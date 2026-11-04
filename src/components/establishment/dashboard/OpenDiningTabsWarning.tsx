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
  totalCents: number;
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
      : tabTotals(
          { service_fee_percent: Number(tab.service_fee_percent ?? 0), service_fee_removed: Boolean(tab.service_fee_removed) },
          rounds,
        ).totalCents;
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

function useOpenDiningTabs(includeTotals = false) {
  const { activeTenant } = useAuth();
  const { available, isModuleEnabled } = useModules();
  const [warnings, setWarnings] = useState<OpenDiningTabWarningItem[]>([]);
  const [warningsTenant, setWarningsTenant] = useState<string | null>(null);
  const currentTenant = useRef(activeTenant?.id);
  currentTenant.current = activeTenant?.id;
  const enabled = available && isModuleEnabled('dine_in');

  const load = useCallback(async () => {
    if (!activeTenant?.id || !enabled) { setWarnings([]); return; }
    const tenantId = activeTenant.id;
    try {
      const { data: tabs, error: tabsError } = await supabase.from('dining_tabs')
        .select('id,table_id,opened_at,status,service_fee_percent,service_fee_removed')
        .eq('tenant_id', tenantId)
        .in('status', ACTIVE_DINING_TAB_STATUSES)
        .order('opened_at');
      if (currentTenant.current !== tenantId) return;
      if (tabsError) throw tabsError;
      if (!tabs?.length) { setWarnings([]); setWarningsTenant(tenantId); return; }
      const { data: tables, error: tablesError } = await supabase.from('dining_tables')
        .select('id,label').eq('tenant_id', tenantId);
      if (currentTenant.current !== tenantId) return;
      if (tablesError) throw tablesError;

      const roundsByTab = new Map<string, RoundLike[]>();
      const billTabIds = (tabs as DiningTabRow[]).filter(t => t.status === 'BILL_REQUESTED').map(t => t.id);
      if (includeTotals && billTabIds.length > 0) {
        try {
          const { data: orders } = await supabase.from('orders')
            .select('id,tab_id,subtotal,status,created_at')
            .eq('tenant_id', tenantId)
            .in('tab_id', billTabIds)
            .neq('status', 'CANCELLED');
          if (currentTenant.current !== tenantId) return;
          for (const row of (orders || []) as Array<{ id: string; tab_id: string; subtotal: number; status: string; created_at?: string }>) {
            if (!row?.tab_id || row.status === 'CANCELLED') continue;
            const list = roundsByTab.get(row.tab_id) || [];
            list.push({ id: row.id, tab_id: row.tab_id, subtotal: Number(row.subtotal || 0), status: row.status, created_at: row.created_at || '' });
            roundsByTab.set(row.tab_id, list);
          }
        } catch {
          /* totals fall back to 0 if orders query is unavailable */
        }
      }

      if (currentTenant.current !== tenantId) return;
      setWarnings(openDiningTabWarnings(tabs as DiningTabRow[], (tables || []) as DiningTableRow[], Date.now(), roundsByTab));
      setWarningsTenant(tenantId);
    } catch (error) {
      if (currentTenant.current !== activeTenant?.id) return;
      const err = error as { code?: string; message?: string };
      if (!['PGRST202', 'PGRST205', '42P01', '42883'].includes(err.code || '')) {
        console.error('[OpenDiningTabsWarning] Falha ao carregar comandas abertas:', error);
      }
      setWarnings([]);
    }
  }, [activeTenant?.id, enabled, includeTotals]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    const channel = activeTenant?.id && supabase.channel?.(`open-tabs:${activeTenant.id}`)
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tabs', filter: `tenant_id=eq.${activeTenant.id}` }, () => void load())
      ?.subscribe();
    return () => { window.clearInterval(timer); if (channel && supabase.removeChannel) void supabase.removeChannel(channel); };
  }, [load, activeTenant?.id]);

  return { enabled, warnings: warningsTenant === activeTenant?.id ? warnings : [], activeTenantId: activeTenant?.id ?? null };
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
  const { activeTenant, activeRole, supabaseUser } = useAuth() as ReturnType<typeof useAuth> & { supabaseUser?: { id?: string } | null };
  const { enabled, warnings, activeTenantId } = useOpenDiningTabs(true);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const seenBillIdsRef = useRef<Set<string>>(new Set());
  const tenantRef = useRef<string | null>(activeTenantId);

  useEffect(() => {
    if (tenantRef.current !== activeTenantId) {
      tenantRef.current = activeTenantId;
      seenBillIdsRef.current = new Set();
      setDismissedIds(new Set());
    }
  }, [activeTenantId]);

  const roleAllowed = !activeRole || BILL_ALERT_ROLES.includes(activeRole);
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
  if (!enabled || !roleAllowed || !visible.length) return null;

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
                {item.tableLabel} pediu a conta — {formatBRL(item.totalCents / 100)}
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
