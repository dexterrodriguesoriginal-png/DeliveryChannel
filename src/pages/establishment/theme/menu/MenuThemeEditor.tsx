import { useUnsavedChanges } from '../../../../lib/ui/useUnsavedChanges';
import { DEFAULT_MENU_HEADER } from '../../../../lib/menu/menuHeader';
import { DEFAULT_MENU_OPTIONS } from '../../../../lib/menu/menuOptions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, LayoutGrid, Palette, Save, Smartphone, Sparkles, Tablet, Type } from 'lucide-react';
import type { Category, Tenant } from '../../../../types';
import type { MenuTheme } from '../../../../types/menuTheme';
import type { ThemedProductItem } from '../../../../components/storefront/ThemedProductList';
import { useAuth } from '../../../../context/AuthContext';
import { menuThemeRepository, canManageMenuTheme } from '../../../../repositories/menuThemeRepository';
import { productRepository } from '../../../../repositories/productRepository';
import { categoryRepository } from '../../../../repositories/categoryRepository';
import { DEFAULT_MENU_THEME, MENU_COLOR_KEYS, MENU_FONTS, MENU_TEMPLATES, menuThemeContrastIssues } from '../../../../lib/theme/menuTheme';
import { resolveSegment, sampleProducts } from '../../../../lib/theme/previewProducts';
import { MenuThemePreview } from './MenuThemePreview';
import { MenuOptionsPanel } from './MenuOptionsPanel';
import { BestSellersPanel } from './BestSellersPanel';
import { MenuHeaderPanel } from './MenuHeaderPanel';
import { useBottomActionsOffset, useFloatingLeftOf } from '../../../../lib/ui/bottomActionsOffset';
import '../themeEditor.css';
import './menuThemeEditor.css';

const COLOR_LABELS = ['Fundo', 'Cartões', 'Texto', 'Botões e destaques', 'Texto dos botões', 'Categoria selecionada'];
const same = (a: MenuTheme, b: MenuTheme) => JSON.stringify(a) === JSON.stringify(b);

