import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { deliveryRepository, type DeliveryDispute, type DeliveryResolution } from '../../../repositories/deliveryRepository';
import { statusColorStyle, statusColorTokens } from '../../../lib/orders/statusColors';

/** Tenant-scoped queue also includes disputed orders whose tab has already closed. */
export const DeliveryDisputesPanel: React.FC<{ tenantId: string; onResolved?: () => void }> = ({ tenantId, onResolved }) => {
  const [snapshot, setSnapshot] = useState<{ tenantId: string; rows: DeliveryDispute[] } | null>(null);
  const [error, setError] = useState<{ tenantId: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const scope = useRef(tenantId); scope.current = tenantId;
  const changed = useRef(onResolved); changed.current = onResolved;
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    let active = true; let generation = 0;
    scope.current = tenantId;
    setBusy(null); setError(null);
    const refresh = async () => {
      const request = ++generation;
      try {
        const rows = await deliveryRepository.openDisputes(tenantId);
        if (active && request === generation && scope.current === tenantId) { setSnapshot({ tenantId, rows }); setError(null); }
      } catch {
        if (active && request === generation && scope.current === tenantId) setError({ tenantId, message: 'Não foi possível carregar as entregas contestadas.' });
      }
    };
    refreshRef.current = refresh;
    void refresh();
    const stop = deliveryRepository.observe(tenantId, () => { void refresh(); });
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; generation++; window.clearInterval(timer); stop(); refreshRef.current = null; if (scope.current === tenantId) scope.current = ''; };
  }, [tenantId]);
  const rows = snapshot?.tenantId === tenantId ? snapshot.rows : [];
  const message = error?.tenantId === tenantId ? error.message : '';
  const runAction = async (id: string, action: () => Promise<void>) => {
    if (busy) return;
    const requestScope = tenantId;
    setBusy(id); setError(null);
    try {
      await action();
      if (scope.current !== requestScope) return;
      await refreshRef.current?.();
      if (scope.current === requestScope) changed.current?.();
    } catch {
      if (scope.current === requestScope) setError({ tenantId: requestScope, message: 'Não foi possível resolver a entrega. Atualize a lista e tente novamente.' });
    } finally { if (scope.current === requestScope) setBusy(null); }
  };
  if (!rows.length && !message) return null;
  const resolve = (id: string, resolution: DeliveryResolution) => runAction(id, () => deliveryRepository.resolve(id, resolution));
  return <section aria-label="Entregas contestadas" className="mb-4 space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-slate-900">
    <h2 className="flex items-center gap-2 text-base font-black text-amber-950"><AlertTriangle className="h-5 w-5" aria-hidden="true" />Acompanhamento de entregas</h2>
    <p className="text-sm text-amber-950">Confira os pedidos que o cliente não recebeu e acompanhe os reenvios até a entrega.</p>
    {message && <p role="status" className="text-sm font-semibold text-rose-800">{message}</p>}
    {rows.map(row => <article key={row.id} className="rounded-xl border border-amber-200 bg-white p-3" aria-label={`Entrega contestada do pedido ${row.order_number}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.table_label || 'Mesa'} · Pedido #{row.order_number}</strong><time dateTime={row.created_at} className="text-xs text-slate-500">{new Date(row.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></div>
      {row.status === 'OPEN' ? <p className="mt-2 text-sm font-bold text-amber-950">Cliente não recebeu o pedido</p> : <p className="mt-2 rounded-lg border px-2 py-1 text-sm font-bold" style={statusColorStyle(row.order_status)}>Pedido reenviado · {['READY', 'OUT_FOR_DELIVERY'].includes(row.order_status) ? 'Pronto para entregar' : 'Em produção'}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {row.status === 'OPEN' && <>
          <button type="button" disabled={!!busy} onClick={() => void resolve(row.id, 'CONFIRMED_DELIVERED')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 text-sm font-bold text-white disabled:opacity-50"><Check className="h-4 w-4" aria-hidden="true" />Confirmar entrega</button>
          <button type="button" disabled={!!busy} onClick={() => void resolve(row.id, 'RESENT')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-orange-300 bg-orange-50 px-3 text-sm font-bold text-orange-950 disabled:opacity-50"><RefreshCw className="h-4 w-4" aria-hidden="true" />Reenviar</button>
        </>}
        {row.status === 'RESENT' && ['READY', 'OUT_FOR_DELIVERY'].includes(row.order_status) && <button type="button" title={row.order_status === 'OUT_FOR_DELIVERY' ? undefined : 'Aguardando balcão'} disabled={!!busy || row.order_status !== 'OUT_FOR_DELIVERY'} onClick={() => void runAction(row.id, () => deliveryRepository.markDelivered(row.order_id))} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: statusColorTokens('DELIVERED').solid }}><Check className="h-4 w-4" aria-hidden="true" />Entregue</button>}
      </div>
    </article>)}
  </section>;
};
