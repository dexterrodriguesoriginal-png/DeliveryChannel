import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useModules } from '../../../hooks/useModules';
import { formatTableLabel } from '../../../lib/orders/labels';
import { supabase } from '../../../lib/supabase';

type DiningTabRow = { id: string; table_id: string; opened_at: string; status: string };
type DiningTableRow = { id: string; label: string };

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
  const [warnings, setWarnings] = useState<string[]>([]);
  const enabled = available && isModuleEnabled('dine_in');
  const load = useCallback(async () => {
    if (!activeTenant?.id || !enabled) { setWarnings([]); return; }
    try {
      const { data: tabs, error: tabsError } = await supabase.from('dining_tabs')
        .select('id,table_id,opened_at,status').eq('tenant_id', activeTenant.id).in('status', ['OPEN', 'BILL_REQUESTED']).order('opened_at');
      if (tabsError) throw tabsError;
      if (!tabs?.length) { setWarnings([]); return; }
      const { data: tables, error: tablesError } = await supabase.from('dining_tables')
        .select('id,label').eq('tenant_id', activeTenant.id);
      if (tablesError) throw tablesError;
      setWarnings(openDiningTabLabels(tabs as DiningTabRow[], (tables || []) as DiningTableRow[]));
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (!['PGRST202', 'PGRST205', '42P01', '42883'].includes(err.code || '')) {
        console.error('[OpenDiningTabsWarning] Falha ao carregar comandas abertas:', error);
      }
      setWarnings([]);
    }
  }, [activeTenant?.id, enabled]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!warnings.length) return null;
  return <aside className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status" data-testid="open-dining-tabs-warning">
    <div className="flex items-center gap-2 font-black"><AlertTriangle className="h-4 w-4" />Contas abertas no salão</div>
    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
  </aside>;
};
