import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, ChevronLeft, ChevronRight, PartyPopper, Package, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { productRepository } from '../../repositories/productRepository';
import { categoryRepository } from '../../repositories/categoryRepository';
import type { Category, Product } from '../../types';
import {
  QUALITY_KEYS, QUALITY_LABELS, QualityKey, QualityProblemFilter, filterQuality, menuQuality, scoreGainIfFixed, sortWorstFirst,
} from '../../lib/menu/menuQuality';
import { QualityGauge } from '../../components/establishment/quality/QualityGauge';
import { Celebration, MiniScore, QualityChips, QualityMetricCard, Thumb } from '../../components/establishment/quality/QualityParts';
import { QualityFixDrawer, type QualityFixValues } from '../../components/establishment/quality/QualityFixDrawer';
import '../../components/establishment/quality/quality.css';

export const PAGE_SIZE = 8;
const KEY_TO_PROBLEM: Record<QualityKey, QualityProblemFilter> = { photo: 'NO_PHOTO', description: 'NO_DESCRIPTION', price: 'NO_PRICE', category: 'NO_CATEGORY' };
const PROBLEM_TABS: { id: QualityProblemFilter; label: string }[] = [
  { id: 'ALL', label: 'Todos' }, { id: 'NO_PHOTO', label: 'Sem foto' }, { id: 'NO_DESCRIPTION', label: 'Sem descrição' },
  { id: 'NO_PRICE', label: 'Sem preço' }, { id: 'NO_CATEGORY', label: 'Sem categoria' },
];

