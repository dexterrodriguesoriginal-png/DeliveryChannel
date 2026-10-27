import React, { useMemo, useState } from 'react';
import { Loader2, Minus, Plus, Search, ShoppingBag, X } from 'lucide-react';
import type { Category, Product, SelectedProductOption } from '../../types';
import { formatBRL } from '../../lib/pricing/money';
import { ProductOptionsSelector } from '../../components/client/customer/ProductOptionsSelector';
import { validateOptionSelection } from '../../lib/addons';
import {
  addDineInCartLine, changeDineInCartLineQuantity, dineInCartLineUnitPriceCents, dineInOptionLabels, type DineInCartLine,
} from '../../lib/customer/dineInCart';

const fold = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Pedido pelo garçom: busca de produtos, filtro por categorias, foto, adicionais, carrinho e envio (submit_round com a comanda da mesa). */
export const WaiterOrderSheet: React.FC<{
  tableLabel: string;
  products: Product[];
  categories?: Category[];
  loading: boolean;
  error: string;
  sending: boolean;
  onClose: () => void;
  onSubmit: (cart: DineInCartLine[]) => void;
}> = ({ tableLabel, products, categories = [], loading, error, sending, onClose, onSubmit }) => {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string>('ALL');
  const [cart, setCart] = useState<DineInCartLine[]>([]);
  const [configuring, setConfiguring] = useState<Product | null>(null);
  const [choices, setChoices] = useState<SelectedProductOption[]>([]);
  const q = fold(query);
  const categoryList = useMemo<Array<{ id: string; name: string }>>(() => {
    const prodCatIds = new Set(products.map(p => p.categoryId).filter(Boolean));
    const explicit = categories.filter(c => c.isActive !== false && (prodCatIds.size === 0 || prodCatIds.has(c.id)));
    if (explicit.length > 0) return explicit.map(c => ({ id: c.id, name: c.name }));
    return Array.from(prodCatIds).map(id => ({ id, name: id }));
  }, [categories, products]);
  const visible = useMemo(
    () => products.filter(p => (categoryId === 'ALL' || p.categoryId === categoryId) && (!q || fold(p.name).includes(q) || fold(p.description || '').includes(q))),
    [products, categoryId, q],
  );
  const totalCents = cart.reduce((sum, line) => sum + dineInCartLineUnitPriceCents(line) * line.quantity, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const qtyOf = (id: string) => cart.filter(l => l.product.id === id).reduce((s, l) => s + l.quantity, 0);
  const add = (product: Product) => {
    if (product.optionGroups?.some(group => group.active)) { setConfiguring(product); setChoices([]); return; }
    setCart(current => addDineInCartLine(current, product));
  };
  const lastKeyOf = (id: string) => [...cart].reverse().find(l => l.product.id === id)?.key;
  const groups = configuring?.optionGroups?.filter(g => g.active) || [];
  const validation = configuring ? validateOptionSelection(groups, choices) : null;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Lançar pedido na ${tableLabel}`} data-testid="waiter-order-sheet">
      <div className="mt-8 flex min-h-0 flex-1 flex-col rounded-t-[28px] bg-white text-slate-900 shadow-2xl">
        <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
          <div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Lançar pedido</p><h2 className="text-xl font-black text-slate-900">{tableLabel}</h2></div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-700"><X className="h-5 w-5" /></button>
        </header>
        <div className="px-4 pb-2 space-y-2">
          <label className="relative block"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input aria-label="Buscar produto" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar produto" className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-base" /></label>
          {categoryList.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Categorias">
              <button
                type="button"
                aria-pressed={categoryId === 'ALL'}
                onClick={() => setCategoryId('ALL')}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${categoryId === 'ALL' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                Todas
              </button>
              {categoryList.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={categoryId === cat.id}
                  onClick={() => setCategoryId(cat.id)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition ${categoryId === cat.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {loading && <p className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Carregando cardápio…</p>}
          {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <ul className="divide-y divide-slate-100">
            {visible.map(product => {
              const qty = qtyOf(product.id);
              return (
                <li key={product.id} className="flex items-center gap-3 py-3">
                  {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-400"><ShoppingBag className="h-5 w-5" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900">{product.name}</p>
                    {product.description && <p className="line-clamp-1 text-xs text-slate-500">{product.description}</p>}
                    <p className="text-sm font-semibold text-slate-700">{formatBRL(product.price)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {qty > 0 && <button type="button" aria-label={`Remover ${product.name}`} onClick={() => { const key = lastKeyOf(product.id); if (key) setCart(c => changeDineInCartLineQuantity(c, key, -1)); }} className="grid h-11 w-11 place-items-center rounded-full bg-slate-100"><Minus className="h-4 w-4" /></button>}
                    {qty > 0 && <span className="w-5 text-center font-black">{qty}</span>}
                    <button type="button" aria-label={`Adicionar ${product.name}`} onClick={() => add(product)} className="grid h-11 w-11 place-items-center rounded-full bg-emerald-600 text-white shadow-sm"><Plus className="h-5 w-5" /></button>
                  </div>
                </li>
              );
            })}
          </ul>
          {!loading && !visible.length && <p className="py-8 text-center text-sm text-slate-500">Nenhum produto encontrado.</p>}
        </div>
        {cart.length > 0 && (
          <footer className="border-t border-slate-200 bg-white px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
            <ul className="mb-3 max-h-32 space-y-1 overflow-y-auto text-sm">
              {cart.map(line => <li key={line.key} className="flex items-start justify-between gap-2"><span className="min-w-0"><b>{line.quantity}×</b> {line.product.name}{dineInOptionLabels(line.product, line.options).map(l => <span key={l} className="block text-xs text-slate-500">{l}</span>)}</span><span className="shrink-0 font-semibold">{formatBRL(dineInCartLineUnitPriceCents(line) * line.quantity / 100)}</span></li>)}
            </ul>
            <button type="button" disabled={sending} onClick={() => onSubmit(cart)} className="flex h-14 w-full items-center justify-between rounded-2xl bg-emerald-600 px-5 text-base font-black text-white shadow-lg disabled:opacity-60">
              <span>{sending ? 'Enviando…' : 'Fazer pedido'}</span><span>{count} {count === 1 ? 'item' : 'itens'} · {formatBRL(totalCents / 100)}</span>
            </button>
          </footer>
        )}
      </div>
      {configuring && (
        <div className="absolute inset-0 z-10 flex items-end bg-slate-950/50" role="presentation">
          <section role="dialog" aria-modal="true" aria-label={`Personalizar ${configuring.name}`} className="max-h-[85vh] w-full overflow-y-auto rounded-t-[28px] bg-white text-slate-900 p-5">
            <div className="mb-3 flex items-start justify-between gap-3"><h3 className="text-lg font-black">{configuring.name}</h3><button type="button" onClick={() => setConfiguring(null)} aria-label="Fechar personalização"><X /></button></div>
            <ProductOptionsSelector groups={configuring.optionGroups || []} selections={choices} onChange={setChoices} />
            <button type="button" disabled={!validation?.valid} onClick={() => { setCart(c => addDineInCartLine(c, configuring, choices)); setConfiguring(null); setChoices([]); }} className="mt-4 h-14 w-full rounded-2xl bg-emerald-600 text-base font-black text-white disabled:opacity-50">Adicionar</button>
          </section>
        </div>
      )}
    </div>
  );
};
