import React from 'react';
import { StoreArrivalQrPanel } from './StoreArrivalQrPanel';

/** QR de chegada da loja (atalho na aba Retirada). */
export const StoreArrivalQrModal: React.FC<{ tenantId: string; storeName: string; canRotate: boolean; onClose: () => void }> = ({ tenantId, storeName, canRotate, onClose }) => (
  <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
    <div onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-4 space-y-3 max-h-[95vh] overflow-y-auto" data-testid="arrival-qr-modal">
      <div className="flex items-center justify-between"><h3 className="text-base font-black text-slate-900">QR de chegada</h3>
        <button type="button" onClick={onClose} className="text-sm font-bold text-slate-500">Fechar</button></div>
      <StoreArrivalQrPanel tenantId={tenantId} storeName={storeName} canManage={canRotate} />
    </div>
  </div>
);
