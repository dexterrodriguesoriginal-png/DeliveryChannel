import React, { memo } from 'react';
import { Heart, Check, Columns2, ArrowUpRight } from 'lucide-react';
import { StoreTemplate } from '../../../types/theme';
import { TemplateThumbnail } from './TemplateThumbnail';

export interface TemplateCardProps {
  template: StoreTemplate;
  current: boolean;
  previewing: boolean;
  favorite: boolean;
  comparing: boolean;
  compareDisabled?: boolean;
  onPreview: (template: StoreTemplate) => void;
  onFavorite: (id: string) => void;
  onCompare: (template: StoreTemplate) => void;
}
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
export const TemplateCard = memo(function TemplateCard({
  template,
  current,
  previewing,
  favorite,
  comparing,
  compareDisabled,
  onPreview,
  onFavorite,
  onCompare,
}: TemplateCardProps) {
  const style = template.style.find((s) => !['escuro', 'claro'].includes(s)) || 'Personalizado';
  return (
    <article
      data-testid="template-card"
      data-template-id={template.id}
      className={`template-card ${previewing || current ? 'template-card-selected' : ''}`}
    >
      <div className="relative">
        <TemplateThumbnail template={template} />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {current && (
            <span className="template-badge">
              <Check size={11} /> Tema atual
            </span>
          )}
          {previewing && <span className="template-badge bg-slate-900 text-white">Em prévia</span>}
        </div>
        <button
          type="button"
          aria-label={`${favorite ? 'Desfavoritar' : 'Favoritar'} ${template.name}`}
          aria-pressed={favorite}
          onClick={() => onFavorite(template.id)}
          className={`absolute right-3 top-3 rounded-full border border-white/70 bg-white/95 p-2.5 shadow-sm ${favorite ? 'text-rose-600' : 'text-slate-500'}`}
        >
          <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">{template.name}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {titleCase(template.shade.replaceAll('-', ' '))} · {titleCase(style)} ·{' '}
            {template.mode === 'dark' ? 'Escuro' : 'Claro'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onPreview(template)}
            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800"
          >
            Ver na minha loja <ArrowUpRight size={13} />
          </button>
          <button
            type="button"
            disabled={compareDisabled && !comparing}
            aria-label={`Comparar ${template.name}`}
            aria-pressed={comparing}
            onClick={() => onCompare(template)}
            className={`flex min-h-10 items-center gap-1 rounded-xl border px-2.5 py-2 text-[11px] font-medium disabled:opacity-40 ${comparing ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}
          >
            <Columns2 size={14} /> Comparar
          </button>
        </div>
      </div>
    </article>
  );
});
