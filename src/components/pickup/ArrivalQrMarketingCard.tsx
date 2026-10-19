import React, { useEffect, useState } from 'react';
import { QrCode } from 'lucide-react';
import { arrivalRepository } from '../../repositories/arrivalRepository';
import { StoreArrivalQrPanel } from './StoreArrivalQrPanel';

/** Marketing: card "QR de chegada para retirada" (some se o banco não tiver a fila). */
export const ArrivalQrMarketingCard: React.FC<{ tenantId: string; storeName: string; canManage: boolean }> = ({ tenantId, storeName, canManage }) => {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { arrivalRepository.listOpen(tenantId).then(r => setOn(r !== null)).catch(() => setOn(false)); }, [tenantId]);
  if (!on) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs" data-testid="arrival-qr-marketing">
      <div className="flex items-start gap-3 mb-3">
        <span className="w-9 h-9 rounded-xl bg-green-50 border border-green-200 text-green-700 flex items-center justify-center"><QrCode className="w-5 h-5" /></span>
        <div>
          <h2 className="text-sm font-black text-slate-900">QR de chegada para retirada</h2>
          <p className="text-xs text-slate-500">Imprima e cole no balcão. O cliente aponta a câmera do celular, entra na fila e você vê quem chegou na aba Retirada.</p>
        </div>
      </div>
      <div className="max-w-sm"><StoreArrivalQrPanel tenantId={tenantId} storeName={storeName} canManage={canManage} /></div>
    </div>
  );
};
