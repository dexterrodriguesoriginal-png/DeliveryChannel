import React, { useCallback, useEffect, useState } from 'react';
import { arrivalRepository } from '../../repositories/arrivalRepository';
import { calledCodes, type ArrivalRow } from '../../lib/pickup/arrival';

/** /chamada: tela cheia para TV/tablet com os códigos chamados (sem nomes). */
export const CallScreen: React.FC<{ tenantId: string; storeName: string }> = ({ tenantId, storeName }) => {
  const [rows, setRows] = useState<ArrivalRow[] | null>([]);
  const load = useCallback(() => arrivalRepository.listOpen(tenantId).then(setRows).catch(() => {}), [tenantId]);
  useEffect(() => {
    load(); const off = arrivalRepository.subscribe(tenantId, load); const id = window.setInterval(load, 5000);
    return () => { off(); window.clearInterval(id); };
  }, [tenantId, load]);
  const codes = calledCodes(rows || []);
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
                <div key={c} data-testid="call-code" className={`rounded-3xl text-center font-mono font-black py-8 ${i === 0 ? 'bg-green-500 text-slate-950 text-8xl animate-pulse' : 'bg-slate-800 text-6xl'}`}>{c}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
