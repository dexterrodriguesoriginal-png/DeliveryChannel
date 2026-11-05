import React, { useEffect, useRef, useState } from 'react';
import { Check, Plus, Sparkles, X } from 'lucide-react';
import type { Product } from '../../types';
import { upsellRepository } from '../../repositories/upsellRepository';
import { Modal } from '../ui/Modal';
import { formatBRL } from '../../lib/pricing/money';

interface Props { tenantId: string; viewerId: string; role?: string | null; source: Product; products: Product[]; onClose(): void }
export function ProductUpsellPinsEditor(props: Props) {
  if (!['OWNER', 'MANAGER'].includes(props.role || '') || props.source.tenantId !== props.tenantId) return null;
  return <ProductPinsEditor key={`${props.tenantId}:${props.viewerId}:${props.source.id}`} {...props} />;
}
function ProductPinsEditor({ tenantId, source, products, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(false), lock = useRef(false);
  const ownProducts = products.filter(product => product.tenantId === tenantId && product.id !== source.id);
  useEffect(() => {
    let current = true; alive.current = true; setLoading(true); setFailed(false); setError('');
    upsellRepository.getPins(tenantId, source.id).then(ids => { if (current) setSelected(ids); })
      .catch(() => { if (current) { setFailed(true); setError('Não foi possível carregar as combinações. Tente novamente antes de salvar.'); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; alive.current = false; };
  }, [tenantId, source.id, attempt]);
  const save = async () => {
    if (loading || failed || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await upsellRepository.setPins(tenantId, source.id, selected); if (alive.current) onClose(); }
    catch { if (alive.current) setError('Não foi possível salvar. Suas escolhas continuam aqui.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} title="Sugerir junto" description={`Escolha os complementos de ${source.name}.`} size="lg">
    <div className="space-y-5">
      <p className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-950"><Sparkles className="mt-0.5 h-5 w-5 shrink-0" />Escolha até três combinações prioritárias. Elas aparecem primeiro quando estiverem disponíveis e fizerem sentido para a sacola.</p>
      {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">{error}{failed && <button type="button" onClick={() => setAttempt(value => value + 1)} className="ml-2 min-h-11 font-bold underline">Tentar novamente</button>}</div>}
      {loading ? <p role="status" className="py-8 text-center text-slate-500">Carregando combinações…</p> : <>
        <div className="space-y-2" aria-label="Prioridade das sugestões">{selected.map((id, index) => <div key={id} className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-800 text-sm font-bold text-white">{index + 1}</span><span className="flex-1 text-sm font-bold text-slate-900">{ownProducts.find(product => product.id === id)?.name || 'Produto indisponível'}</span><button type="button" disabled={busy} onClick={() => setSelected(ids => ids.filter(value => value !== id))} aria-label={`Remover sugestão ${index + 1}`} className="grid min-h-11 min-w-11 place-items-center rounded-xl text-slate-600 hover:bg-white"><X size={18} /></button></div>)}</div>
        <label className="block text-sm font-semibold text-slate-700">Buscar um complemento<input value={search} onChange={event => setSearch(event.target.value)} disabled={busy || failed} placeholder="Nome do produto" className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-emerald-600" /></label>
        <div className="max-h-72 space-y-2 overflow-y-auto" aria-label="Produtos para sugerir">{ownProducts.filter(product => product.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).map(product => {
          const chosen = selected.includes(product.id);
          return <button type="button" key={product.id} aria-pressed={chosen} disabled={busy || failed || (!chosen && selected.length >= 3)} onClick={() => setSelected(ids => chosen ? ids.filter(id => id !== product.id) : [...ids, product.id])} className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-slate-200 p-3 text-left disabled:opacity-45">
            {product.imageUrl && <img src={product.imageUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />}<span className="flex-1"><b className="block text-sm text-slate-900">{product.name}</b><span className="text-xs text-slate-500">{formatBRL(product.promotionalPrice && product.promotionalPrice > 0 && product.promotionalPrice < product.price ? product.promotionalPrice : product.price)}{(!product.isActive || !product.isAvailable) && ' · Indisponível agora'}</span></span><span className={`grid h-8 w-8 place-items-center rounded-full ${chosen ? 'bg-emerald-800 text-white' : 'bg-slate-100 text-slate-600'}`}>{chosen ? <Check size={17} /> : <Plus size={17} />}</span>
          </button>;
        })}</div>
      </>}
      <div className="flex gap-3 border-t border-slate-100 pt-4"><button type="button" disabled={busy} onClick={onClose} className="min-h-12 flex-1 rounded-xl border border-slate-200 font-bold text-slate-700">Cancelar</button><button type="button" disabled={loading || failed || busy} onClick={() => void save()} className="min-h-12 flex-1 rounded-xl bg-emerald-800 font-bold text-white disabled:opacity-45">{busy ? 'Salvando…' : 'Salvar combinações'}</button></div>
    </div>
  </Modal>;
}
