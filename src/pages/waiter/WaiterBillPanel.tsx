import React, { useEffect, useState } from 'react';
import { Check, Receipt } from 'lucide-react';
import { formatBRL } from '../../lib/pricing/money';
import { TabPixPanel } from '../../components/establishment/salon/TabPixPanel';

/** Manual payments require an explicit receipt confirmation. Pix only completes on the server. */
export const WaiterBillPanel: React.FC<{
  tabId: string;
  status: string;
  totalCents: number;
  tableLabel?: string;
  busy: boolean;
  onManualConfirm: (method: 'CASH' | 'CREDIT_CARD') => void;
  onSettled: () => void;
}> = ({ tabId, status, totalCents, tableLabel, busy, onManualConfirm, onSettled }) => {
  const [method, setMethod] = useState<'' | 'CASH' | 'CREDIT_CARD' | 'PIX'>(status === 'AWAITING_PAYMENT' ? 'PIX' : '');
  const [received, setReceived] = useState(false);
  const [pixLive, setPixLive] = useState(status === 'AWAITING_PAYMENT');
  useEffect(() => { if (status === 'AWAITING_PAYMENT') setMethod('PIX'); }, [status]);
  return (
    <section className="space-y-3 rounded-2xl border border-[#8B5E3C] bg-[#F3E9DF] p-4" aria-label="Cobrar conta autorizada">
      <h3 className="flex items-center gap-2 font-black text-[#8B5E3C]"><Receipt className="h-5 w-5" />{status === 'AWAITING_PAYMENT' ? 'Aguardando pagamento' : 'Fechamento autorizado pelo caixa'}</h3>
      <p className="text-sm text-slate-700">Total da conta: <strong>{formatBRL(totalCents / 100)}</strong></p>
      <label className="block text-sm font-bold text-slate-800">Forma de pagamento
        <select aria-label="Forma de pagamento da conta" value={method} disabled={busy || pixLive || status === 'AWAITING_PAYMENT'} onChange={e => { setMethod(e.target.value as typeof method); setReceived(false); }} className="mt-1 h-12 w-full rounded-xl border border-slate-300 bg-white px-3">
          <option value="">Escolha a forma de pagamento</option><option value="CASH">Dinheiro</option><option value="CREDIT_CARD">Cartão</option><option value="PIX">Pix</option>
        </select>
      </label>
      {method === 'PIX' && <TabPixPanel tabId={tabId} tableLabel={tableLabel} totalCents={totalCents} onLiveChange={setPixLive} onSettled={onSettled} />}
      {(method === 'CASH' || method === 'CREDIT_CARD') && <>
        <label className="flex items-start gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" checked={received} disabled={busy || pixLive} onChange={e => setReceived(e.target.checked)} className="mt-0.5 h-5 w-5" />{method === 'CASH' ? 'Confirmei o recebimento do dinheiro.' : 'Confirmei o pagamento aprovado na maquininha.'}</label>
        <button type="button" disabled={busy || pixLive || !received || totalCents <= 0 || status === 'AWAITING_PAYMENT'} onClick={() => onManualConfirm(method)} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 font-black text-white disabled:opacity-50"><Check className="h-5 w-5" />Confirmar pagamento recebido</button>
      </>}
      <p className="text-xs text-slate-600">A mesa só é liberada depois da confirmação do pagamento.</p>
    </section>
  );
};
