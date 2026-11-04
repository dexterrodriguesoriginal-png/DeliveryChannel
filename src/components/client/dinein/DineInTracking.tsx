import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, X } from 'lucide-react';
import { dineInStatus, elapsedMinutes, queuePositionLabel, trackingSteps, type DineInTrackedRound } from '../../../lib/customer/dineInTracking';
import { canDisputeDelivery, DELIVERY_DISPUTE_WINDOW_MS, deliveryNoticeLabel, type DeliveryState } from '../../../lib/customer/deliveryDispute';
import { statusColorStyle, statusColorTokens } from '../../../lib/orders/statusColors';

const timeLabel = (at?: string | null) => at && Number.isFinite(Date.parse(at))
  ? new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Aguardando';

/** Codes come only from the approved account's get_my_tab projection. */
export const DineInDeliveryCode: React.FC<{
  round: DineInTrackedRound & DeliveryState;
  testId?: string;
}> = ({ round, testId }) => {
  if (!round.deliveryCode || ['DELIVERED', 'CANCELLED'].includes(round.status)) return null;
  return <div data-testid={testId} className="mt-2 rounded-xl border-2 border-emerald-700 bg-emerald-50 px-4 py-3 text-emerald-950">
    <p className="text-base font-bold">Seu código de entrega: <b className="font-mono text-2xl tracking-widest">{round.deliveryCode}</b> - informe ao garçom</p>
    <p className="mt-1 text-xs font-semibold">Pedido #{round.orderNumber || round.roundNo} · Rodada {round.roundNo} · Informe ao receber este pedido.</p>
  </div>;
};

export const DineInDeliveryNotice: React.FC<{
  round: DineInTrackedRound & DeliveryState;
  busy?: boolean;
  onDispute: (orderId: string) => void;
}> = ({ round, busy = false, onDispute }) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (round.status !== 'DELIVERED' || !round.deliveredAt || round.deliveryDispute) return;
    const left = Date.parse(round.deliveredAt) + DELIVERY_DISPUTE_WINDOW_MS - Date.now();
    if (!Number.isFinite(left) || left <= 0) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), left);
    return () => window.clearTimeout(timeout);
  }, [round.status, round.deliveredAt, round.deliveryDispute]);
  const needsAttention = round.deliveryDispute?.status === 'OPEN' || (round.deliveryDispute?.status === 'RESENT' && round.status !== 'DELIVERED');
  const allowed = canDisputeDelivery(round, now);
  return <section aria-label={`Entrega do pedido ${round.orderNumber || round.roundNo}`} data-testid={`delivery-notice-${round.orderId}`} className="mt-4 rounded-xl border p-4" style={statusColorStyle(needsAttention ? 'PREPARING' : 'DELIVERED')}>
    <p role="status" className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" />{deliveryNoticeLabel(round, now)}</p>
    <p className="mt-1 text-sm">Pedido #{round.orderNumber || round.roundNo}{round.deliveredAt && <> · <time dateTime={round.deliveredAt}>{timeLabel(round.deliveredAt)}</time></>}</p>
    {round.deliveryDispute?.status === 'OPEN' && <p className="mt-2 text-sm">Avisamos a equipe. O garçom vai conferir a entrega com você.</p>}
    {allowed && <>
      <p className="mt-2 text-sm">Se ainda não recebeu, avise em até 5 minutos após a entrega.</p>
      <button type="button" onClick={() => onDispute(round.orderId)} disabled={busy} className="mt-3 rounded-lg border border-current bg-white px-4 py-2 text-sm font-bold disabled:opacity-50">{busy ? 'Avisando a equipe…' : 'Não recebi'}</button>
    </>}
  </section>;
};

export const DineInTracking: React.FC<{ rounds: Array<DineInTrackedRound & DeliveryState> }> = ({ rounds }) => {
  const [open, setOpen] = useState(false);
  if (!rounds.length) return null;
  const current = rounds.find(round => !['DELIVERED', 'CANCELLED'].includes(round.status));
  const status = current ? dineInStatus(current.status) : null;
  const currentColors = current ? statusColorTokens(current.status) : null;
  const codeRounds = rounds.filter(round => round.deliveryCode && !['DELIVERED', 'CANCELLED'].includes(round.status));
  return <>
    {current && status && currentColors && <button type="button" data-testid="dinein-track-order" onClick={() => setOpen(true)} className="fixed bottom-24 right-4 z-30 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-2xl border px-4 py-3 text-left shadow-lg" style={statusColorStyle(currentColors)}>
      <Clock3 className="h-5 w-5 shrink-0" />
      <span><b className="block text-sm">Acompanhar pedido</b><span aria-live="polite" className="block text-xs">{status.label}{queuePositionLabel(current.queuePosition) ? ` · ${queuePositionLabel(current.queuePosition)}` : ''}</span>
        {codeRounds.map(round => <span key={round.orderId} className="mt-1 block text-sm font-bold">Seu código de entrega: <b className="font-mono text-lg">{round.deliveryCode}</b> - informe ao garçom{codeRounds.length > 1 ? ` · Rodada ${round.roundNo}` : ''}</span>)}
      </span>
    </button>}
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label="Acompanhar pedido" className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-black">Acompanhar pedido</h2><button type="button" aria-label="Fechar acompanhamento" onClick={() => setOpen(false)}><X /></button></div>
        <div className="space-y-4">{rounds.map(round => {
          const state = dineInStatus(round.status);
          const colors = statusColorTokens(round.status);
          const total = elapsedMinutes(round.createdAt, round.deliveredAt);
          return <article key={round.orderId} className="rounded-2xl border p-4" style={{ borderColor: colors.border }}>
            <p className="text-sm font-extrabold">Pedido #{round.orderNumber || round.roundNo} · Rodada {round.roundNo}</p>
            <p className="mt-1 rounded-lg px-3 py-2 text-sm font-bold" style={statusColorStyle(colors)}>{state.label}</p>
            <DineInDeliveryCode round={round} testId={`round-delivery-code-${round.orderId}`} />
            {round.deliveryConfirmedWithCode && <p className="mt-2 text-xs font-bold text-emerald-800">Entrega confirmada com código</p>}
            {round.deliveryDispute && <p className="mt-2 text-sm font-semibold">{deliveryNoticeLabel(round)}</p>}
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
