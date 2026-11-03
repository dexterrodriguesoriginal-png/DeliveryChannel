import React from 'react';
import { Minus, Plus, ShoppingBag, X } from 'lucide-react';
import { formatBRL } from '../../../lib/pricing/money';
import { dineInCartLineUnitPriceCents, dineInOptionLabels, type DineInCartLine } from '../../../lib/customer/dineInCart';

export const DineInCartSheet: React.FC<{
  cart: DineInCartLine[]; busy: boolean; disabled: boolean;
  onClose: () => void; onCheckout: () => void;
  onQuantity: (key: string, delta: number) => void; onNotes: (key: string, value: string) => void;
}> = ({ cart, busy, disabled, onClose, onCheckout, onQuantity, onNotes }) => <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
  <section role="dialog" aria-modal="true" aria-label="Sua sacola" className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-3xl bg-white p-5">
    <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-xl font-black"><ShoppingBag className="h-5 w-5" />Sua sacola</h2><button type="button" onClick={onClose} aria-label="Fechar sacola"><X /></button></div>
    <div className="overflow-y-auto">{cart.length ? cart.map(line => <article key={line.key} className="border-b py-3 text-sm">
      <div className="flex items-start justify-between gap-3"><div><p className="font-bold">{line.quantity}× {line.product.name}</p>{dineInOptionLabels(line.product, line.options).map(label => <p key={label} className="text-xs text-slate-500">{label}</p>)}</div><b>{formatBRL(dineInCartLineUnitPriceCents(line) * line.quantity / 100)}</b></div>
      <div className="mt-2 flex items-center gap-3"><button type="button" onClick={() => onQuantity(line.key, -1)} disabled={busy || disabled} aria-label={`Diminuir ${line.product.name}`} className="rounded-full bg-slate-100 p-2"><Minus className="h-4 w-4" /></button><span>{line.quantity}</span><button type="button" onClick={() => onQuantity(line.key, 1)} disabled={busy || disabled} aria-label={`Aumentar ${line.product.name}`} className="rounded-full bg-slate-100 p-2"><Plus className="h-4 w-4" /></button></div>
      <input aria-label={`Observação na sacola de ${line.product.name}`} value={line.notes || ''} onChange={event => onNotes(line.key, event.target.value)} maxLength={500} placeholder="Alguma observação?" className="mt-2 w-full rounded-xl border px-3 py-2 text-xs" />
    </article>) : <p className="py-5 text-center text-sm text-slate-500">Sua sacola está vazia. Escolha os itens no cardápio.</p>}</div>
    <div className="mt-4 border-t pt-3"><p className="flex justify-between font-black"><span>Subtotal estimado</span><span>{formatBRL(cart.reduce((sum, line) => sum + dineInCartLineUnitPriceCents(line) * line.quantity, 0) / 100)}</span></p><button type="button" onClick={onClose} className="mt-3 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold">Adicionar mais itens</button><button type="button" onClick={onCheckout} disabled={!cart.length || busy || disabled} className="mt-2 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">Finalizar pedido</button></div>
  </section>
</div>;
