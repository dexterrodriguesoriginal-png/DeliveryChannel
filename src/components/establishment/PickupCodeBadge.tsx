import React, { useCallback, useEffect, useState } from 'react';
import { handoffRepository, PickupCodeInfo } from '../../repositories/handoffRepository';

/** Código de retirada (visível só para a equipe da loja). O entregador precisa digitá-lo para sair com o pedido. */
export const PickupCodeBadge: React.FC<{ orderId: string; status: string }> = ({ orderId, status }) => {
  const [info, setInfo] = useState<PickupCodeInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setInfo(await handoffRepository.getPickupCode(orderId)); } catch { setInfo(null); }
  }, [orderId]);
  useEffect(() => { load(); }, [load, status]);
  if (!info) return null;
  return (
    <div className="p-1.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between gap-2" data-testid="pickup-code">
      <div>
        <div className="text-[7.5px] font-bold uppercase tracking-wider text-amber-700">Código de retirada</div>
        <div className="font-mono text-base font-extrabold tracking-[0.3em] text-amber-900">
          {info.confirmed ? 'Retirado ✓' : info.code}
        </div>
        {!info.confirmed && <div className="text-[8px] text-amber-800">Informe ao entregador só na entrega do pacote.</div>}
      </div>
      {info.locked && !info.confirmed && (
        <button type="button" disabled={busy} className="text-[9px] font-bold px-2 py-1 rounded-md bg-amber-600 text-white cursor-pointer"
          onClick={async () => { setBusy(true); try { setInfo(await handoffRepository.resetPickupCode(orderId)); } finally { setBusy(false); } }}>
          Bloqueado • gerar novo
        </button>
      )}
    </div>
  );
};
