import React, { useEffect, useId, useRef } from 'react';
import { Plus, Sparkles, X } from 'lucide-react';
import { productToPricingLine } from '../../../lib/pricing/fulfillmentPricing';
import { formatBRL } from '../../../lib/pricing/money';
import type { Product } from '../../../types';
import type { UpsellOffer } from '../../../types/upsell';

export interface UpsellSheetProps {
  offer: UpsellOffer | null;
  title?: string;
  busy?: boolean;
  error?: string;
  onAccept(product: Product): void | Promise<void>;
  onClose(): void;
}

/** Small, optional complement sheet; adding still uses the caller's existing cart/options flow. */
export function UpsellSheet({ offer, title = 'Leve também', busy = false, error, onAccept, onClose }: UpsellSheetProps) {
  const id = useId(), closeRef = useRef<HTMLButtonElement>(null), panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!offer) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const nodes = panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, [offer?.offerToken, busy, onClose]);
  if (!offer?.suggestions.length) return null;
  return <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-950/40 p-3 backdrop-blur-[2px] sm:items-center" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={id} aria-describedby={`${id}-hint`} className="w-full max-w-xl overflow-hidden rounded-3xl border border-white/80 bg-white text-slate-950 shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:px-6">
        <div><span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-emerald-800"><Sparkles size={13} aria-hidden="true" /> Uma boa combinação</span><h2 id={id} className="text-xl font-black tracking-tight">{title}</h2><p id={`${id}-hint`} className="mt-1 text-sm text-slate-500">Um toque para completar seu pedido. Você escolhe.</p></div>
        <button ref={closeRef} type="button" disabled={busy} onClick={onClose} aria-label="Fechar sugestões" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40"><X size={19} /></button>
      </header>
      <div className="max-h-[55dvh] space-y-3 overflow-y-auto p-4 sm:px-6">
        {offer.suggestions.slice(0, 3).map(({ product }) => <article key={product.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
          {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" /> : <span className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800"><Sparkles size={24} aria-hidden="true" /></span>}
          <div className="min-w-0 flex-1"><h3 className="text-sm font-extrabold leading-snug">{product.name}</h3><p className="mt-1 font-black text-emerald-800">{formatBRL(productToPricingLine(product, 1).unitPrice)}</p>{product.optionGroups?.some(group => group.active) && <p className="mt-1 text-xs text-slate-500">Personalize antes de adicionar</p>}</div>
          <button type="button" disabled={busy} aria-label={`Levar ${product.name}`} onClick={() => void onAccept(product)} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-3 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-40"><Plus size={17} aria-hidden="true" /><span className="hidden sm:inline">Levar</span></button>
        </article>)}
        {error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      </div>
      <footer className="border-t border-slate-100 px-5 py-3"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 w-full rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40">{title === 'Que tal completar?' ? 'Continuar para o pedido' : 'Agora não, continuar escolhendo'}</button></footer>
    </section>
  </div>;
}
