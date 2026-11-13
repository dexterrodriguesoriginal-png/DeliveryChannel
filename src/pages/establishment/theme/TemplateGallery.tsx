import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Heart, Sparkles, RotateCcw, Columns2, ArrowDown } from 'lucide-react';
import { TenantTheme } from '../../../types';
import { StoreTemplate } from '../../../types/theme';
import {
  CANONICAL_FAMILY_BASES,
  ColorFamily,
  filterTemplates,
  findClosestTemplate,
  getTemplateById,
  SEGMENTS,
  TEMPLATES,
  normalizeSearch,
} from '../../../lib/theme/templates';
import { themeToTokens, tokensToTheme } from '../../../lib/theme/themeEngine';
import {
  extractLogoPalette,
  nearestColorFamily,
  rankTemplatesByLogo,
} from '../../../lib/theme/extractLogoPalette';
import { ThemedProductItem } from '../../../components/storefront/ThemedProductList';
import { LiveStorePreview } from '../../../components/establishment/theme/LiveStorePreview';
import { TemplateCard } from './TemplateCard';
import { TemplateCompareDialog } from './TemplateCompareDialog';
import { ThemeDialog } from './ThemeDialog';
import { resolveSegment } from '../../../lib/theme/previewProducts';

export interface TemplateGalleryProps {
  /** Slug da loja: a prévia mostra o app real do cliente. */
  storeSlug?: string;
  active?: boolean;
  tenantId: string;
  category?: string;
  savedTheme: TenantTheme;
  draftTheme: TenantTheme;
  products?: ThemedProductItem[];
  isStoreOpen?: boolean;
  onApply: (template: StoreTemplate) => void;
  onPreviewChange?: (template: StoreTemplate | null) => void;
}
const FAMILY_LABELS: Record<ColorFamily, string> = {
  azul: 'Azul',
  verde: 'Verde',
  amarelo: 'Amarelo',
  vermelho: 'Vermelho',
  roxo: 'Roxo',
  rosa: 'Rosa',
  laranja: 'Laranja',
  marrom: 'Marrom',
  neutros: 'Neutros',
};
const STYLES = [...new Set(TEMPLATES.flatMap(t => t.style))].filter(s => !['claro', 'escuro'].includes(s)).sort();
function readFavorites(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
export function TemplateGallery({
  storeSlug,
  active = true,
  tenantId,
  category,
  savedTheme,
  draftTheme,
  products,
  isStoreOpen,
  onApply,
  onPreviewChange,
}: TemplateGalleryProps) {
  const [segment, setSegment] = useState(resolveSegment(category) || '');
  const [family, setFamily] = useState('');
  const [shade, setShade] = useState('');
  const [style, setStyle] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'' | 'light' | 'dark'>('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [limit, setLimit] = useState(24);
  const favoritesKey = `dc:theme-favs:${tenantId}`;
  const [favorites, setFavorites] = useState(() => readFavorites(favoritesKey));
  const [preview, setPreview] = useState<StoreTemplate | null>(null);
  const [comparing, setComparing] = useState<StoreTemplate[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [logoColors, setLogoColors] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const logoRequest = useRef(0);
  const logoUrl = draftTheme.logoUrl;
  useEffect(() => {
    setFavorites(readFavorites(favoritesKey));
  }, [favoritesKey]);
  useEffect(() => {
    setLimit(24);
  }, [segment, family, shade, style, mode, query, onlyFavorites, logoColors]);
  useEffect(() => {
    logoRequest.current++;
    setLogoColors([]);
    setExtracting(false);
  }, [logoUrl, tenantId]);
  useEffect(
    () => () => {
      logoRequest.current++;
    },
    []
  );
  const current = useMemo(() => findClosestTemplate(themeToTokens(savedTheme)), [savedTheme]);
  const currentId = current.id;
  const draftId = draftTheme.tokens?.meta?.templateId;
  useEffect(() => { if (preview?.id === draftId) setPreview(null); }, [draftId, preview?.id]);
  const shades = useMemo(
    () => [...new Set(TEMPLATES.filter((t) => t.colorFamily === family).map((t) => t.shade))],
    [family]
  );
  const models = useMemo(() => {
    let filtered = filterTemplates({
      segment,
      colorFamily: family,
      style: style || undefined,
      mode: mode || undefined,
      search: query,
      shade,
      includeRecolored: true,
    });
    if (onlyFavorites) {
      const variations = favorites
        .map(getTemplateById)
        .filter((t): t is StoreTemplate => !!t && !TEMPLATES.some((native) => native.id === t.id))
        .filter(
          (t) =>
            (!segment || t.segmentId === segment) &&
            (!family || t.colorFamily === family) &&
            (!mode || t.mode === mode) &&
            (!query || normalizeSearch([t.name, t.segmentLabel, t.colorFamily, t.shade, ...t.style].join(' ')).includes(normalizeSearch(query))) &&
            (!style ||
              (style === 'claro'
                ? t.mode === 'light'
                : style === 'escuro'
                  ? t.mode === 'dark'
                  : t.style.includes(style)))
        );
      filtered = [...new Map([...filtered, ...variations].map((t) => [t.id, t])).values()];
    }
    const ranked = rankTemplatesByLogo(
      filtered.filter(
        (t) => (!shade || t.shade === shade) && (!onlyFavorites || favorites.includes(t.id))
      ),
      logoColors
    );
    return logoColors.length
      ? ranked
      : [...ranked].sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId));
  }, [segment, family, shade, style, mode, query, onlyFavorites, favorites, logoColors, currentId]);
  const toggleFavorite = useCallback(
    (id: string) => {
      setFavorites((previous) => {
        const next = previous.includes(id)
          ? previous.filter((value) => value !== id)
          : [...previous, id];
        try {
          localStorage.setItem(favoritesKey, JSON.stringify(next));
        } catch {
          /* Storage may be disabled. Keep this session usable. */
        }
        return next;
      });
    },
    [favoritesKey]
  );
  const toggleCompare = useCallback(
    (template: StoreTemplate) => {
      const next = comparing.some((t) => t.id === template.id)
        ? comparing.filter((t) => t.id !== template.id)
        : [...comparing, template].slice(0, 2);
      setComparing(next);
      if (next.length === 2) setCompareOpen(true);
    },
    [comparing]
  );
  const clear = () => {
    logoRequest.current++;
    setExtracting(false);
    setSegment('');
    setFamily('');
    setShade('');
    setStyle('');
    setMode('');
    setQuery('');
    setOnlyFavorites(false);
    setLogoColors([]);
    setLimit(24);
  };
  const suggestFromLogo = async () => {
    if (!logoUrl) return;
    const request = ++logoRequest.current;
    setExtracting(true);
    const colors = await extractLogoPalette(logoUrl);
    if (request !== logoRequest.current) return;
    setLogoColors(colors);
    setExtracting(false);
  };
  const previewTemplate = (template: StoreTemplate) => { setPreview(template); onPreviewChange?.(template); };
  const apply = (template: StoreTemplate) => {
    onApply(template);
    setPreview(null);
    onPreviewChange?.(null);
    setCompareOpen(false);
  };
  return (
    <section className="theme-gallery" aria-label="Galeria de modelos">
      <div className="theme-gallery-intro">
        <div>
          <p className="theme-eyebrow">UM NOVO OLHAR PARA SUA LOJA</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Sua marca. Seu jeito.
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-500">
            Encontre seu modelo e deixe cada detalhe com a sua cara.
          </p>
        </div>
        <span className="hidden rounded-2xl bg-white/70 p-4 text-emerald-800 sm:block">
          <Sparkles size={28} strokeWidth={1.5} />
        </span>
      </div>
      <div className="theme-filter-panel space-y-4">
        <label className="theme-filter-label">Buscar nos 500 temas
          <input type="search" className="theme-select" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome, segmento, cor, tom ou estilo" />
        </label>
        <label className="theme-filter-label">Modo
          <select className="theme-select" value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
            <option value="">Claro e escuro</option><option value="light">Claro</option><option value="dark">Escuro</option>
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="theme-filter-label">
            Meu estabelecimento
            <select
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              className="theme-select"
            >
              <option value="">Todos os estabelecimentos</option>
              {SEGMENTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="theme-filter-label">
            Meu estilo
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="theme-select"
            >
              <option value="">Todos os estilos</option>
              {STYLES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="theme-filter-label mb-2">Minha cor</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(FAMILY_LABELS) as ColorFamily[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-label={FAMILY_LABELS[key]}
                aria-pressed={family === key}
                onClick={() => {
                  setFamily(family === key ? '' : key);
                  setShade('');
                }}
                className={`theme-color-filter ${family === key ? 'theme-color-filter-active' : ''}`}
              >
                <span style={{ backgroundColor: CANONICAL_FAMILY_BASES[key].primary }} />
                {FAMILY_LABELS[key]}
              </button>
            ))}
          </div>
        </fieldset>
        {family && (
          <label className="theme-filter-label block sm:max-w-xs">
            Tom de {FAMILY_LABELS[family as ColorFamily].toLowerCase()}
            <select
              className="theme-select"
              value={shade}
              onChange={(e) => setShade(e.target.value)}
            >
              <option value="">Todos os tons</option>
              {shades.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll('-', ' ')}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            aria-pressed={onlyFavorites}
            onClick={() => setOnlyFavorites((value) => !value)}
            className={`theme-filter-chip ${onlyFavorites ? 'bg-rose-50 text-rose-700' : ''}`}
          >
            <Heart size={14} /> Só favoritos
          </button>
          {logoUrl && (
            <button
              type="button"
              disabled={extracting}
              onClick={suggestFromLogo}
              className="theme-filter-chip"
            >
              <Sparkles size={14} />{' '}
              {extracting ? 'Buscando suas cores…' : 'Sugerir pela minha logo'}
            </button>
          )}
          <button type="button" onClick={clear} className="theme-filter-chip sm:ml-auto">
            <RotateCcw size={13} /> Limpar filtros
          </button>
        </div>
        {logoColors.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Cores da sua logo</span>
            {logoColors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Filtrar ${nearestColorFamily(color)} da logo ${color}`}
                title={color}
                className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1"
                onClick={() => {
                  setFamily(nearestColorFamily(color));
                  setShade('');
                }}
              >
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: color }} />
                {FAMILY_LABELS[nearestColorFamily(color)]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm font-semibold text-slate-700">
          {models.length} {models.length === 1 ? 'modelo' : 'modelos'}
        </p>
        {comparing.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">{comparing.length}/2 selecionados</span>
            <button
              type="button"
              disabled={comparing.length !== 2}
              className="theme-filter-chip disabled:opacity-40"
              onClick={() => setCompareOpen(true)}
            >
              <Columns2 size={14} /> Comparar modelos
            </button>
            <button
              type="button"
              onClick={() => setComparing([])}
              className="text-xs text-slate-500 underline"
            >
              Limpar seleção
            </button>
          </div>
        )}
      </div>
      {!onlyFavorites &&
        currentId.includes('-recolor-') &&
        !models.some((t) => t.id === currentId) && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Seu modelo salvo</h3>
            <div className="theme-template-grid">
              <TemplateCard
                template={current}
                current
                previewing={false}
                favorite={favorites.includes(currentId)}
                comparing={comparing.some((t) => t.id === currentId)}
                compareDisabled={comparing.length >= 2}
                onPreview={previewTemplate}
                onFavorite={toggleFavorite}
                onCompare={toggleCompare}
              />
            </div>
          </div>
        )}
      {models.length ? (
        <div className="theme-template-grid">
          {models.slice(0, limit).map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              current={template.id === currentId}
              previewing={
                template.id === (preview?.id || (draftId !== currentId ? draftId : undefined))
              }
              favorite={favorites.includes(template.id)}
              comparing={comparing.some((t) => t.id === template.id)}
              compareDisabled={comparing.length >= 2}
              onPreview={previewTemplate}
              onFavorite={toggleFavorite}
              onCompare={toggleCompare}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-semibold text-slate-700">
            Nenhum modelo com esses filtros por enquanto.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Experimente outra combinação ou marque seus modelos favoritos.
          </p>
          <button type="button" className="theme-filter-chip mx-auto mt-4" onClick={clear}>
            Limpar filtros
          </button>
        </div>
      )}
      {models.length > limit && (
        <div className="pb-4 text-center">
          <button
            type="button"
            className="theme-filter-chip mx-auto px-6 py-3"
            onClick={() => setLimit((value) => value + 24)}
          >
            Ver mais <ArrowDown size={14} />
          </button>
          <p className="mt-2 text-xs text-slate-400">
            Mostrando {Math.min(limit, models.length)} de {models.length}
          </p>
        </div>
      )}
      {active && preview && (!onPreviewChange || window.innerWidth < 900) && (
        <ThemeDialog title="Veja na sua loja" onClose={() => { setPreview(null); onPreviewChange?.(null); }}>
          <div className="mx-auto max-w-sm space-y-4">
            <div>
              <span className="template-badge">Em prévia</span>
              <h3 className="mt-2 font-bold text-slate-900">{preview.name}</h3>
              <p className="mt-1 text-xs text-slate-500">
                Experimente à vontade. Você escolhe quando salvar.
              </p>
            </div>
            <LiveStorePreview
              theme={tokensToTheme(preview.tokens, draftTheme)}
              storeSlug={storeSlug}
              products={products}
              segmentId={preview.segmentId}
              isOpen={isStoreOpen}
              compact
            />
            <button type="button" className="theme-primary w-full" onClick={() => apply(preview)}>
              Usar modelo
            </button>
          </div>
        </ThemeDialog>
      )}
      <TemplateCompareDialog
        templates={comparing}
        storeSlug={storeSlug}
        identity={draftTheme}
        products={products}
        isStoreOpen={isStoreOpen}
        isOpen={active && compareOpen}
        onClose={() => setCompareOpen(false)}
        onApply={apply}
      />
    </section>
  );
}
