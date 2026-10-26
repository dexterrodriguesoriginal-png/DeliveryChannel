import { useEffect, useRef, useState } from 'react';
import { driverOfferRepository as repo, DriverOffer } from '../repositories/driverOfferRepository';
import { useToast } from '../context/ToastContext';
import { dispatchErrorMessage } from '../lib/orders/dispatchErrors';
export function offerOutcomeMessage(status: string): string | null {
  return status === 'DECLINED' ? 'Entregador recusou' : status === 'EXPIRED' ? 'Entregador não respondeu' : null;
}
export function useOwnerDriverOffers(tenant: string | undefined, orderIds: string[], onChanged: () => void) {
  const [offers, setOffers] = useState<DriverOffer[]>([]);
  const { showToast } = useToast();
  const callbacks = useRef({ onChanged, showToast }); callbacks.current = { onChanged, showToast };
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const idsKey = [...orderIds].sort().join(',');
  useEffect(() => {
    setOffers([]);
    if (!tenant || !idsKey) return;
    let alive = true, running = false, queued = false;
    let previous: Map<string, string> | null = null;
    const refresh = async () => {
      if (running) { queued = true; return; }
      running = true;
      try {
        do {
          queued = false;
          await repo.expire();
          const rows = await repo.forOrders(tenant, idsKey.split(','));
          if (!alive) return;
          if (previous) {
            for (const row of rows) {
              if (previous.get(row.id) !== row.status && (previous.get(row.id) === 'OFFERED' || !previous.has(row.id))) {
                const message = offerOutcomeMessage(row.status);
                if (message) callbacks.current.showToast({ type: 'warning', title: message, message: 'Chame outro entregador ou acompanhe a fila automática.' });
              }
            }
            if (rows.some(r => r.status === 'ACCEPTED' && previous!.get(r.id) !== 'ACCEPTED')) callbacks.current.onChanged();
          }
          previous = new Map(rows.map(r => [r.id, r.status]));
          setOffers(rows);
        } while (queued && alive);
      } catch { /* polling retoma após reconexão */ }
      finally { running = false; }
    };
    refreshRef.current = refresh;
    void refresh();
    const unsub = repo.subscribeTenant(tenant, () => { void refresh(); });
    const timer = window.setInterval(() => { void refresh(); }, 10000);
    return () => { alive = false; refreshRef.current = async () => {}; unsub(); window.clearInterval(timer); };
  }, [tenant, idsKey]);
  return { offers, refresh: () => refreshRef.current(), cancel: async (id: string) => {
    try { await repo.cancel(id); await refreshRef.current(); }
    catch (e) { callbacks.current.showToast({ type: 'error', title: 'Não foi possível cancelar a chamada', message: dispatchErrorMessage(e) }); }
  } };
}
// resync
