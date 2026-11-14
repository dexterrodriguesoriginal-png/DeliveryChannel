import { getTemplateById } from '../../../../lib/theme/templates';
import type { Category } from '../../../../types';
import type { ThemedProductItem } from '../../../../components/storefront/ThemedProductList';
import { productRepository } from '../../../../repositories/productRepository';
import { categoryRepository } from '../../../../repositories/categoryRepository';
import { TemplateGallery } from '../TemplateGallery';
import { MenuThemePreview } from '../menu/MenuThemePreview';
import { menuFromTokens, menuFromTotem, totemFromTokens, resolveTotemDesign } from '../../../../lib/theme/channelThemes';
import { sampleProducts, resolveSegment } from '../../../../lib/theme/previewProducts';
import { totemContrastIssues } from '../../../../lib/theme/channelThemeContrast';
import { useUnsavedChanges } from '../../../../lib/ui/useUnsavedChanges';
import { useEffect, useRef, useState } from 'react';
import { CheckCheck, MonitorPlay, Palette, RotateCcw, Sparkles } from 'lucide-react';
import { useAuth } from '../../../../context/AuthContext';
import type { Tenant } from '../../../../types';
import { DEFAULT_MENU_THEME } from '../../../../lib/theme/menuTheme';
import {
  DEFAULT_TOTEM_DESIGN, TOTEM_COLOR_KEYS, TOTEM_COLOR_LABELS, TOTEM_THEME_PRESETS,
  designFromPreset, normalizeTotemDesign, type TotemDesign,
} from '../../../../lib/menu/totemDesign';
import { totemDesignRepository } from '../../../../repositories/totemDesignRepository';
import { TotemWelcomePanel } from '../menu/TotemWelcomePanel';
import { TotemUsersPanel } from './TotemUsersPanel';
import '../menu/menuThemeEditor.css';
import './designTotemEditor.css';

