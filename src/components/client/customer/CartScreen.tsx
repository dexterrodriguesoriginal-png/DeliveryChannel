import React, { useState } from 'react';
import { Bike, MapPin, MessageSquare, Minus, Plus, ShoppingBag, Store, Trash2, Ticket } from 'lucide-react';
import type { Product } from '../../../types';
import { formatBRL } from '../../../lib/pricing/money';
import { EmptyBlock, PrimaryButton } from './ui';
import { cn } from '../../../utils/cn';

export interface CartScreenLine {
  key: string;
  product: Product;
  quantity: number;
  notes?: string;
  unitPrice: number;
  isCampaign: boolean;
}

/** Aba Sacola: revisar itens antes do checkout (quantidade, remover, observações, subtotal, entrega e total). */
export const CartScreen: React.FC<{
  storeName: string;
  lines: CartScreenLine[];
  color: string;
  subtotal: number;
  deliveryFee: number;
  pickupDiscount: number;
  couponDiscount: number;
  couponCode?: string;
  total: number;
  minOrderValue: number;
  modes: Array<'DELIVERY' | 'PICKUP'>;
  mode: 'DELIVERY' | 'PICKUP';
  onModeChange: (m: 'DELIVERY' | 'PICKUP') => void;
  addressLine?: string;
  onChangeAddress: () => void;
  orderNotes: string;
  onOrderNotes: (v: string) => void;
  onInc: (key: string) => void;
  onDec: (key: string) => void;
  onRemoveLine: (key: string) => void;
  onLineNote: (key: string, note: string) => void;
  onContinue: () => void;
  onKeepShopping: () => void;
}> = (p) => {
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  if (p.lines.length === 0) {
    return (
      <div className="max-w-lg mx-auto p-4" data-testid="cart-screen">
        <EmptyBlock testId="cart-empty" icon={<ShoppingBag className="w-7 h-7" />} title="Sua sacola está vazia" text="Adicione produtos do cardápio para fazer seu pedido."
          action={<div className="pt-2 max-w-xs mx-auto"><PrimaryButton color={p.color} onClick={p.onKeepShopping}>Ver cardápio</PrimaryButton></div>} />
      </div>
    );
  }
  const belowMin = p.minOrderValue > 0 && p.subtotal < p.minOrderValue;
  const storeShare = p.mode === 'DELIVERY' ? Math.max(0, 7 - p.deliveryFee) : 0;
  const count = p.lines.reduce((a, l) => a + l.quantity, 0);
  return (
    <div className="max-w-lg mx-auto pb-40" data-testid="cart-screen">
      <div className="px-4 pt-4 pb-2 flex items-end justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Sacola</p>
          <h2 className="text-lg font-extrabold text-gray-900">{p.storeName}</h2>
        </div>
        <button type="button" onClick={p.onKeepShopping} className="text-sm font-bold cursor-pointer" style={{ color: p.color }}>Adicionar mais itens</button>
      </div>

      {p.modes.length > 1 && (
        <div className="px-4 py-2">
          <div className="grid grid-cols-2 p-1 bg-gray-100 rounded-xl" data-testid="cart-mode">
            {p.modes.map(m => (
              <button key={m} type="button" onClick={() => p.onModeChange(m)}
                className={cn('h-9 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all', p.mode === m ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500')}>
                {m === 'DELIVERY' ? <Bike className="w-4 h-4" /> : <Store className="w-4 h-4" />}{m === 'DELIVERY' ? 'Entrega' : 'Retirada'}
              </button>
            ))}
          </div>
        </div>
      )}

      {p.mode === 'DELIVERY' && (
        <button type="button" onClick={p.onChangeAddress} data-testid="cart-address" className="mx-4 my-2 w-[calc(100%-2rem)] p-3 rounded-xl border border-gray-200 bg-white flex items-center gap-3 text-left cursor-pointer hover:bg-gray-50">
          <MapPin className="w-5 h-5 shrink-0" style={{ color: p.color }} />
          <span className="flex-1 min-w-0">
            <span className="block text-[11px] text-gray-500">Entregar em</span>
            <span className="block text-sm font-bold text-gray-900 truncate">{p.addressLine || 'Escolha o endereço de entrega'}</span>
          </span>
          <span className="text-xs font-bold shrink-0" style={{ color: p.color }}>{p.addressLine ? 'Trocar' : 'Escolher'}</span>
        </button>
      )}

      <div className="mt-2 bg-white border-y border-gray-100 divide-y divide-gray-100">
        {p.lines.map(l => (
          <div key={l.key} className="px-4 py-3" data-testid="cart-screen-line">
            <div className="flex items-start gap-3">
              <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 shrink-0">
                {l.product.imageUrl ? <img src={l.product.imageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><ShoppingBag className="w-5 h-5" /></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 leading-snug line-clamp-2">{l.product.name}</p>
                {l.isCampaign && <span className="inline-block mt-0.5 text-[10px] font-bold uppercase text-amber-800 bg-amber-50 border border-amber-200 px-1.5 rounded">Oferta</span>}
                <p className="text-sm font-extrabold text-gray-900 mt-1">{formatBRL(l.unitPrice * l.quantity)}</p>
                {l.notes && noteOpen !== l.key && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">Obs.: {l.notes}</p>}
                <button type="button" onClick={() => setNoteOpen(noteOpen === l.key ? null : l.key)} className="mt-1 text-xs font-semibold flex items-center gap-1 cursor-pointer" style={{ color: p.color }}>
                  <MessageSquare className="w-3.5 h-3.5" />{l.notes ? 'Editar observação' : 'Adicionar observação'}
                </button>
              </div>
              <div className="flex items-center gap-1 border border-gray-200 rounded-xl p-0.5 shrink-0">
                <button type="button" aria-label={l.quantity === 1 ? 'Remover item' : 'Diminuir'} onClick={() => (l.quantity === 1 ? p.onRemoveLine(l.key) : p.onDec(l.key))}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer" style={{ color: p.color }} data-testid="cart-dec">
                  {l.quantity === 1 ? <Trash2 className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                </button>
                <span className="w-6 text-center text-sm font-black" data-testid="cart-qty">{l.quantity}</span>
                <button type="button" aria-label="Aumentar" onClick={() => p.onInc(l.key)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer" style={{ color: p.color }} data-testid="cart-inc">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            {noteOpen === l.key && (
              <div className="mt-2 pl-[68px]">
                <textarea defaultValue={l.notes || ''} maxLength={140} rows={2} autoFocus placeholder="Ex.: sem cebola, bem gelada…"
                  onBlur={e => { p.onLineNote(l.key, e.target.value.trim()); setNoteOpen(null); }}
                  className="w-full p-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 py-4 space-y-2">
        <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Observações do pedido</label>
        <textarea value={p.orderNotes} onChange={e => p.onOrderNotes(e.target.value)} rows={2} maxLength={300} data-testid="cart-order-notes"
          placeholder="Ex.: não tocar a campainha" className="w-full p-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2" />
      </div>

      <div className="mx-4 p-4 rounded-2xl bg-white border border-gray-100 space-y-2 text-sm" data-testid="cart-summary">
        <h3 className="font-extrabold text-gray-900 mb-1">Resumo de valores</h3>
        <div className="flex justify-between text-gray-600"><span>Subtotal ({count} {count === 1 ? 'item' : 'itens'})</span><span data-testid="cart-subtotal">{formatBRL(p.subtotal)}</span></div>
        {p.pickupDiscount > 0 && <div className="flex justify-between text-emerald-700"><span>Desconto retirada</span><span>- {formatBRL(p.pickupDiscount)}</span></div>}
        {p.couponDiscount > 0 && <div className="flex justify-between text-emerald-700"><span className="flex items-center gap-1"><Ticket className="w-3.5 h-3.5" />Cupom {p.couponCode}</span><span>- {formatBRL(p.couponDiscount)}</span></div>}
        <div className="flex justify-between text-gray-600">
          <span>Taxa de entrega</span>
          <span data-testid="cart-fee" className={p.deliveryFee === 0 ? 'text-emerald-700 font-bold' : ''}>{p.mode === 'PICKUP' ? 'Retirada' : p.deliveryFee === 0 ? 'Grátis' : formatBRL(p.deliveryFee)}</span>
        </div>
        {p.mode === 'DELIVERY' && (
          <p className="text-[11px] text-gray-400 leading-snug" data-testid="cart-fee-note">
            {p.deliveryFee === 0
              ? 'A loja paga os R$ 7,00 da entrega para você.'
              : storeShare > 0
                ? `Entrega fixa de R$ 7,00: você paga ${formatBRL(p.deliveryFee)} e a loja paga ${formatBRL(storeShare)}. Sem taxa de serviço.`
                : 'Taxa fixa de entrega, sem taxa de serviço.'}
          </p>
        )}
        <div className="flex justify-between font-extrabold text-gray-900 text-base pt-2 border-t border-gray-100"><span>Total</span><span data-testid="cart-total">{formatBRL(p.total)}</span></div>
        {belowMin && <p className="text-xs text-amber-700 font-semibold" data-testid="cart-min">Pedido mínimo da loja: {formatBRL(p.minOrderValue)}. Faltam {formatBRL(p.minOrderValue - p.subtotal)}.</p>}
      </div>

      <div className="fixed bottom-[64px] inset-x-0 z-30 pointer-events-none">
        <div className="max-w-lg mx-auto px-4 pb-3 pointer-events-auto">
          <PrimaryButton color={p.color} onClick={p.onContinue} disabled={belowMin} data-testid="cart-continue" className="shadow-xl">
            <span className="flex-1 text-left pl-2">Continuar</span>
            <span className="pr-2">{formatBRL(p.total)}</span>
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
};
