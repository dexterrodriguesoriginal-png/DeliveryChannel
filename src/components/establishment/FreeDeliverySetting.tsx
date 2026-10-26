import React from 'react';

// Since migration 1700, delivery_fee is a flag: zero = free, positive = shared fee.
export const deliveryFeeForFreeDelivery = (free: boolean) => free ? 0 : 7;

export function FreeDeliverySetting({ fee, disabled, onChange }: {
  fee: number; disabled: boolean; onChange: (fee: number) => void;
}) {
  const free = fee === 0;
  return <div className="space-y-2 text-sm">
    <label className="flex items-center gap-2 font-semibold text-gray-700">
      <input type="checkbox" role="switch" checked={free} disabled={disabled}
        onChange={event => onChange(deliveryFeeForFreeDelivery(event.target.checked))} />
      Entrega grátis para o cliente
    </label>
    <p className="text-xs text-gray-600">{free
      ? 'O cliente paga R$ 0,00. Sua loja paga R$ 7,00 ao entregador.'
      : 'O cliente paga R$ 3,50 e sua loja paga R$ 3,50. O entregador recebe R$ 7,00.'}</p>
  </div>;
}
