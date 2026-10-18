import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Clock, SearchX } from 'lucide-react';
import type { Category, Product } from '../../../types';
import { searchProducts } from '../../../lib/customer/search';
import { catalogUnitPrice } from '../../../lib/pricing/purchaseOrigin';
import { clearSearchHistory, defaultKV, loadSearchHistory, pushSearchHistory } from '../../../lib/customer/localStore';
import { ProductRow } from './ProductRow';
import { EmptyBlock } from './ui';

/** Aba Busca: busca dentro da loja (nome, descrição, categoria; sem acento), buscas recentes e categorias. */
export const SearchScreen: React.FC<{
  products: Product[];
  categories: Category[];
  userId: string | null;
  color: string;
  qtyOf: (productId: string) => number;
  onAdd: (p: Product) => void;
  onRemove: (p: Product) => void;
  onOpen: (p: Product) => void;
  isFavorite: (id: string) => boolean;
  onToggleFavorite: (id: string) => void;
}> = ({ products, categories, userId, color, qtyOf, onAdd, onRemove, onOpen, isFavorite, onToggleFavorite }) => {
  const kv = useMemo(() => defaultKV(), []);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [history, setHistory] = useState<string[]>(() => loadSearchHistory(kv, userId));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setHistory(loadSearchHistory(kv, userId)); }, [kv, userId]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 150);
    return () => clearTimeout(t);
  }, [term]);
  // Guarda no histórico quando o cliente para de digitar (termo com resultado).
  const results = useMemo(() => searchProducts(products.filter(p => p.isActive !== false), categories, debounced), [products, categories, debounced]);
  useEffect(() => {
    if (debounced.trim().length < 2 || results.length === 0) return;
    const t = setTimeout(() => setHistory(pushSearchHistory(kv, userId, debounced)), 1200);
    return () => clearTimeout(t);
  }, [debounced, results.length, kv, userId]);

  const usedCategories = useMemo(() => categories.filter(c => products.some(p => p.categoryId === c.id && p.isActive !== false)), [categories, products]);

  return (
    <div className="max-w-lg mx-auto" data-testid="search-screen">
      <div className="sticky top-[57px] z-20 bg-white/95 backdrop-blur-md px-4 py-3 border-b border-gray-100">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input ref={inputRef} type="search" value={term} onChange={e => setTerm(e.target.value)} placeholder="Buscar nesta loja"
            data-testid="search-input" enterKeyHint="search"
            className="w-full h-11 pl-10 pr-10 rounded-xl bg-gray-100 text-sm focus:outline-none focus:ring-2 focus:bg-white" style={{ ['--tw-ring-color' as any]: color }} />
          {term && (
            <button type="button" aria-label="Limpar" onClick={() => { setTerm(''); inputRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-5">
        {!debounced.trim() ? (
          <>
            {history.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-extrabold text-gray-900">Buscas recentes</h3>
                  <button type="button" onClick={() => { clearSearchHistory(kv, userId); setHistory([]); }} className="text-xs font-bold cursor-pointer" style={{ color }}>Limpar</button>
                </div>
                <div className="space-y-0.5">
                  {history.map(h => (
                    <button key={h} type="button" onClick={() => setTerm(h)} className="w-full flex items-center gap-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg px-1 cursor-pointer text-left">
                      <Clock className="w-4 h-4 text-gray-400" /> {h}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {usedCategories.length > 0 && (
              <section>
                <h3 className="text-sm font-extrabold text-gray-900 mb-2">Categorias</h3>
                <div className="flex flex-wrap gap-2">
                  {usedCategories.map(c => (
                    <button key={c.id} type="button" onClick={() => setTerm(c.name)} className="px-3.5 h-9 rounded-full border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer">
                      {c.name}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : results.length === 0 ? (
          <EmptyBlock testId="search-empty" icon={<SearchX className="w-7 h-7" />} title={`Nada encontrado para "${debounced.trim()}"`}
            text="Confira a ortografia ou tente outro termo, como o nome da categoria." />
        ) : (
          <section className="space-y-3" data-testid="search-results">
            <p className="text-xs text-gray-500">{results.length} {results.length === 1 ? 'resultado' : 'resultados'}</p>
            {results.map(p => {
              const c = catalogUnitPrice(p);
              return (
                <ProductRow key={p.id} product={p} price={c.unitPrice} originalPrice={c.isPromotional ? p.price : undefined} qty={qtyOf(p.id)} color={color}
                  onOpen={() => onOpen(p)} onAdd={() => onAdd(p)} onRemove={() => onRemove(p)} favorite={isFavorite(p.id)} onToggleFavorite={() => onToggleFavorite(p.id)} />
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
};
