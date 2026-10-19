import React, { useCallback, useEffect, useState } from 'react';
import { arrivalRepository } from '../../repositories/arrivalRepository';
import { calledCodes, tvLabel, type ArrivalRow } from '../../lib/pickup/arrival';
import { supabase } from '../../lib/supabase';

/** /chamada: tela cheia para TV/tablet com os códigos chamados (sem nomes). */
export const CallScreen: React.FC<{ tenantId: string; storeName: string }> = ({ tenantId, storeName }) => {
  const [rows, setRows] = useState<ArrivalRow[] | null>([]);
  const load = useCallback(() => arrivalRepository.listOpen(tenantId).then(setRows).catch(() => {}), [tenantId]);
  useEffect(() => {
    load(); const off = arrivalRepository.subscribe(tenantId, load); const id = window.setInterval(load, 5000);
    return () => { off(); window.clearInterval(id); };
  }, [tenantId, load]);
  const [showName, setShowName] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => { arrivalRepository.getStoreQr(tenantId).then(r => setShowName(Boolean(r.showNameOnTv))).catch(() => {}); }, [tenantId]);
  const codes = calledCodes(rows || []);
  const byCode = Object.fromEntries((rows || []).map(r => [r.pickup_code, r.order_id]));
  useEffect(() => {
    if (!showName || codes.length === 0) return;
    const ids = codes.map(c => byCode[c]).filter(Boolean);
    supabase.from('orders').select('id,customer_name').in('id', ids).then(({ data }) => {
      if (data) setNames(Object.fromEntries((data as any[]).map(d => [d.id, d.customer_name])));
    });
  }, [showName, codes.join(',')]);
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col p-6" data-testid="call-screen" onDoubleClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-black">{storeName}</h1>
        <span className="text-slate-400 text-sm">Toque duas vezes para tela cheia</span>
      </div>
      {rows === null ? <p className="mt-10 text-xl text-slate-400">Fila de retirada ainda não ativada nesta loja.</p> : (
        <>
          <h2 className="mt-8 text-2xl font-bold text-green-400">Pedidos prontos para retirada</h2>
          {codes.length === 0 ? <p className="mt-6 text-xl text-slate-400">Aguardando...</p> : (
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-6">
              {codes.map((c, i) => (
                <div key={c} data-testid="call-code" className={`rounded-3xl text-center font-mono font-black py-8 ${i === 0 ? 'bg-green-500 text-slate-950 animate-pulse' : 'bg-slate-800'} ${showName ? 'text-5xl' : i === 0 ? 'text-8xl' : 'text-6xl'}`}>{tvLabel(names[byCode[c]], c, showName)}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