export const MenuQualityPage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<QualityProblemFilter>('ALL');
  const [categoryId, setCategoryId] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [fixing, setFixing] = useState<{ id: string; focus: QualityKey } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!activeTenant?.id) return;
    setLoading(true); setError(null);
    try {
      const [prods, cats] = await Promise.all([
        productRepository.getProducts(securityContext, activeTenant.id),
        categoryRepository.getCategories(securityContext, activeTenant.id),
      ]);
      setProducts(prods); setCategories(cats);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar o cardápio.');
    } finally { setLoading(false); }
  }, [activeTenant?.id, securityContext]);
  useEffect(() => { void load(); }, [load]);

  const quality = useMemo(() => menuQuality(products, categories), [products, categories]);
  const sorted = useMemo(() => sortWorstFirst(quality.items), [quality.items]);
  const filtered = useMemo(() => filterQuality(sorted, { problem, categoryId, search }), [sorted, problem, categoryId, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [problem, categoryId, search]);

  const categoryName = (id: string) => categories.find(c => c.id === id)?.name;
  const inactiveCount = products.length - quality.total;
  const problemCount = (p: QualityProblemFilter) => (p === 'ALL' ? quality.total : filterQuality(quality.items, { problem: p, categoryId: 'ALL', search: '' }).length);
  const editing = fixing ? products.find(p => p.id === fixing.id) : undefined;

  const applyMetricFilter = (k: QualityKey) => {
    setProblem(KEY_TO_PROBLEM[k]); setCategoryId('ALL'); setSearch('');
    window.requestAnimationFrame?.(() => document.getElementById('quality-list')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  };

  const save = async (changes: Partial<QualityFixValues>) => {
    if (!activeTenant?.id || !editing || Object.keys(changes).length === 0) return;
    setSaving(true);
    try {
      // Caminho existente de atualização: sempre escopado ao tenant da loja (eq tenant_id) e validado pelo RLS.
      const updated = await productRepository.update(securityContext, activeTenant.id, editing.id, changes);
      setProducts(prev => prev.map(p => (p.id === updated.id ? { ...p, ...updated } : p)));
      setFixing(null);
      showToast({ type: 'success', title: 'Item atualizado', message: `"${updated.name}" ficou mais completo. A nota do cardápio já foi recalculada.` });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Não foi possível salvar', message: e?.message || 'Tente novamente.' });
    } finally { setSaving(false); }
  };

  if (!activeTenant) return null;
  const empty = !loading && quality.total === 0;

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-5" data-testid="menu-quality-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900">Qualidade do Cardápio</h2>
          <p className="text-sm text-slate-500">Quanto maior a pontuação, mais pedidos você pode receber!</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50" aria-label="Atualizar">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Atualizar
        </button>
      </div>

      {error && <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={16} />{error}</div>}

      <section className="mq-card grid items-center gap-5 p-5 lg:grid-cols-[300px_1fr]" aria-label="Resumo da qualidade">
        <div>
          <QualityGauge score={quality.score} empty={empty || loading} />
          <p className="mt-2 text-center text-xs text-slate-500">{loading ? 'Calculando…' : empty ? 'Cadastre produtos para ver a nota.' : `${quality.perfect} de ${quality.total} itens estão perfeitos`}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {QUALITY_KEYS.map(k => <QualityMetricCard key={k} metric={k} pct={quality.pct[k]} missing={quality.total - quality.counts[k]} onFilter={applyMetricFilter} />)}
        </div>
      </section>

      {!loading && quality.total > 0 && quality.score === 100 && <Celebration />}

      <section id="quality-list" className="space-y-3" aria-label="Itens do cardápio">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar por problema">
            {PROBLEM_TABS.map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={problem === t.id} data-testid={`problem-${t.id}`} onClick={() => setProblem(t.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${problem === t.id ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                {t.label} <span className={problem === t.id ? 'opacity-80' : 'text-slate-400'}>{problemCount(t.id)}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select aria-label="Filtrar por categoria" value={categoryId} onChange={e => setCategoryId(e.target.value)} className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700">
              <option value="ALL">Todas as categorias</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input aria-label="Buscar item" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar item" className="h-9 w-44 rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-xs outline-none focus:border-emerald-500" />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-white" />)}</div>
        ) : empty ? (
          <div className="mq-card flex flex-col items-center gap-2 p-10 text-center"><Package size={34} className="text-slate-300" /><p className="font-bold text-slate-800">Nenhum produto ativo ainda</p><p className="text-sm text-slate-500">Cadastre produtos em Cardápio / Produtos para acompanhar a qualidade.</p></div>
        ) : filtered.length === 0 ? (
          <div className="mq-card flex flex-col items-center gap-2 p-10 text-center" data-testid="quality-empty-filter"><PartyPopper size={34} className="text-emerald-500" /><p className="font-bold text-slate-800">Nenhum item com esse problema</p><p className="text-sm text-slate-500">Tudo certo por aqui. Limpe os filtros para ver todos os itens.</p></div>
        ) : (
          <ul className="space-y-2" data-testid="quality-list">
            {visible.map(item => {
              const firstMissing = item.missing[0] ?? 'photo';
              const gain = item.missing.length ? scoreGainIfFixed(item, firstMissing, quality.total) : 0;
              return (
                <li key={item.product.id}>
                  <div role="button" tabIndex={0} className="mq-row" data-testid="quality-row" data-score={item.score}
                    onClick={() => setFixing({ id: item.product.id, focus: firstMissing })}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFixing({ id: item.product.id, focus: firstMissing }); } }}>
                    <div className="flex min-w-0 items-center gap-3">
                      <Thumb url={item.product.imageUrl} name={item.product.name} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-slate-900">{item.product.name}</p>
                        <p className="truncate text-xs text-slate-500">{categoryName(item.product.categoryId) || 'Sem categoria'}{item.missing.length > 0 && <span className="text-orange-700"> · falta {item.missing.map(k => QUALITY_LABELS[k].toLowerCase()).join(', ')}{gain > 0 && ` (+${gain} pts)`}</span>}</p>
                      </div>
                    </div>
                    <QualityChips item={item} onFix={k => setFixing({ id: item.product.id, focus: k })} />
                    <MiniScore score={item.score} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && filtered.length > PAGE_SIZE && (
          <nav className="flex items-center justify-between pt-1 text-xs text-slate-500" aria-label="Paginação">
            <span>{(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, filtered.length)} de {filtered.length} itens</span>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Página anterior" disabled={current <= 1} onClick={() => setPage(current - 1)} className="rounded-xl border border-slate-200 bg-white p-2 disabled:opacity-40"><ChevronLeft size={14} /></button>
              <span className="tabular-nums" data-testid="quality-page">Página {current} de {pages}</span>
              <button type="button" aria-label="Próxima página" disabled={current >= pages} onClick={() => setPage(current + 1)} className="rounded-xl border border-slate-200 bg-white p-2 disabled:opacity-40"><ChevronRight size={14} /></button>
            </div>
          </nav>
        )}
        {!loading && inactiveCount > 0 && <p className="text-[11px] text-slate-400">{inactiveCount} {inactiveCount === 1 ? 'item inativo não entra' : 'itens inativos não entram'} na nota.</p>}
      </section>

      {editing && fixing && (
        <QualityFixDrawer key={editing.id} product={editing} categories={categories} tenantId={activeTenant.id} focus={fixing.focus} saving={saving} onClose={() => setFixing(null)} onSave={save} />
      )}
    </div>
  );
};
