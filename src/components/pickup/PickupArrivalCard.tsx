import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { arrivalRepository, type MyPickupStatus } from '../../repositories/arrivalRepository';
import { arrivalErrorMessage, parseStoreToken } from '../../lib/pickup/arrival';

/** Leitor de QR pela câmera (BarcodeDetector). Sem suporte: só o campo para digitar o código da loja. */
const ArrivalScanner: React.FC<{ onToken: (t: string) => void; onClose: () => void; error: string | null }> = ({ onToken, onClose, error }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [typed, setTyped] = useState('');
  const [camOk, setCamOk] = useState(false);
  useEffect(() => {
    const BD = (window as any).BarcodeDetector;
    if (!BD || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null; let stop = false;
    const det = new BD({ formats: ['qr_code'] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async s => {
      stream = s; if (!video.current) return; video.current.srcObject = s; await video.current.play(); setCamOk(true);
      const loop = async () => {
        if (stop || !video.current) return;
        try { const r = await det.detect(video.current); const t = r?.[0] && parseStoreToken(r[0].rawValue); if (t) { onToken(t); return; } } catch { /* frame */ }
        window.setTimeout(loop, 300);
      };
      loop();
    }).catch(() => setCamOk(false));
    return () => { stop = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [onToken]);
  return (
    <div className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-3" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-white rounded-3xl p-4 space-y-3" data-testid="arrival-scanner">
        <h3 className="text-base font-black text-gray-900">Escaneie o QR Code de chegada no balcão</h3>
        <video ref={video} playsInline muted className={`w-full rounded-2xl bg-black aspect-square object-cover ${camOk ? '' : 'hidden'}`} />
        {!camOk && <p className="text-xs text-gray-500">Câmera indisponível neste aparelho. Digite o código impresso abaixo do QR.</p>}
        <form onSubmit={e => { e.preventDefault(); const t = parseStoreToken(typed); if (t) onToken(t); }} className="flex gap-2">
          <input value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} maxLength={7} placeholder="Código da loja (6 letras/números)"
            data-testid="arrival-typed" className="flex-1 border-2 border-gray-300 rounded-xl px-3 py-2 font-mono font-bold uppercase" />
          <button type="submit" disabled={!parseStoreToken(typed)} className="px-3 rounded-xl bg-emerald-700 text-white font-bold disabled:opacity-50" data-testid="arrival-typed-submit">OK</button>
        </form>
        {error && <p className="text-xs font-bold text-red-700" data-testid="arrival-error">{error}</p>}
        <button type="button" onClick={onClose} className="w-full py-2 rounded-xl border border-gray-300 text-sm font-bold text-gray-700">Fechar</button>
      </div>
    </div>
  );
};

/** Pedido de retirada ativo: "Cheguei na loja", posição na fila, aviso de chamado e código para o balcão. */
export const PickupArrivalCard: React.FC<{ orderId: string; status: string; fulfillmentType?: string }> = ({ orderId, status, fulfillmentType }) => {
  const active = fulfillmentType === 'PICKUP' && status !== 'DELIVERED' && status !== 'CANCELLED';
  const [st, setSt] = useState<MyPickupStatus | null>(null);
  const [scan, setScan] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const called = useRef<string | null>(null);
  const load = useCallback(() => arrivalRepository.myStatus(orderId).then(setSt).catch(() => {}), [orderId]);
  useEffect(() => {
    if (!active) return;
    load();
    const off = arrivalRepository.subscribeOrder(orderId, load);
    const id = window.setInterval(load, 8000);
    return () => { off(); window.clearInterval(id); };
  }, [active, orderId, load]);
  useEffect(() => {
    if (!st?.calledAt || called.current === st.calledAt) return;
    const first = called.current === null && !st.arrivedAt; called.current = st.calledAt;
    if (first) return;
    try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* */ }
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(`Seu pedido ${st.code} está pronto`, { body: 'Retire no balcão.' }); } catch { /* */ }
  }, [st?.calledAt]);
  const onToken = useCallback(async (t: string) => {
    setErr(null);
    try {
      const r = await arrivalRepository.checkIn(t, orderId); setSt(r); setScan(false);
      try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* */ }
    } catch (e) { setErr(arrivalErrorMessage(e)); }
  }, [orderId]);
  if (!active || !st || st.closed) return null;
  const isCalled = Boolean(st.calledAt);
  return (
    <div className={`rounded-2xl border-2 p-3 space-y-2 ${isCalled ? 'border-green-600 bg-green-50' : 'border-amber-400 bg-amber-50'}`} data-testid="pickup-arrival-card">
      {isCalled ? (
        <div className="text-center text-lg font-black text-green-900" data-testid="pickup-called">Seu pedido {st.code} está pronto! Retire no balcão.</div>
      ) : st.arrivedAt ? (
        <div className="text-center" data-testid="pickup-position">
          <div className="text-[11px] font-bold uppercase text-amber-900">Você está na fila de retirada</div>
          <div className="text-3xl font-black text-amber-950">{st.position ?? '-'}º</div>
          <p className="text-[11px] text-amber-900">Vamos te avisar aqui quando o pedido estiver pronto.</p>
        </div>
      ) : (
        <button type="button" onClick={() => setScan(true)} data-testid="pickup-checkin"
          className="w-full py-3 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-base">📍 Cheguei na loja</button>
      )}
      <div className="flex items-center gap-3 bg-white rounded-xl p-2 border border-gray-200">
        <QRCodeSVG value={st.code} size={64} />
        <div>
          <div className="text-[10px] font-bold uppercase text-gray-500">Código de retirada</div>
          <div className="font-mono text-3xl font-black tracking-[0.3em] text-gray-900" data-testid="pickup-code">{st.code}</div>
          <div className="text-[10px] text-gray-500">Mostre no balcão para retirar.</div>
        </div>
      </div>
      {scan && <ArrivalScanner onToken={onToken} onClose={() => setScan(false)} error={err} />}
    </div>
  );
};
