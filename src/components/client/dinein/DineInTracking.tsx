import React, { useState } from 'react';
import { Clock3, X } from 'lucide-react';
import { dineInStatus, elapsedMinutes, queuePositionLabel, trackingSteps, type DineInTrackedRound } from '../../../lib/customer/dineInTracking';

const timeLabel = (at?: string | null) => at && Number.isFinite(Date.parse(at))
  ? new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Aguardando';

export const DineInTracking: React.FC<{ rounds: DineInTrackedRound[] }> = ({ rounds }) => {
  const [open, setOpen] = useState(false);
  if (!rounds.length) return null;
  const current = rounds.find(round => !['DELIVERED', 'CANCELLED'].includes(round.status)) || rounds[rounds.length - 1];
  const status = dineInStatus(current.status);
  return <>
    <button type="button" data-testid="dinein-track-order" onClick={() => setOpen(true)} className="fixed bottom-24 right-4 z-30 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-2xl border px-4 py-3 text-left shadow-lg" style={{ backgroundColor: status.tint, borderColor: status.color, color: status.ink }}>
      <Clock3 className="h-5 w-5 shrink-0" />
      <span><b className="block text-sm">Acompanhar pedido</b><span aria-live="polite" className="block text-xs">{status.label}{queuePositionLabel(current.queuePosition) ? ` · ${queuePositionLabel(current.queuePosition)}` : ''}</span></span>
    </button>
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label="Acompanhar pedido" className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-black">Acompanhar pedido</h2><button type="button" aria-label="Fechar acompanhamento" onClick={() => setOpen(false)}><X /></button></div>
        <div className="space-y-4">{rounds.map(round => {
          const colors = dineInStatus(round.status);
          const total = elapsedMinutes(round.createdAt, round.deliveredAt);
          return <article key={round.orderId} className="rounded-2xl border p-4" style={{ borderColor: colors.color }}>
            <p className="text-sm font-extrabold">Pedido #{round.orderNumber || round.roundNo} · Rodada {round.roundNo}</p>
            <p className="mt-1 rounded-lg px-3 py-2 text-sm font-bold" style={{ backgroundColor: colors.tint, color: colors.ink }}>{colors.label}</p>
            {queuePositionLabel(round.queuePosition) && <p className="mt-2 text-sm font-bold text-slate-700">{queuePositionLabel(round.queuePosition)}</p>}
            <ol className="mt-3 space-y-2">{trackingSteps(round).map(step => <li key={step.label} className={`flex items-center justify-between gap-3 text-sm ${step.at ? 'text-slate-800' : 'text-slate-400'}`}>
              <span>{step.label}</span><span className="text-right"><time dateTime={step.at || undefined}>{timeLabel(step.at)}</time>{step.at !== round.createdAt && elapsedMinutes(round.createdAt, step.at) && <span className="block text-[11px]">{elapsedMinutes(round.createdAt, step.at)} após o pedido</span>}</span>
            </li>)}</ol>
            {total && <p className="mt-3 border-t pt-2 text-sm font-bold text-green-700">Entregue em {total}.</p>}
          </article>;
        })}</div>
      </section>
    </div>}
  </>;
};
