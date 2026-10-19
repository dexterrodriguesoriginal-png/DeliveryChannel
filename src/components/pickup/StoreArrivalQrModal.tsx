import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { arrivalRepository } from '../../repositories/arrivalRepository';
import { arrivalErrorMessage, arrivalQrUrl } from '../../lib/pickup/arrival';

/** QR de chegada da loja: imprimir e colar no balcão; dono/gerente pode trocar. */
export const StoreArrivalQrModal: React.FC<{ tenantId: string; storeName: string; canRotate: boolean; onClose: () => void }> = ({ tenantId, storeName, canRotate, onClose }) => {
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { arrivalRepository.getStoreQr(tenantId).then(r => setToken(r.token)).catch(e => setErr(arrivalErrorMessage(e))); }, [tenantId]);
  const rotate = async () => {
    if (!window.confirm('Trocar o QR de chegada? O QR impresso antigo deixa de funcionar.')) return;
    try { setToken((await arrivalRepository.rotateStoreQr(tenantId)).token); } catch (e) { setErr(arrivalErrorMessage(e)); }
  };
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5 text-center space-y-3 print:shadow-none" data-testid="arrival-qr-modal">
        <h3 className="text-lg font-black text-slate-900">Chegou para retirar?</h3>
        <p className="text-xs text-slate-600">Escaneie no app <b>Delivery Channel</b> em “Cheguei na loja” e entre na fila de retirada de <b>{storeName}</b>.</p>
        {token ? (
          <>
            <div className="flex justify-center"><QRCodeSVG value={arrivalQrUrl(window.location.origin, token)} size={220} level="M" /></div>
            <div className="text-[11px] text-slate-500">Ou digite o código da loja</div>
            <div className="font-mono text-3xl font-black tracking-[0.3em] text-slate-900" data-testid="arrival-store-code">{token}</div>
          </>
        ) : <p className="text-sm text-slate-500">{err || 'Carregando...'}</p>}
        <div className="flex gap-2 print:hidden">
          <button type="button" onClick={() => window.print()} className="flex-1 py-2 rounded-xl bg-[#15803d] text-white text-sm font-bold">Imprimir</button>
          {canRotate && <button type="button" onClick={rotate} data-testid="arrival-qr-rotate" className="flex-1 py-2 rounded-xl border border-slate-300 text-sm font-bold text-slate-700">Trocar QR</button>}
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-xl border border-slate-300 text-sm font-bold text-slate-700">Fechar</button>
        </div>
      </div>
    </div>
  );
};
