import React from 'react';
import { Heart, Minus, Plus, ShoppingBag } from 'lucide-react';
import type { Product } from '../../../types';
import { formatBRL } from '../../../lib/pricing/money';
import { discountPercent } from '../../../lib/customer/offers';

/** Card de produto em lista (busca, ofertas, favoritos): nome, descrição, preço (riscado quando há oferta), foto e +/-. */
export const ProductRow: React.FC<{
  product: Product;
  price: number;
  originalPrice?: number;
  badge?: string;
  qty: number;
  color: string;
  onOpen?: () => void;
  onAdd: () => void;
  onRemove: () => void;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  testId?: string;
}> = ({ product: p, price, originalPrice, badge, qty, color, onOpen, onAdd, onRemove, favorite, onToggleFavorite, testId }) => {
  const out = p.isAvailable !== undefined ? !p.isAvailable : (p.stockQuantity ?? 1) <= 0;
  const pct = originalPrice ? discountPercent(originalPrice, price) : 0;
  return (
    <div data-testid={testId || 'product-row'} onClick={onOpen}
      className={`p-3.5 bg-white rounded-2xl border border-gray-100 shadow-xs flex items-stretch gap-3 cursor-pointer active:bg-gray-50 transition-colors ${out ? 'opacity-60' : ''}`}>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-start gap-1.5">
          <h3 className="font-bold text-sm text-gray-900 leading-snug line-clamp-2 flex-1">{p.name}</h3>
          {onToggleFavorite && (
            <button type="button" aria-label={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} onClick={e => { e.stopPropagation(); onToggleFavorite(); }}
              className="w-7 h-7 -mt-1 -mr-1 rounded-full flex items-center justify-center hover:bg-gray-100 cursor-pointer shrink-0">
              <Heart className={`w-4 h-4 ${favorite ? 'fill-rose-500 text-rose-500' : 'text-gray-400'}`} />
            </button>
          )}
        </div>
        {p.description && <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{p.description}</p>}
        {badge && <span className="mt-1 self-start text-[10px] font-bold uppercase text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">{badge}</span>}
        <div className="mt-auto pt-2 flex items-baseline gap-2 flex-wrap">
          <span className={`font-extrabold text-sm ${pct > 0 ? 'text-emerald-700' : 'text-gray-900'}`} data-testid="price">{formatBRL(price)}</span>
          {pct > 0 && originalPrice && <span className="text-xs text-gray-400 line-through" data-testid="price-original">{formatBRL(originalPrice)}</span>}
        </div>
      </div>
      <div className="relative shrink-0 w-24 flex flex-col items-center gap-2">
        <div className="relative w-24 h-24 rounded-xl overflow-hidden bg-gray-100 border border-gray-100">
          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} loading="lazy" className="w-full h-full object-cover" /> : (
            <div className="w-full h-full flex items-center justify-center text-gray-300"><ShoppingBag className="w-8 h-8" /></div>
          )}
          {pct > 0 && <span data-testid="discount-badge" className="absolute top-1 left-1 bg-rose-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">-{pct}%</span>}
          {out && <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] font-bold text-center py-0.5">Esgotado</span>}
        </div>
        {!out && (qty > 0 ? (
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-0.5 shadow-xs" onClick={e => e.stopPropagation()}>
            <button type="button" aria-label="Diminuir" onClick={onRemove} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer" style={{ color }}>
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-black w-5 text-center" data-testid="qty">{qty}</span>
            <button type="button" aria-label="Aumentar" onClick={onAdd} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer" style={{ color }}>
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={e => { e.stopPropagation(); onAdd(); }} data-testid="add-btn"
            className="h-8 px-3 rounded-xl text-white text-xs font-bold flex items-center gap-1 shadow-xs cursor-pointer" style={{ backgroundColor: color }}>
            <Plus className="w-3.5 h-3.5" /> Adicionar
          </button>
        ))}
      </div>
    </div>
  );
};
