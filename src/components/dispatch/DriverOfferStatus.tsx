import React, { createContext, useContext, useEffect, useState } from 'react';
import { DriverOffer } from '../../repositories/driverOfferRepository';
export const DriverOffersContext = createContext<{ offers: DriverOffer[]; cancel: (id: string) => Promise<void> }>({ offers: [], cancel: async () => {} });
export function remainingOfferSeconds(expiresAt: string, now = Date.now()) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}
export function OfferCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [expiresAt]);
  return <span role="timer" aria-label="Tempo para responder">{remainingOfferSeconds(expiresAt, now)}s</span>;
}
export function useOrderOffer(orderId: string) {
  const { offers } = useContext(DriverOffersContext);
  const rows = offers.filter(o => o.order_id === orderId);
  return { live: rows.find(o => o.status === 'OFFERED'), last: rows[0] };
}
export function DriverOfferStatus({ orderId }: { orderId: string }) {
  const { cancel } = useContext(DriverOffersContext);
  const { live, last } = useOrderOffer(orderId);
  const [busy, setBusy] = useState(false);
  if (!live) return last?.status === 'DECLINED' || last?.status === 'EXPIRED'
    ? <p className="text-xs text-amber-800">{last.status === 'DECLINED' ? 'Entregador recusou' : 'Entregador não respondeu'}</p> : null;
  return <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950" onClick={e => e.stopPropagation()}>
    <p className="font-bold">Aguardando aceite do entregador</p><OfferCountdown expiresAt={live.expires_at} />
    <button type="button" disabled={busy} className="block underline disabled:opacity-50" onClick={async () => {
      setBusy(true); try { await cancel(live.id); } finally { setBusy(false); }
    }}>Cancelar chamada</button>
  </div>;
}
// resync
