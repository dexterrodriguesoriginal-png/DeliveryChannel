import React, { useEffect, useState } from 'react';
import { handoffRepository } from '../../repositories/handoffRepository';

/** Código de entrega: só o cliente dono vê, e só com o pedido a caminho. */
export const DeliveryCodeCard: React.FC<{ orderId: string; status: string }> = ({ orderId, status }) => {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (status !== 'OUT_FOR_DELIVERY') { setCode(null); return; }
    let alive = true;
    const load = () => handoffRepository.getMyDeliveryCode(orderId).then(c => { if (alive) setCode(c); }).catch(() => {});
    load();
    const id = window.setInterval(load, 8000);
    return () => { alive = false; window.clearInterval(id); };
  }, [orderId, status]);
  if (!code) return null;
  return (
    <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-3 text-center" data-testid="delivery-code">
      <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Código de entrega</div>
      <div className="font-mono text-3xl font-black tracking-[0.4em] text-emerald-900 my-1">{code}</div>
      <p className="text-[11px] text-emerald-900 leading-snug">Informe este código ao entregador somente quando receber seu pedido.</p>
    </div>
  );
};
