import React from 'react';
import { Button } from '../ui/Button';

/** O status deve vir de uma consulta do pedido ao servidor, nunca do checkout local. */
export function CheckoutTrackingAction({ requiresPayment, serverPaymentStatus, color, onTrack }: {
  requiresPayment: boolean; serverPaymentStatus?: string; color: string; onTrack: () => void;
}) {
  if (requiresPayment && serverPaymentStatus !== 'PAID') {
    return <p role="status" className="text-sm text-gray-600">Aguardando pagamento…</p>;
  }
  return <Button className="w-full text-white font-bold" style={{ backgroundColor: color }} onClick={onTrack}>Acompanhar Meus Pedidos</Button>;
}
