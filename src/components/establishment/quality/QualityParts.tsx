import React from 'react';
import { Camera, AlignLeft, DollarSign, Layers, Check, X, ImageIcon, Trophy } from 'lucide-react';
import { QUALITY_KEYS, QUALITY_LABELS, QualityKey, ProductQuality, qualityColor } from '../../../lib/menu/menuQuality';
import './quality.css';

const ICONS: Record<QualityKey, React.ComponentType<{ size?: number; className?: string }>> = { photo: Camera, description: AlignLeft, price: DollarSign, category: Layers };
const COPY: Record<QualityKey, { label: string; cta: string }> = {
  photo: { label: 'do cardápio com foto', cta: 'Adicione fotos' },
  description: { label: 'do cardápio com descrição', cta: 'Adicione descrições' },
  price: { label: 'dos itens com preço válido', cta: 'Corrija os preços' },
  category: { label: 'dos itens com categoria', cta: 'Defina categorias' },
};

/** Card de métrica ("Você tem 92% do cardápio com foto") com botão que filtra a lista. */
export const QualityMetricCard: React.FC<{ metric: QualityKey; pct: number; missing: number; onFilter: (m: QualityKey) => void }> = ({ metric, pct, missing, onFilter }) => {
  const Icon = ICONS[metric];
  const done = pct === 100;
  return (
    <div className="mq-card mq-metric flex flex-col gap-2 p-4" data-testid={`metric-${metric}`} data-pct={pct}>
      <p className="text-[11px] font-semibold text-slate-400">Você tem</p>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: `${qualityColor(pct)}1f`, color: qualityColor(pct) }}><Icon size={20} /></span>
        <div className="min-w-0">
          <p className="text-2xl font-black leading-none tabular-nums text-slate-900">{pct}%</p>
          <p className="mt-1 text-[11px] leading-tight text-slate-500">{COPY[metric].label}</p>
        </div>
      </div>
      {done
        ? <p className="mt-1 rounded-xl bg-emerald-50 py-2 text-center text-xs font-extrabold text-emerald-700">Parabéns! ✓</p>
        : <button type="button" data-testid={`cta-${metric}`} onClick={() => onFilter(metric)} className="mt-1 rounded-xl bg-[#15803d] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#166534]">{COPY[metric].cta} <span className="opacity-80">({missing})</span></button>}
    </div>
  );
};

/** Chips ✓ verde / ✗ laranja por item; cada um abre o painel de correção naquele campo. */
export const QualityChips: React.FC<{ item: ProductQuality; onFix: (k: QualityKey) => void }> = ({ item, onFix }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    {QUALITY_KEYS.map(k => (
      <button key={k} type="button" className="mq-chip" data-ok={item.checks[k]} data-testid={`chip-${k}`} aria-label={`${QUALITY_LABELS[k]}: ${item.checks[k] ? 'ok' : 'falta'}. ${item.checks[k] ? 'Editar' : 'Corrigir'}`}
        onClick={e => { e.stopPropagation(); onFix(k); }}>
        {item.checks[k] ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}{QUALITY_LABELS[k]}
      </button>
    ))}
  </div>
);

export const MiniScore: React.FC<{ score: number }> = ({ score }) => (
  <div className="w-24 shrink-0" data-testid="mini-score" data-score={score}>
    <div className="mb-1 text-right text-sm font-black tabular-nums" style={{ color: qualityColor(score) }}>{score}%</div>
    <div className="mq-bar"><i style={{ width: `${score}%`, backgroundColor: qualityColor(score) }} /></div>
  </div>
);

export const Thumb: React.FC<{ url?: string; name: string; size?: number }> = ({ url, name, size = 52 }) => (
  url && url.trim()
    ? <img src={url} alt="" loading="lazy" className="shrink-0 rounded-xl object-cover" style={{ width: size, height: size }} />
    : <span aria-label={`${name} sem foto`} className="flex shrink-0 items-center justify-center rounded-xl border border-dashed border-orange-300 bg-orange-50 text-orange-400" style={{ width: size, height: size }}><ImageIcon size={size * 0.4} /></span>
);

const CONFETTI = ['#ef4444', '#f59e0b', '#16a34a', '#3b82f6', '#a855f7', '#f97316'];
export const Celebration: React.FC = () => (
  <div className="mq-card relative overflow-hidden border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-5 text-center" data-testid="quality-celebration" role="status">
    <div className="mq-confetti" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ left: `${(i * 4.3 + 3) % 100}%`, backgroundColor: CONFETTI[i % CONFETTI.length], animationDelay: `${(i % 8) * 0.25}s` }} />)}</div>
    <div className="mq-pop relative mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg"><Trophy size={26} /></div>
    <p className="relative text-lg font-black text-emerald-800">Cardápio 100% otimizado! 🎉</p>
    <p className="relative mt-1 text-sm text-emerald-700">Todos os itens têm foto, descrição, preço e categoria. Seus clientes vão amar.</p>
  </div>
);
