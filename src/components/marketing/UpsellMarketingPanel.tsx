import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ShoppingBag, Sparkles, TrendingUp } from 'lucide-react';
import type { Product } from '../../types';
import type { UpsellStats } from '../../types/upsell';
import { upsellRepository } from '../../repositories/upsellRepository';
import { formatBRL } from '../../lib/pricing/money';

interface Props { tenantId: string; viewerId: string; role?: string | null; products: Product[] }
const allowed = (role?: string | null) => role === 'OWNER' || role === 'MANAGER';

export function UpsellMarketingPanel(props: Props) {
  if (!allowed(props.role)) return null;
  return <UpsellMarketingEditor key={`${props.tenantId}:${props.viewerId}:${props.role}`} {...props} />;
}

function UpsellMarketingEditor({ tenantId, products }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configError, setConfigError] = useState('');
  const [statsError, setStatsError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [stats, setStats] = useState<UpsellStats | null>(null);
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    let current = true; alive.current = true;
    setLoading(true); setConfigError(''); setStatsError('');
    upsellRepository.getSettings(tenantId).then(settings => { if (current) setEnabled(settings.enabled); })
      .catch(() => { if (current) setConfigError('Não foi possível carregar a configuração. Tente novamente antes de alterar.'); })
      .finally(() => { if (current) setLoading(false); });
    upsellRepository.getStats(tenantId).then(value => { if (current) setStats(value); })
      .catch(() => { if (current) setStatsError('As estatísticas estão indisponíveis. A configuração continua disponível.'); });
    return () => { current = false; alive.current = false; };
  }, [tenantId, attempt]);

  const toggle = async () => {
    if (loading || configError || lock.current) return;
    lock.current = true; setSaving(true); setNotice(''); setSaveError('');
    try {
      const saved = await upsellRepository.setEnabled(tenantId, !enabled);
      if (alive.current) { setEnabled(saved.enabled); setNotice(saved.enabled ? 'Sugestões ativadas.' : 'Sugestões desativadas.'); }
    } catch { if (alive.current) setSaveError('Não foi possível salvar. A configuração anterior foi mantida.'); }
    finally { lock.current = false; if (alive.current) setSaving(false); }
  };
  const productName = (id: string) => products.find(product => product.id === id && product.tenantId === tenantId)?.name || 'Produto indisponível';
  return <section aria-label="Leve também" className="space-y-6">
    <div className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white sm:p-8">
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-emerald-400/15 blur-3xl" />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl"><span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-emerald-200"><Sparkles size={15} /> Combinações que fazem sentido</span>
          <h2 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">Leve também</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">Sugestões de complementos para cada sacola, com base nas compras da loja, na disponibilidade e nas combinações que você escolheu em Produtos.</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} aria-label="Ativar sugestões Leve também" disabled={loading || saving || !!configError} onClick={() => void toggle()} className="flex min-h-14 shrink-0 items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-bold disabled:opacity-50">
          <span className={`relative h-7 w-12 rounded-full transition-colors ${enabled ? 'bg-emerald-400' : 'bg-slate-600'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} /></span>
          {loading ? 'Carregando…' : saving ? 'Salvando…' : enabled ? 'Ativado' : 'Desativado'}
        </button>
      </div>
    </div>
    {configError && <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-900">{configError}<button type="button" onClick={() => setAttempt(value => value + 1)} className="ml-2 min-h-11 font-bold underline">Tentar novamente</button></div>}
    {notice && <p role="status" className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-950"><Check size={17} />{notice}</p>}
    {saveError && <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-900">{saveError}</p>}
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-600">O cliente vê até três sugestões por vez. Produtos da sacola ou indisponíveis ficam de fora. Os preços continuam os mesmos do catálogo. Para priorizar uma combinação, use <strong className="text-slate-900">Sugerir junto</strong> no produto de origem.</div>
    {statsError && <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">{statsError}</p>}
    <div><h3 className="text-lg font-black text-slate-900">O que as sugestões trouxeram</h3><p className="mt-1 text-sm text-slate-500">Itens e receita consideram pedidos concluídos. Aceitar uma sugestão na sacola ainda não é uma venda.</p></div>
    <div className="grid gap-4 sm:grid-cols-3">
      {[
        { label: 'Itens vendidos', value: stats ? String(stats.itemsSold) : '—', icon: <ShoppingBag size={19} /> },
        { label: 'Receita das sugestões', value: stats ? formatBRL(stats.revenue) : '—', icon: <TrendingUp size={19} /> },
        { label: 'Taxa de aceitação', value: stats ? new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(stats.acceptanceRate) : '—', icon: <ArrowUpRight size={19} /> },
      ].map(item => <article key={item.label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-800">{item.icon}</span><p className="mt-4 text-sm font-medium text-slate-500">{item.label}</p><p className="mt-1 text-3xl font-black tracking-tight text-slate-950">{item.value}</p></article>)}
    </div>
    <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6" aria-label="Combinações mais vendidas"><h3 className="font-black text-slate-900">Combinações que dão certo</h3>
      {stats?.topPairs.length ? <div className="mt-4 divide-y divide-slate-100">{stats.topPairs.map(pair => <div key={`${pair.sourceProductId}:${pair.suggestedProductId}`} className="flex items-center justify-between gap-4 py-4"><div><p className="font-bold text-slate-900">{productName(pair.sourceProductId)} <span className="text-slate-400">+</span> {productName(pair.suggestedProductId)}</p><p className="mt-1 text-xs text-slate-500">{pair.itemsSold} {pair.itemsSold === 1 ? 'item vendido' : 'itens vendidos'}</p></div><b className="shrink-0 text-emerald-800">{formatBRL(pair.revenue)}</b></div>)}</div>
        : <p className="mt-4 rounded-2xl bg-slate-50 p-5 text-sm leading-relaxed text-slate-500">As primeiras combinações aparecem aqui quando uma sugestão vira uma venda concluída.</p>}
    </section>
  </section>;
}
