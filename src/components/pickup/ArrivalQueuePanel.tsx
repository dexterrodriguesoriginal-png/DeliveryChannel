import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Megaphone, QrCode, CheckCircle2 } from 'lucide-react';
import type { Order } from '../../types';
import { arrivalRepository } from '../../repositories/arrivalRepository';
import { arrivalErrorMessage, arrivalLine, arrivalQueue, type ArrivalRow } from '../../lib/pickup/arrival';
import { StoreArrivalQrModal } from './StoreArrivalQrModal';

function beep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext; if (!Ctx) return;
    const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 660; o.connect(g); g.connect(ctx.destination); g.gain.value = 0.15; o.start(); o.stop(ctx.currentTime + 0.35);
  } catch { /* sem áudio */ }
}

/**
 * Aba Retirada: clientes que chegaram (QR de chegada) fixados no topo, com posição, "Chamar" e "Confirmar retirada".
 * Some sozinho se o banco não tiver a migration 2100.
 */
export const ArrivalQueuePanel: React.FC<{
  tenantId: string; storeName: string; orders: Order[]; canRotate: boolean;
  onHandover: (order: Order) => void; onError: (msg: string) => void; onCalled?: () => void;
}> = ({ tenantId, storeName, orders, canRotate, onHandover, onError, onCalled }) => {
  const [rows, setRows] = useState<ArrivalRow[] | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, tick] = useState(0);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try { setRows(await arrivalRepository.listOpen(tenantId)); } catch { /* mantém a última lista */ }
  }, [tenantId]);
  useEffect(() => {
    load();
    const off = arrivalRepository.subscribe(tenantId, load);
    const id = window.setInterval(() => { load(); tick(t => t + 1); }, 10000);
    return () => { off(); window.clearInterval(id); };
  }, [tenantId, load]);

  const queue = arrivalQueue(rows || []).map(r => ({ ...r, order: orders.find(o => o.id === r.order_id) })).filter(r => r.order);
  useEffect(() => {
    const ids = new Set(queue.map(q => q.order_id));
    if (seen.current && [...ids].some(id => !seen.current!.has(id))) beep();
    seen.current = ids;
  }, [queue.map(q => q.order_id).join(',')]);

  if (rows === null) return null; // banco sem a fila: esconde
  const call = async (orderId: string) => {
    setBusy(orderId);
    try { await arrivalRepository.call(orderId); await load(); onCalled?.(); } catch (e) { onError(arrivalErrorMessage(e)); } finally { setBusy(null); }
  };

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50/60 p-2 space-y-1.5" data-testid="arrival-queue">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-black text-amber-950">
          <MapPin className="w-4 h-4" /> Fila de chegada
          <span className="text-[11px] px-1.5 rounded-full bg-amber-400 text-amber-950 tabular-nums" data-testid="arrival-count">{queue.length}</span>
        </div>
        <button type="button" onClick={() => setQrOpen(true)} data-testid="arrival-qr-open"
          className="flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50">
          <QrCode className="w-3.5 h-3.5" /> QR de chegada
        </button>
      </div>
      {queue.length === 0 ? (
        <p className="text-[11px] text-slate-600 pl-1">Ninguém aguardando no balcão. Quando o cliente escanear o QR de chegada, ele aparece aqui.</p>
      ) : (
        <ul className="space-y-1">
          {queue.map(q => {
            const o = q.order!; const ready = o.status === 'READY';
            return (
              <li key={q.order_id} data-testid="arrival-row" data-order-id={q.order_id}
                className={`flex flex-wrap items-center gap-2 rounded-lg border bg-white px-2 py-1.5 ${q.called_at ? 'border-green-400' : 'border-amber-300'}`}>
                <span className="w-7 h-7 rounded-full bg-amber-400 text-amber-950 font-black flex items-center justify-center text-sm" title="Posição na fila">{q.position}º</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-black text-slate-900 truncate" data-testid="arrival-line">{arrivalLine(o.customerName, q.arrived_at!)}</div>
                  <div className="text-[10.5px] text-slate-600">Pedido #{o.orderNumber} · código <b className="font-mono">{q.pickup_code}</b> · {ready ? (q.called_at ? 'chamado' : 'pronto') : 'ainda em preparo'}</div>
                </div>
                {ready && (
                  <button type="button" disabled={busy === q.order_id} onClick={() => call(q.order_id)} data-testid="arrival-call"
                    className="flex items-center gap-1 text-[11px] font-black px-2 py-1 rounded-lg bg-white border border-green-600 text-green-800 hover:bg-green-50 disabled:opacity-50">
                    <Megaphone className="w-3.5 h-3.5" /> {q.called_at ? 'Chamar de novo' : 'Chamar'}
                  </button>
                )}
                {ready && (
                  <button type="button" onClick={() => onHandover(o)} data-testid="arrival-handover"
                    className="flex items-center gap-1 text-[11px] font-black px-2 py-1 rounded-lg bg-[#15803d] text-white hover:bg-[#166534]">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar retirada
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {qrOpen && <StoreArrivalQrModal tenantId={tenantId} storeName={storeName} canRotate={canRotate} onClose={() => setQrOpen(false)} />}
    </div>
  );
};