function same(a: TotemDesign, b: TotemDesign) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function DesignTotemEditor({ tenant, active = true }: { tenant: Tenant; active?: boolean }) {
  const { securityContext } = useAuth();
  const allowed = totemDesignRepository.canManage(securityContext, tenant.id);
  const [draft, setDraft] = useState<TotemDesign>(normalizeTotemDesign(DEFAULT_TOTEM_DESIGN));
  const [saved, setSaved] = useState<TotemDesign>(normalizeTotemDesign(DEFAULT_TOTEM_DESIGN));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [products, setProducts] = useState<ThemedProductItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const previewProducts = products.length ? products : sampleProducts(resolveSegment(tenant.category));
  const inFlight = useRef(false);
  const scope = `${tenant.id}:${securityContext.userId}:${securityContext.tenantId}:${securityContext.userRole}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [loadFailed, setLoadFailed] = useState(false);
  const effective = resolveTotemDesign(draft, tenant.theme);
  const issues = totemContrastIssues(effective);
  useUnsavedChanges(!same(draft, saved));

  useEffect(() => {
    if (!active || !allowed) return;
    let alive = true;
    setLoading(true); setLoadFailed(false); setError(''); setNotice('');
    inFlight.current = false; setSaving(false); setProducts([]); setCategories([]);
    productRepository.getProducts(securityContext, tenant.id).then(items => { if (alive) setProducts(items.filter(item => item.isActive !== false).slice(0, 4)); }).catch(() => {});
    categoryRepository.getCategories(securityContext, tenant.id).then(items => { if (alive) setCategories(items.filter(item => item.isActive !== false)); }).catch(() => {});
    totemDesignRepository.load(securityContext, tenant.id)
      .then(design => { if (alive) { setDraft(design); setSaved(design); } })
      .catch(reason => { if (alive) { setLoadFailed(true); setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o design.'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active, allowed, tenant.id, securityContext.userId, securityContext.userRole, securityContext.tenantId]);

  const update = (partial: Partial<TotemDesign> | { colors: Partial<TotemDesign['colors']> }) => {
    setDraft(current => {
      const next = { ...current, colors: { ...current.colors } };
      next.followApp = false;
      next.templateId ||= 'custom';
      if ('preset' in partial && partial.preset) next.preset = partial.preset;
      if ('bannerRadius' in partial && typeof partial.bannerRadius === 'number') next.bannerRadius = partial.bannerRadius;
      if ('colors' in partial && partial.colors) next.colors = { ...next.colors, ...partial.colors };
      return next;
    });
    setNotice('');
  };

  const applyPreset = (id: string) => {
    setDraft({ ...designFromPreset(id), followApp: false, templateId: `legacy-${id}` });
    setNotice('');
  };

  const restoreTheme = () => {
    const template = draft.templateId ? getTemplateById(draft.templateId) : undefined;
    setDraft(template ? { ...totemFromTokens(template.tokens), templateId: template.id, followApp: false } : { ...designFromPreset(draft.preset), followApp: false, templateId: draft.templateId || `legacy-${draft.preset}` });
    setNotice('');
  };

  const save = async () => {
    if (!allowed || loading || loadFailed || issues.length > 0 || inFlight.current || same(draft, saved)) return;
    inFlight.current = true; setSaving(true); setError('');
    try {
      const stored = await totemDesignRepository.save(securityContext, tenant.id, draft);
      if (scopeRef.current !== scope) return;
      setSaved(stored);
      setDraft(current => same(current, draft) ? stored : current);
      setNotice('Design do totem salvo.');
    } catch (reason) {
      if (scopeRef.current === scope) setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.');
    } finally {
      if (scopeRef.current === scope) { inFlight.current = false; setSaving(false); }
    }
  };

  if (!allowed) {
    return <p className="menu-design-error">Apenas o dono ou gerente edita o design do totem.</p>;
  }

  return (
    <div className="theme-editor menu-design totem-design" data-testid="totem-design-editor">
      <header className="theme-editor-header menu-design-header">
        <div>
          <span className="theme-eyebrow">TOTEM DO SALÃO</span>
          <h1><MonitorPlay size={21} /> Design do Totem</h1>
          <p>Visual, acesso e usuários do totem — separado do cardápio do cliente e da mesa.</p>
        </div>
        <span className="menu-design-independent"><CheckCheck size={15} /> {draft.followApp ? 'Seguindo o app' : 'Tema próprio'}</span>
      </header>
      <div className="menu-design-layout totem-design-layout">
        <main className="menu-design-controls" aria-label="Design do totem">
          {!loading && (
            <TotemWelcomePanel
              securityContext={securityContext}
              tenantId={tenant.id}
              theme={tenant.theme ? { ...DEFAULT_MENU_THEME, background: effective.colors.pageBg, accent: effective.colors.addButtonBg, accentText: effective.colors.addButtonText, text: effective.colors.productCardText, surface: effective.colors.productCardBg } : DEFAULT_MENU_THEME}
              slug={tenant.slug}
              storeName={tenant.theme?.storeName || tenant.name}
              afterAccess={<TotemUsersPanel securityContext={securityContext} tenantId={tenant.id} />}
            />
          )}

          <fieldset disabled={loading || saving || loadFailed}>
          <label className="menu-design-section"><input type="checkbox" role="switch" checked={draft.followApp === true} onChange={event => setDraft({ ...effective, followApp: event.target.checked, ...(!event.target.checked && !effective.templateId ? { templateId: 'custom' } : {}) })} /> Seguir o tema do Design do App</label>
          <fieldset disabled={draft.followApp === true || loading || saving || loadFailed}>
          <TemplateGallery selectedTemplateId={saved.templateId || null} draftTemplateId={draft.templateId || null} tenantId={tenant.id} category={tenant.category} savedTheme={tenant.theme} draftTheme={tenant.theme} products={previewProducts} onApply={template => setDraft({ ...totemFromTokens(template.tokens), followApp: false, templateId: template.id })} renderPreview={template => <MenuThemePreview theme={menuFromTokens(template.tokens)} totemDesign={totemFromTokens(template.tokens)} storeName={tenant.name} products={previewProducts} categories={categories} device="tablet" />} />
          <section className="menu-design-section" data-testid="totem-design-themes">
            <div className="menu-design-section-title">
              <Sparkles size={18} />
              <div>
                <h2>Temas do totem</h2>
                <p>Comece por um modelo. Depois você pode ajustar cada cor.</p>
              </div>
            </div>
            <div className="totem-theme-grid">
              {TOTEM_THEME_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  className="totem-theme-swatch"
                  data-testid={`totem-theme-${preset.id}`}
                  aria-pressed={draft.preset === preset.id}
                  onClick={() => applyPreset(preset.id)}
                  style={{ background: preset.design.colors.pageBg, color: preset.design.colors.productCardText }}
                >
                  <span style={{ background: preset.design.colors.addButtonBg }} />
                  <strong>{preset.name}</strong>
                  <em>{preset.description}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="menu-design-section" data-testid="totem-design-colors">
            <div className="menu-design-section-title">
              <Palette size={18} />
              <div>
                <h2>Personalização livre</h2>
                <p>Cada elemento do cardápio do totem tem a sua cor. O servidor aceita só hexadecimal.</p>
              </div>
            </div>
            <div className="menu-design-color-grid">
              {TOTEM_COLOR_KEYS.map(key => (
                <label key={key} className="menu-design-color">
                  <span>{TOTEM_COLOR_LABELS[key]}</span>
                  <span>
                    <input type="color" aria-label={TOTEM_COLOR_LABELS[key]} value={effective.colors[key]} onChange={event => update({ colors: { [key]: event.target.value } })} />
                    <code>{effective.colors[key].toUpperCase()}</code>
                  </span>
                </label>
              ))}
            </div>
            <label className="totem-radius">
              Raio do banner: {effective.bannerRadius} px
              <input type="range" min={0} max={48} value={effective.bannerRadius} aria-label="Raio do banner" onChange={event => update({ bannerRadius: Number(event.target.value) })} />
            </label>
            <button type="button" className="theme-secondary totem-restore" data-testid="totem-design-restore" onClick={restoreTheme}>
              <RotateCcw size={15} /> Restaurar tema
            </button>
          </section>

          </fieldset>
          </fieldset>
          {issues.length > 0 && <p role="status">Melhore o contraste para 4.5:1: {issues.join('; ')}.</p>}
          <div className="menu-design-save">
            {error && <p className="menu-design-error" role="alert">{error}</p>}
            {notice && <p className="menu-design-notice" role="status">{notice}</p>}
            <button type="button" className="theme-primary" data-testid="totem-design-save" disabled={saving || loading || loadFailed || issues.length > 0 || same(draft, saved)} onClick={() => void save()}>
              {saving ? 'Salvando…' : 'Salvar design do totem'}
            </button>
          </div>
        </main>
        <aside className="menu-design-preview-col" data-testid="totem-design-preview">
          <MenuThemePreview theme={menuFromTotem(effective)} totemDesign={effective} storeName={tenant.theme.storeName || tenant.name} storeLogoUrl={tenant.theme.logoUrl} products={previewProducts} categories={categories} device="tablet" />
        </aside>
      </div>
    </div>
  );
}