export function MenuThemeEditor({ tenant, active = true }: { tenant: Tenant; active?: boolean }) {
  const { securityContext } = useAuth();
  const allowed = canManageMenuTheme(securityContext, tenant.id);
  const scope = `${tenant.id}:${securityContext.userId}:${securityContext.userRole}:${securityContext.tenantId}`;
  const scopeRef = useRef(scope);
  const epochRef = useRef(0);
  if (scopeRef.current !== scope) { scopeRef.current = scope; epochRef.current += 1; }
  const epoch = epochRef.current;
  const mountedRef = useRef(true);
  const [saved, setSaved] = useState<MenuTheme>({ ...DEFAULT_MENU_THEME });
  const [draft, setDraft] = useState<MenuTheme>({ ...DEFAULT_MENU_THEME });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  const [device, setDevice] = useState<'phone' | 'tablet'>('phone');
  const [products, setProducts] = useState<ThemedProductItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const inFlight = useRef(false);
  const actionsRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  useBottomActionsOffset(actionsRef, active);
  useFloatingLeftOf(contentRef, 12, active);
  const dirty = !same(saved, draft);
  useUnsavedChanges(dirty);
  const [headerState, setHeaderState] = useState({ draft: { ...DEFAULT_MENU_HEADER }, dirty: false, loading: true });
  const [optionsState, setOptionsState] = useState({ draft: { ...DEFAULT_MENU_OPTIONS }, dirty: false, loading: true });
  const onHeaderDraft = useCallback((draft: typeof DEFAULT_MENU_HEADER, dirty: boolean, loading: boolean) => setHeaderState({ draft, dirty, loading }), []);
  const onOptionsDraft = useCallback((draft: typeof DEFAULT_MENU_OPTIONS, dirty: boolean, loading: boolean) => setOptionsState({ draft, dirty, loading }), []);
  const anyDirty = dirty || headerState.dirty || optionsState.dirty;
  const anyLoading = loading || loadFailed || headerState.loading || optionsState.loading;
  const issues = menuThemeContrastIssues(draft);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadFailed(false); setError(''); setNotice(''); setSaving(false); inFlight.current = false;
    setSaved({ ...DEFAULT_MENU_THEME }); setDraft({ ...DEFAULT_MENU_THEME }); setProducts([]); setCategories([]);
    if (!allowed) { setLoading(false); return; }
    menuThemeRepository.load(securityContext, tenant.id).then(theme => {
      if (active && epochRef.current === epoch) { setSaved(theme); setDraft(theme); }
    }).catch(reason => {
      if (active && epochRef.current === epoch) { setLoadFailed(true); setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o design.'); }
    }).finally(() => { if (active && epochRef.current === epoch) setLoading(false); });
    productRepository.getProducts(securityContext, tenant.id).then(items => {
      if (active && epochRef.current === epoch) setProducts(items.filter(item => item.isActive !== false).slice(0, 4));
    }).catch(() => {});
    categoryRepository.getCategories(securityContext, tenant.id).then(items => {
      if (active && epochRef.current === epoch) setCategories(items.filter(item => item.isActive !== false));
    }).catch(() => {});
    return () => { active = false; };
    // Identity primitives isolate drafts even when the auth provider recreates the context object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, allowed, loadAttempt]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const update = (patch: Partial<MenuTheme>) => { setDraft(previous => ({ ...previous, ...patch })); setNotice(''); };
  const save = async () => {
    if (!allowed || loading || loadFailed || inFlight.current || !dirty) return;
    inFlight.current = true; setSaving(true); setError(''); setNotice('');
    const submitted = draft;
    try {
      const theme = await menuThemeRepository.save(securityContext, tenant.id, submitted);
      if (mountedRef.current && epochRef.current === epoch) { setSaved(theme); setDraft(current => same(current, submitted) ? theme : current); setNotice('Design do cardápio salvo.'); }
    } catch (reason) {
      if (mountedRef.current && epochRef.current === epoch) setError(reason instanceof Error ? reason.message : 'Não foi possível salvar. Suas alterações continuam aqui.');
    } finally {
      if (mountedRef.current && epochRef.current === epoch) { setSaving(false); inFlight.current = false; }
    }
  };
  if (!allowed) return <div className="p-6 text-sm text-slate-600" role="status">Apenas o dono ou gerente desta loja pode editar o design do cardápio.</div>;
  const previewProducts = products.length ? products : sampleProducts(resolveSegment(tenant.category));
  return <div className="theme-editor menu-design-editor" data-testid="menu-theme-editor">
    <header className="theme-editor-header menu-design-header"><div><span className="theme-eyebrow">À MESA, DO SEU JEITO</span><h1><Sparkles size={21} /> Design do Cardápio</h1><p>Cores, fonte e formato próprios do cardápio por QR. Alterar o app não altera este design; cada painel tem seu botão de salvar.</p></div><button type="button" className="theme-secondary" onClick={() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Ver prévia do cardápio</button><span className="menu-design-independent"><CheckCheck size={15} /> Independente do app</span></header>
    <div className="menu-design-body">
      <main ref={contentRef} className="menu-design-controls" aria-label="Design do cardápio">
        {loading ? <p role="status" className="menu-design-message">Carregando o design do cardápio…</p> : <>
          {error && <div role="alert" className="menu-design-error">{error}{loadFailed && <button type="button" className="theme-secondary mt-3" onClick={() => setLoadAttempt(value => value + 1)}>Tentar novamente</button>}</div>}
          <fieldset disabled={saving || loadFailed}>
            <section className="menu-design-section"><div className="menu-design-section-title"><LayoutGrid size={18} /><div><h2>Comece por um modelo</h2><p>O mesmo catálogo, com uma personalidade nova.</p></div></div>
              <div className="menu-design-template-grid">{MENU_TEMPLATES.map(template => <button type="button" key={template.id} aria-label={`Usar modelo ${template.name}`} aria-pressed={same(draft, template.theme)} className={`menu-design-template ${same(draft, template.theme) ? 'is-selected' : ''}`} onClick={() => update(template.theme)}>
                <span className="menu-design-template-art" style={{ background: template.theme.background, color: template.theme.text }}><span className="menu-design-template-banner" style={{ background: template.theme.accent, color: template.theme.accentText }}>Seu próximo favorito.</span><span className="menu-design-template-mini"><i style={{ background: template.theme.categoryActiveBg }} /><i style={{ background: template.theme.surface }} /><i style={{ background: template.theme.surface }} /></span><span className="menu-design-swatches">{[template.theme.accent, template.theme.background, template.theme.text].map(color => <i key={color} style={{ background: color }} />)}</span></span>
                <span className="menu-design-template-copy"><strong>{template.name}{same(draft, template.theme) && <Check size={14} />}</strong><small>{template.description}</small></span>
              </button>)}</div>
            </section>
            <section className="menu-design-section"><div className="menu-design-section-title"><Palette size={18} /><div><h2>Suas cores</h2><p>Refine os detalhes e acompanhe a prévia ao lado.</p></div></div><div className="menu-design-color-grid">{MENU_COLOR_KEYS.map((key, index) => <label key={key} className="menu-design-color"><span>{COLOR_LABELS[index]}</span><span><input type="color" aria-label={COLOR_LABELS[index]} value={draft[key]} onChange={event => update({ [key]: event.target.value })} /><code>{draft[key].toUpperCase()}</code></span></label>)}</div>
              {issues.length > 0 && <div role="status" className="menu-design-contrast">Melhore o contraste para facilitar a leitura: {issues.join('; ')}.</div>}
            </section>
            <section className="menu-design-section"><div className="menu-design-section-title"><Type size={18} /><div><h2>Fonte e formato</h2><p>Detalhes que deixam o toque mais agradável.</p></div></div><div className="menu-design-format-grid"><label>Fonte<select className="theme-select" value={draft.fontFamily} onChange={event => update({ fontFamily: event.target.value })}>{MENU_FONTS.map(font => <option key={font}>{font}</option>)}</select></label><label>Cantos: {draft.radius} px<input type="range" aria-label="Arredondamento dos cantos" min="0" max="32" value={draft.radius} onChange={event => update({ radius: Number(event.target.value) })} /></label><label>Espaçamento<select className="theme-select" value={draft.layout} onChange={event => update({ layout: event.target.value as MenuTheme['layout'] })}><option value="comfortable">Confortável</option><option value="compact">Compacto</option></select></label></div></section>
          </fieldset>
        </>}
        {!loading && <BestSellersPanel securityContext={securityContext} tenantId={tenant.id} />}
        {!loading && <MenuHeaderPanel onDraftChange={onHeaderDraft} securityContext={securityContext} tenantId={tenant.id} />}
        {!loading && <MenuOptionsPanel onDraftChange={onOptionsDraft} securityContext={securityContext} tenantId={tenant.id} slug={tenant.slug} />}
      </main>
      <aside ref={previewRef} className="menu-design-live" aria-label="Prévia ao vivo do cardápio"><div className="menu-design-preview-toolbar"><div><span className="theme-eyebrow">PRÉVIA AO VIVO</span><h2>Comer com os olhos</h2><button type="button" className="theme-filter-chip" onClick={() => contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Voltar aos ajustes</button></div><div className="menu-design-device-toggle" role="group" aria-label="Formato da prévia"><button type="button" aria-label="Prévia no celular" aria-pressed={device === 'phone'} onClick={() => setDevice('phone')}><Smartphone size={17} /></button><button type="button" aria-label="Prévia no tablet" aria-pressed={device === 'tablet'} onClick={() => setDevice('tablet')}><Tablet size={17} /></button></div></div><MenuThemePreview storeLogoUrl={tenant.theme.logoUrl} storeTagline={tenant.theme.tagline} theme={draft} storeName={tenant.theme.storeName || tenant.name} categories={categories} header={headerState.draft} productColumns={optionsState.draft.productColumns || 2} products={previewProducts} device={device} /><p className="menu-design-preview-caption">{products.length ? 'Prévia com produtos do seu catálogo.' : 'Produtos ilustrativos. Seu catálogo continua o mesmo.'} As alterações aparecem aqui antes de salvar.</p></aside>
    </div>
    <footer ref={actionsRef} className="theme-editor-actions menu-design-actions"><span role="status" className="theme-save-status">{anyDirty ? 'Alterações não salvas — confira os painéis de aparência, capa/menu e opções' : anyLoading ? 'Confira o carregamento dos painéis' : notice || <><Check size={14} /> Tudo salvo</>}</span><div className="theme-action-buttons"><button type="button" className="theme-secondary" disabled={!dirty || saving || loading} onClick={() => { setDraft({ ...saved }); setError(''); setNotice(''); }}>Cancelar alterações</button><button type="button" className="theme-primary" disabled={!dirty || saving || loading} onClick={() => void save()}><Save size={15} />{saving ? 'Salvando…' : 'Salvar cardápio'}</button></div></footer>
  </div>;
}
