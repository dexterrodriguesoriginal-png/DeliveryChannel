import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { Category, Product } from '../../../types';
import { useAuth } from '../../../context/AuthContext';
import { categoryRepository } from '../../../repositories/categoryRepository';
import { menuQuality, qualityColor } from '../../../lib/menu/menuQuality';
import { QualityGauge } from './QualityGauge';
import './quality.css';

/** Card compacto do Dashboard: nota do cardápio e atalho para a página de Qualidade. */
export const QualityScoreCard: React.FC<{ products: Product[]; loading?: boolean; onOpen: () => void }> = ({ products, loading, onOpen }) => {
  const { activeTenant, securityContext } = useAuth();
  const [categories, setCategories] = useState<Category[] | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (!activeTenant?.id) return;
    categoryRepository.getCategories(securityContext, activeTenant.id).then(c => { if (alive) setCategories(c); }).catch(() => { if (alive) setCategories(undefined); });
    return () => { alive = false; };
  }, [activeTenant?.id, securityContext]);
  const q = useMemo(() => menuQuality(products, categories), [products, categories]);
  const need = q.total - q.perfect;
  const empty = q.total === 0;
  return (
    <button type="button" onClick={onOpen} data-testid="quality-score-card" className="mq-card mq-metric flex w-full items-center gap-4 p-4 text-left">
      <div className="w-[132px] shrink-0"><QualityGauge score={q.score} size={132} empty={empty || loading} label="otimizado" /></div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-extrabold text-slate-900"><Sparkles size={14} style={{ color: qualityColor(q.score) }} />Qualidade do Cardápio</p>
        <p className="mt-0.5 text-xs text-slate-500">{empty ? 'Cadastre produtos para ver a nota.' : need === 0 ? 'Tudo completo. Parabéns!' : `${need} ${need === 1 ? 'item precisa' : 'itens precisam'} de atenção (foto, descrição, preço ou categoria).`}</p>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-emerald-700">{need === 0 && !empty ? 'Ver detalhes' : 'Melhorar cardápio'}<ArrowRight size={13} /></span>
      </div>
    </button>
  );
};

/** Selo pequeno para a página de Cardápio / Produtos: nota atual e link para a página de Qualidade. */
export const QualityBadge: React.FC<{ products: Product[]; categories: Category[]; onOpen?: () => void }> = ({ products, categories, onOpen }) => {
  const q = useMemo(() => menuQuality(products, categories), [products, categories]);
  if (!onOpen || q.total === 0) return null;
  const c = qualityColor(q.score);
  return (
    <button type="button" onClick={onOpen} data-testid="quality-badge" title="Ver Qualidade do Cardápio"
      className="inline-flex h-9 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-bold shadow-xs transition hover:-translate-y-px hover:shadow-md" style={{ borderColor: `${c}66`, color: c }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />Qualidade {q.score}%<ArrowRight size={12} />
    </button>
  );
};
