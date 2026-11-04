import React, { useEffect, useId, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { tableMoveApprovalRepository, type TableMoveRequest } from '../../../repositories/tableMoveApprovalRepository';

/** Server decides both who may see a request and who may authorize it. */
export function TableMoveRequestsPanel({ tenantId, viewerId = '', role, onResolved }: {
  tenantId: string; viewerId?: string; role?: string | null; onResolved?: () => void;
}) {
  const scope = `${tenantId}:${viewerId}:${role || ''}`;
  const current = useRef(scope); current.current = scope;
  const instance = useId();
  const [snapshot, setSnapshot] = useState<{ scope: string; permitted: boolean; rows: TableMoveRequest[]; error: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const notify = useRef(onResolved); notify.current = onResolved;
  useEffect(() => {
    setBusy(null);
    if (!tenantId || !['OWNER', 'WAITER'].includes(role || '')) return;
    let active = true; let request = 0;
    const load = async () => {
      const call = ++request;
      const matches = () => active && current.current === scope && call === request;
      try {
        const permitted = role === 'OWNER' || await tableMoveApprovalRepository.waiterEnabled(tenantId);
        if (!matches()) return;
        if (!permitted) { setSnapshot({ scope, permitted: false, rows: [], error: '' }); return; }
        const pending = await tableMoveApprovalRepository.pending(tenantId);
        if (matches()) setSnapshot({ scope, permitted: true, rows: pending, error: '' });
      } catch {
        if (matches()) setSnapshot(previous => ({ scope, permitted: role === 'OWNER' || (previous?.scope === scope && previous.permitted), rows: [], error: 'Não foi possível atualizar as solicitações de mudança de mesa.' }));
      }
    };
    refreshRef.current = () => void load();
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (typeof supabase.channel === 'function') {
      try {
        channel = supabase.channel(`table-move-requests:${tenantId}:${instance}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'table_move_requests', filter: `tenant_id=eq.${tenantId}` }, () => void load())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_service_settings', filter: `tenant_id=eq.${tenantId}` }, () => void load())
          .subscribe();
      } catch { /* periodic refresh remains available */ }
    }
    return () => { active = false; request++; window.clearInterval(timer); if (channel && typeof supabase.removeChannel === 'function') void supabase.removeChannel(channel); };
  }, [tenantId, scope, role, instance]);
  const visible = snapshot?.scope === scope && snapshot.permitted && ['OWNER', 'WAITER'].includes(role || '');
  if (!visible || (!snapshot.rows.length && !snapshot.error)) return null;
  const decide = async (id: string, approve: boolean) => {
    if (busy) return;
    setBusy(id);
    try {
      await tableMoveApprovalRepository.resolve(id, approve);
      if (current.current !== scope) return;
      setSnapshot(previous => previous?.scope === scope ? { ...previous, rows: previous.rows.filter(row => row.id !== id), error: '' } : previous);
      notify.current?.();
      refreshRef.current();
    } catch (error) {
      if (current.current === scope) setSnapshot(previous => previous?.scope === scope ? { ...previous, error: error instanceof Error ? error.message : 'Não foi possível responder à solicitação.' } : previous);
    } finally { if (current.current === scope) setBusy(null); }
  };
  return <section aria-label="Solicitações de mudança de mesa" data-testid="table-move-requests" className="mb-4 space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-slate-950">
    <h2 className="font-black">Mudanças de mesa aguardando autorização</h2>
    {snapshot.error && <p role="alert" className="text-sm font-semibold text-red-800">{snapshot.error}</p>}
    {snapshot.rows.map(row => <article key={row.id} className="rounded-xl border border-amber-200 bg-white p-3">
      <p className="text-sm font-bold">{row.fromLabel} → {row.toLabel}</p>
      <p className="mt-1 text-xs text-slate-600">A conta continua na mesa atual até a autorização.</p>
      <div className="mt-3 flex gap-2"><button type="button" disabled={!!busy} onClick={() => void decide(row.id, false)} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold disabled:opacity-50">Recusar</button>
        <button type="button" disabled={!!busy} onClick={() => void decide(row.id, true)} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50">Autorizar</button></div>
    </article>)}
  </section>;
}
