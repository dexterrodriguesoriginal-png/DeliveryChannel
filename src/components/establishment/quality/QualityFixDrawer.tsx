import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, Check, ImageIcon, Type, DollarSign, Layers } from 'lucide-react';
import type { Category, Product } from '../../../types';
import { ImageUploader } from '../../common/ImageUploader';
import { MIN_DESCRIPTION_CHARS, QUALITY_LABELS, QualityKey, productQuality, qualityColor } from '../../../lib/menu/menuQuality';
import { useAnimatedNumber } from '../../../lib/menu/useAnimatedNumber';
import './quality.css';

export interface QualityFixValues { imageUrl: string; description: string; price: number; categoryId: string }

/** Painel lateral: corrige foto, descrição, preço e categoria de um produto e mostra a nota subindo ao vivo. */
export const QualityFixDrawer: React.FC<{
  product: Product; categories: Category[]; tenantId: string; focus: QualityKey; saving?: boolean;
  onClose: () => void; onSave: (changes: Partial<QualityFixValues>) => void | Promise<void>;
}> = ({ product, categories, tenantId, focus, saving, onClose, onSave }) => {
  const [imageUrl, setImageUrl] = useState(product.imageUrl || '');
  const [description, setDescription] = useState(product.description || '');
  const [priceText, setPriceText] = useState(product.price > 0 ? String(product.price).replace('.', ',') : '');
  const [categoryId, setCategoryId] = useState(product.categoryId || '');
  const sections = useRef<Partial<Record<QualityKey, HTMLElement | null>>>({});

  useEffect(() => { sections.current[focus]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [focus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const price = useMemo(() => {
    const n = Number(priceText.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }, [priceText]);
  const draft: Product = { ...product, imageUrl, description, price, categoryId };
  const q = productQuality(draft, categories);
  const shown = useAnimatedNumber(q.score, 500);
  const dirty = imageUrl !== (product.imageUrl || '') || description.trim() !== (product.description || '').trim() || price !== product.price || categoryId !== (product.categoryId || '');
  const len = description.trim().length;
  const descOk = len >= MIN_DESCRIPTION_CHARS;

  const submit = () => {
    const changes: Partial<QualityFixValues> = {};
    if (imageUrl !== (product.imageUrl || '')) changes.imageUrl = imageUrl;
    if (description.trim() !== (product.description || '').trim()) changes.description = description.trim();
    if (price !== product.price) changes.price = price;
    if (categoryId !== (product.categoryId || '')) changes.categoryId = categoryId;
    void onSave(changes);
  };
  const sec = (key: QualityKey) => ({ 'data-focus': focus === key, ref: (el: HTMLElement | null) => { sections.current[key] = el; } });
  const Tag = ({ ok }: { ok: boolean }) => <span className="mq-chip" data-ok={ok} style={{ cursor: 'default' }}>{ok ? '✓ Ok' : '✗ Falta'}</span>;

  return (
    <>
      <div className="mq-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="mq-drawer" role="dialog" aria-modal="true" aria-label={`Corrigir ${product.name}`} data-testid="quality-drawer">
        <header className="flex items-start gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Qualidade do item</p>
            <h2 className="truncate text-base font-extrabold text-slate-900">{product.name}</h2>
            <div className="mt-2 flex items-center gap-3">
              <div className="mq-bar flex-1"><i style={{ width: `${shown}%`, backgroundColor: qualityColor(shown) }} /></div>
              <span data-testid="quality-drawer-score" className="text-sm font-black tabular-nums" style={{ color: qualityColor(shown) }}>{Math.round(shown)}%</span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <section className="mq-section" {...sec('photo')} data-testid="fix-photo">
            <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><ImageIcon size={15} className="text-slate-500" />Foto <span className="text-[10px] font-semibold text-slate-400">+35 pts</span></h3><Tag ok={q.checks.photo} /></div>
            <ImageUploader label="Foto do produto" description="Envie uma foto real e bem iluminada (JPG, PNG ou WEBP até 5 MB)." value={imageUrl} onChange={setImageUrl} tenantId={tenantId} entityType="products" disabled={saving} />
          </section>

          <section className="mq-section" {...sec('description')} data-testid="fix-description">
            <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Type size={15} className="text-slate-500" />Descrição <span className="text-[10px] font-semibold text-slate-400">+30 pts</span></h3><Tag ok={q.checks.description} /></div>
            <textarea aria-label="Descrição do produto" value={description} onChange={e => setDescription(e.target.value)} rows={4} maxLength={400} disabled={saving}
              placeholder="Conte do que é feito, tamanho, sabor… (mín. 20 caracteres)"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-emerald-500 focus:bg-white" />
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className={descOk ? 'font-semibold text-emerald-700' : 'text-orange-700'} data-testid="desc-counter-hint">{descOk ? 'Ótima descrição!' : `Faltam ${MIN_DESCRIPTION_CHARS - len} caracteres`}</span>
              <span data-testid="desc-counter" className="tabular-nums text-slate-400">{len}/400</span>
            </div>
          </section>

          <section className="mq-section" {...sec('price')} data-testid="fix-price">
            <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><DollarSign size={15} className="text-slate-500" />Preço <span className="text-[10px] font-semibold text-slate-400">+25 pts</span></h3><Tag ok={q.checks.price} /></div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-emerald-500 focus-within:bg-white">
              <span className="text-sm font-bold text-slate-500">R$</span>
              <input aria-label="Preço do produto" inputMode="decimal" value={priceText} onChange={e => setPriceText(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0,00" disabled={saving}
                className="h-11 w-full bg-transparent text-base font-bold tabular-nums outline-none" />
            </div>
            {!q.checks.price && priceText !== '' && <p className="mt-1 text-[11px] text-orange-700">O preço precisa ser maior que zero.</p>}
          </section>

          <section className="mq-section" {...sec('category')} data-testid="fix-category">
            <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Layers size={15} className="text-slate-500" />Categoria <span className="text-[10px] font-semibold text-slate-400">+10 pts</span></h3><Tag ok={q.checks.category} /></div>
            <select aria-label="Categoria do produto" value={categoryId} onChange={e => setCategoryId(e.target.value)} disabled={saving}
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-500 focus:bg-white">
              <option value="">Escolha uma categoria…</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button type="button" data-testid="quality-save" disabled={!dirty || saving} onClick={submit}
            className="inline-flex items-center gap-2 rounded-xl bg-[#15803d] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#166534] disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}Salvar correções
          </button>
        </footer>
      </aside>
    </>
  );
};
