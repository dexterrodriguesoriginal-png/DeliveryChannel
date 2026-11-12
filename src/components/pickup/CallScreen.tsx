import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { arrivalRepository } from '../../repositories/arrivalRepository';
import { calledCodes, tvLabel, type ArrivalRow } from '../../lib/pickup/arrival';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { contrastRatio, themeToTokens } from '../../lib/theme/themeEngine';

/** /chamada: tela cheia para TV/tablet com os códigos chamados (sem nomes). */
export const CallScreen: React.FC<{ tenantId: string; storeName: string }> = ({ tenantId, storeName }) => {
  const { activeTenant } = useAuth();
  const palette = themeToTokens(activeTenant?.id === tenantId ? activeTenant.theme : null).palette;
  const readyTone = useMemo(() => {
    const background = palette.accent || palette.buttonBg;
    return { background, color: [palette.buttonText, palette.textMain, palette.textTitle].sort((a, b) => contrastRatio(b, background) - contrastRatio(a, background))[0] };
  }, [palette]);
  const [rows, setRows] = useState<ArrivalRow[] | null>([]);
  const [ready, setReady] = useState<string[]>([]);
  const load = useCallback(() => { void Promise.all([arrivalRepository.listOpen(tenantId), arrivalRepository.listReadyTotem(tenantId)]).then(([open, codes]) => { setRows(open); setReady(codes); }).catch(() => {}); }, [tenantId]);
  useEffect(() => {
    load(); const off = arrivalRepository.subscribe(tenantId, load); const id = window.setInterval(load, 5000);
    return () => { off(); window.clearInterval(id); };
  }, [tenantId, load]);
  const [showName, setShowName] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => { arrivalRepository.getStoreQr(tenantId).then(r => setShowName(Boolean(r.showNameOnTv))).catch(() => {}); }, [tenantId]);
  const codes = calledCodes(rows || []).filter(code => !ready.includes(code));
  const byCode = Object.fromEntries((rows || []).map(r => [r.pickup_code, r.order_id]));
  useEffect(() => {
    if (!showName || codes.length === 0) return;
    const ids = codes.map(c => byCode[c]).filter(Boolean);
    supabase.from('orders').select('id,customer_name').in('id', ids).then(({ data }) => {
      if (data) setNames(Object.fromEntries((data as any[]).map(d => [d.id, d.customer_name])));
    });
  }, [showName, codes.join(',')]);
  return (
    <div className="min-h-screen flex flex-col p-6" style={{ background: palette.bgGeneral, color: palette.textMain }} data-testid="call-screen" onDoubleClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-black">{storeName}</h1>
        <button className="rounded-xl p-3" style={{ background: palette.buttonBg, color: palette.buttonText }} onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>Tela cheia</button>
      </div>
      {rows === null ? <p className="mt-10 text-xl">Fila de retirada ainda não ativada nesta loja.</p> : (
        <>
          <h2 className="mt-8 text-2xl font-bold" style={{ color: readyTone.background }}>Prontos para retirada</h2>
          {ready.length > 0 && (
            <div data-testid="totem-ready-codes" className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-6">
              {ready.map(code => <div key={code} className="rounded-3xl text-center font-mono font-black py-8 text-8xl" style={readyTone}>{code}</div>)}
            </div>
          )}
          <h2 className="mt-8 text-2xl font-bold">Chamados pelo QR</h2>
          {codes.length === 0 ? <p className="mt-6 text-xl">Aguardando...</p> : (
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-6">
              {codes.map((c, i) => (
                <div key={c} data-testid="call-code" className={`rounded-3xl text-center font-mono font-black py-8 ${i === 0 ? 'animate-pulse' : ''} ${showName ? 'text-5xl' : i === 0 ? 'text-8xl' : 'text-6xl'}`} style={i === 0 ? readyTone : { background: palette.bgCard, color: palette.textMain }}>{tvLabel(names[byCode[c]], c, showName)}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
