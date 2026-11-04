import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useModules } from '../../../hooks/useModules';
import { formatTableLabel } from '../../../lib/orders/labels';
import { supabase } from '../../../lib/supabase';
import { ACTIVE_DINING_TAB_STATUSES } from '../../../lib/salon/tableStatus';
import '../salon/salon.css';

type DiningTabRow = { id: string; table_id: string; opened_at: string; status: string };
type DiningTableRow = { id: string; label: string };

export function openDiningTabWarnings(tabs: readonly DiningTabRow[], tables: readonly DiningTableRow[], now = Date.now()) {
  const labels = openDiningTabLabels(tabs, tables, now);
  return tabs.map((tab, index) => ({ id: tab.id, label: labels[index],
    billRequested: ['BILL_REQUESTED', 'WAITER_AUTHORIZED'].includes(tab.status),
    checkoutHref: `#/painel/est-salon?table=${encodeURIComponent(tab.table_id)}&checkout=1`,
  }));
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

export const OpenDiningTabsWarning: React.FC = () => {
  const { activeTenant } = useAuth();
  const { available, isModuleEnabled } = useModules();
  const [warnings, setWarnings] = useState<ReturnType<typeof openDiningTabWarnings>>([]);
  const [warningsTenant, setWarningsTenant] = useState<string | null>(null);
  const currentTenant = useRef(activeTenant?.id);
  currentTenant.current = activeTenant?.id;
  const enabled = available && isModuleEnabled('dine_in');
  const load = useCallback(async () => {
    if (!activeTenant?.id || !enabled) { setWarnings([]); return; }
    try {
      const { data: tabs, error: tabsError } = await supabase.from('dining_tabs')
        .select('id,table_id,opened_at,status').eq('tenant_id', activeTenant.id).in('status', ACTIVE_DINING_TAB_STATUSES).order('opened_at');
      if (currentTenant.current !== activeTenant.id) return;
      if (tabsError) throw tabsError;
      if (!tabs?.length) { setWarnings([]); return; }
      const { data: tables, error: tablesError } = await supabase.from('dining_tables')
        .select('id,label').eq('tenant_id', activeTenant.id);
      if (currentTenant.current !== activeTenant.id) return;
      if (tablesError) throw tablesError;
      setWarnings(openDiningTabWarnings(tabs as DiningTabRow[], (tables || []) as DiningTableRow[]));
      setWarningsTenant(activeTenant.id);
    } catch (error) {
      if (currentTenant.current !== activeTenant?.id) return;
      const err = error as { code?: string; message?: string };
      if (!['PGRST202', 'PGRST205', '42P01', '42883'].includes(err.code || '')) {
        console.error('[OpenDiningTabsWarning] Falha ao carregar comandas abertas:', error);
      }
      setWarnings([]);
    }
  }, [activeTenant?.id, enabled]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    const channel = activeTenant?.id && supabase.channel(`open-tabs:${activeTenant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tabs', filter: `tenant_id=eq.${activeTenant.id}` }, () => void load()).subscribe();
    return () => { window.clearInterval(timer); if (channel) void supabase.removeChannel(channel); };
  }, [load, activeTenant?.id]);

  if (!enabled || warningsTenant !== activeTenant?.id || !warnings.length) return null;
  return <aside className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status" data-testid="open-dining-tabs-warning">
    <div className="flex items-center gap-2 font-black"><AlertTriangle className="h-4 w-4" />Contas abertas no salão</div>
    <ul className="mt-2 flex flex-wrap gap-3">{warnings.map(warning => <li key={warning.id} className={`rounded-lg p-2 ${warning.billRequested ? 'salon-bill-alert' : ''}`}>
      <span>{warning.label}</span>{warning.billRequested && <a href={warning.checkoutHref} className="ml-3 inline-block rounded-lg border border-current px-3 py-2 font-bold">Fechar conta</a>}
    </li>)}</ul>
  </aside>;
};
