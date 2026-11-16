import React, { useState } from 'react';
import type { Product, PromotionCarousel } from '../../types';
import { promotionRepository } from '../../repositories/promotionRepository';
import { Button } from '../ui/Button';

/** A separate SKU is created atomically with its carousel item and optional kit recipe. */
export function CarouselProductCreator({ tenantId, carouselId, products, onSaved }: {
  tenantId: string; carouselId: string; products: Product[]; onSaved: (carousel: PromotionCarousel) => void;
}) {
  const [form, setForm] = useState({ name: '', description: '', imageUrl: '', price: '', originalPrice: '', startDate: '', endDate: '', stock: '1' });
  const [components, setComponents] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const field = (key: keyof typeof form, label: string, type = 'text', required = true) => (
    <label className="block text-xs space-y-1" key={key}>
      <span>{label}</span>
      <input className="w-full rounded-lg border p-2" style={{ background: 'var(--dc-bg-card)', color: 'var(--dc-text-main)', borderColor: 'var(--dc-border)' }}
        type={type} required={required} min={type === 'number' ? (key === 'stock' ? '1' : '0.01') : undefined}
        step={type === 'number' ? (key === 'stock' ? '1' : 'any') : undefined}
        value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );
  return <form className="space-y-3" onSubmit={async e => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const carousel = await promotionRepository.createPromotionalProduct(tenantId, carouselId, {
        ...form, price: Number(form.price), originalPrice: form.originalPrice ? Number(form.originalPrice) : undefined,
        stock: Number(form.stock), startDate: form.startDate ? new Date(form.startDate).toISOString() : undefined,
        endDate: new Date(form.endDate).toISOString(),
      }, Object.entries(components).filter(([, qty]) => qty > 0).map(([productId, quantity]) => ({ productId, quantity })));
      onSaved(carousel);
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar produto.'); }
    finally { setSaving(false); }
  }}>
    <p className="text-xs">Este produto aparece somente neste carrossel e pode ser comprado na sacola normal.</p>
    {field('imageUrl', 'Foto (URL)', 'url')}
    {form.imageUrl && <img src={form.imageUrl} alt="Prévia da foto" className="w-20 h-20 object-cover rounded-lg" />}
    {field('name', 'Nome')}{field('description', 'Descrição', 'text', false)}
    <div className="grid grid-cols-2 gap-3">{field('price', 'Preço promocional', 'number')}{field('originalPrice', 'Preço de (opcional)', 'number', false)}</div>
    <div className="grid grid-cols-2 gap-3">{field('startDate', 'Início (opcional)', 'datetime-local', false)}{field('endDate', 'Válido até', 'datetime-local')}</div>
    {field('stock', 'Estoque de unidades ou kits', 'number')}
    <details><summary className="text-xs cursor-pointer">Montar combo ou kit com produtos do catálogo</summary>
      <div className="max-h-48 overflow-auto space-y-2 mt-2">{products.map(p => <label key={p.id} className="flex items-center justify-between gap-2 text-xs">
        <span>{p.name}</span><input aria-label={`Quantidade de ${p.name} por kit`} type="number" min="0" max="999" step="1"
          className="border rounded p-1 w-20" style={{ background: 'var(--dc-bg-card)', color: 'var(--dc-text-main)', borderColor: 'var(--dc-border)' }} value={components[p.id] || 0}
          onChange={e => setComponents({ ...components, [p.id]: Number(e.target.value) })} />
      </label>)}</div>
    </details>
    {error && <p role="alert" className="text-xs">{error}</p>}
    <Button type="submit" style={{ background: 'var(--dc-button-bg)', color: 'var(--dc-button-text)' }} disabled={saving}>{saving ? 'Salvando...' : 'Criar produto promocional'}</Button>
  </form>;
}
