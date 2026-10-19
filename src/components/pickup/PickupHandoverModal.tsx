import React, { useState } from 'react';
import { arrivalRepository } from '../../repositories/arrivalRepository';
import { arrivalErrorMessage } from '../../lib/pickup/arrival';

/** Entrega no balcão: confere o código do cliente (ou conclui com motivo, auditado). */
export const PickupHandoverModal: React.FC<{
  order: { id: string; orderNumber: number; customerName?: string } | null;
  onClose: () => void;
  onDone: () => void;
  onOverride: (orderId: string, reason: string) => Promise<void>;
}> = ({ order, onClose, onDone, onOverride }) => {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);
  const [reason, setReason] = useState('');
  if (!order) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      if (overrideMode) {
        if (!reason.trim()) { setMsg('Informe o motivo.'); return; }
        await onOverride(order.id, `Retirada sem código: ${reason.trim()}`);
        onDone(); return;
      }
      const r = await arrivalRepository.confirmHandover(order.id, code);
      if (r.success) { onDone(); return; }
      setMsg(`Código incorreto. Restam ${r.attemptsLeft ?? 0} tentativas.`);
    } catch (err) { setMsg(arrivalErrorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} data-testid="handover-modal"
        className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-4 space-y-3">
        <h3 className="text-base font-black text-slate-900">Confirmar retirada #{order.orderNumber}</h3>
        {!overrideMode ? (
          <>
            <p className="text-xs text-slate-600">Peça ao cliente o código de retirada que aparece no app dele{order.customerName ? ` (${order.customerName})` : ''}.</p>
            <input autoFocus inputMode="numeric" maxLength={4} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              data-testid="handover-code" placeholder="Ex.: 568"
              className="w-full text-center font-mono text-3xl font-black tracking-[0.4em] border-2 border-slate-300 rounded-xl py-2 focus:border-emerald-600 outline-none" />
          </>
        ) : (
          <textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} data-testid="handover-reason" rows={3}
            placeholder="Motivo (ex.: cliente sem celular, conferido pelo documento)" className="w-full text-sm border-2 border-slate-300 rounded-xl p-2" />
        )}
        {msg && <p className="text-xs font-bold text-red-700" data-testid="handover-msg">{msg}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-xl border border-slate-300 text-sm font-bold text-slate-700">Voltar</button>
          <button type="submit" disabled={busy || (!overrideMode && code.length < 3)} data-testid="handover-submit"
            className="flex-1 py-2 rounded-xl bg-[#15803d] hover:bg-[#166534] text-white text-sm font-black disabled:opacity-50">Confirmar retirada</button>
        </div>
        <button type="button" onClick={() => { setOverrideMode(m => !m); setMsg(null); }} className="w-full text-[11px] text-slate-500 underline">
          {overrideMode ? 'Voltar para o código' : 'Cliente sem o código? Concluir informando o motivo'}
        </button>
      </form>
    </div>
  );
};
