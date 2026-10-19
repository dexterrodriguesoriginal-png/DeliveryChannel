import React, { useEffect, useState } from 'react';
import { arrivalRepository } from '../../repositories/arrivalRepository';
import { arrivalErrorMessage } from '../../lib/pickup/arrival';
import { ArrivalPoster, PosterActions } from './ArrivalPoster';

/** Conteúdo do QR de chegada: cartaz, imprimir/baixar, trocar QR e opção da TV (dono/gerente). */
export const StoreArrivalQrPanel: React.FC<{ tenantId: string; storeName: string; canManage: boolean; scale?: number }> = ({ tenantId, storeName, canManage, scale }) => {
  const [token, setToken] = useState<string | null>(null);
  const [showName, setShowName] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    arrivalRepository.getStoreQr(tenantId).then(r => { setToken(r.token); setShowName(Boolean(r.showNameOnTv)); }).catch(e => setErr(arrivalErrorMessage(e)));
  }, [tenantId]);
  const rotate = async () => {
    if (!window.confirm('Trocar o QR de chegada? O cartaz impresso antigo deixa de funcionar.')) return;
    try { setToken((await arrivalRepository.rotateStoreQr(tenantId)).token); } catch (e) { setErr(arrivalErrorMessage(e)); }
  };
  const toggle = async () => {
    try { setShowName((await arrivalRepository.setTvShowName(tenantId, !showName)).showNameOnTv); } catch (e) { setErr(arrivalErrorMessage(e)); }
  };
  if (!token) return <p className="text-sm text-slate-500">{err || 'Carregando...'}</p>;
  return (
    <div className="space-y-3">
      <ArrivalPoster storeName={storeName} token={token} scale={scale} />
      <div className="flex gap-2"><PosterActions storeName={storeName} token={token} /></div>
      {canManage && (
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-2 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 cursor-pointer">
            <span>Mostrar primeiro nome na TV <span className="font-normal text-slate-500">(padrão: só o código)</span></span>
            <input type="checkbox" checked={showName} onChange={toggle} data-testid="tv-show-name" className="w-4 h-4 accent-green-700" />
          </label>
          <button type="button" onClick={rotate} data-testid="arrival-qr-rotate" className="w-full py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50">Trocar QR (invalida o cartaz antigo)</button>
        </div>
      )}
      {err && <p className="text-xs font-bold text-red-700">{err}</p>}
    </div>
  );
};
