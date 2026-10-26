import React, { useEffect, useState } from 'react';
import { MyDriverOffer } from '../../repositories/driverOfferRepository';
import { OfferCountdown, remainingOfferSeconds } from '../dispatch/DriverOfferStatus';
import { formatBRL } from '../../lib/pricing/money';
export function DriverRideOffer({ offer, busy, onRespond }: { offer: MyDriverOffer; busy: boolean; onRespond: (accept: boolean) => void }) {
  const [expired, setExpired] = useState(() => remainingOfferSeconds(offer.expires_at) === 0);
  useEffect(() => {
    const update = () => setExpired(remainingOfferSeconds(offer.expires_at) === 0);
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [offer.expires_at]);
  return <section role="dialog" aria-modal="true" aria-label="Oferta de corrida" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
      <h2 className="text-xl font-bold">Nova oferta de corrida</h2>
      <p>Pedido #{offer.order_number} • {offer.store_name}</p>
      <p>Bairro de entrega: {offer.neighborhood}</p>
      <p className="text-lg font-bold">Frete: {formatBRL(offer.delivery_fee)}</p>
      <p>Responda em <OfferCountdown expiresAt={offer.expires_at} /></p>
      <p className="text-sm text-gray-600">O endereço completo será exibido após o aceite.</p>
      {expired && <p role="status">Esta chamada expirou. Aguardando uma nova oferta.</p>}
      <div className="flex gap-3">
        <button type="button" disabled={busy || expired} className="flex-1 rounded-xl border p-3 disabled:opacity-50" onClick={() => onRespond(false)}>Recusar</button>
        <button type="button" disabled={busy || expired} className="flex-1 rounded-xl bg-green-700 p-3 font-bold text-white disabled:opacity-50" onClick={() => onRespond(true)}>Aceitar</button>
      </div>
    </div>
  </section>;
}
