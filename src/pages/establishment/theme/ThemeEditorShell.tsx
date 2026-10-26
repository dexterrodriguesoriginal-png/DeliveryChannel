import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Eye,
  Grid2X2,
  Layers,
  Palette,
  Paintbrush,
  Save,
  SlidersHorizontal,
  Type,
  Undo2,
} from 'lucide-react';
import { Tenant } from '../../../types';
import { StoreTemplate } from '../../../types/theme';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { themeService } from '../../../services/themeService';
import { productRepository } from '../../../repositories/productRepository';
import { safeImageUrl, validateHexColor } from '../../../lib/theme/themeEngine';
import { LiveStorePreview } from '../../../components/establishment/theme/LiveStorePreview';
import { ThemedProductItem } from '../../../components/storefront/ThemedProductList';
import { useThemeDraft } from './useThemeDraft';
import { useThemeControls } from './useThemeControls';
import { ThemeEditorContext } from './ThemeEditorContext';
import { TemplateGallery } from './TemplateGallery';
import { IdentityTab } from './tabs/IdentityTab';
import { ColorsTab } from './tabs/ColorsTab';
import { BackgroundsTab } from './tabs/BackgroundsTab';
import { FontsTab } from './tabs/FontsTab';
import { StyleTab } from './tabs/StyleTab';
import { resolveSegment } from '../../../lib/theme/previewProducts';
import './themeEditor.css';

const TABS = [
  { id: 'models', label: 'Modelos', icon: Grid2X2 },
  { id: 'identity', label: 'Identidade', short: 'Marca', icon: Layers },
  { id: 'colors', label: 'Cores', icon: Palette },
  { id: 'backgrounds', label: 'Fundos', icon: Paintbrush },
  { id: 'fonts', label: 'Fontes', icon: Type },
  { id: 'style', label: 'Estilo', icon: SlidersHorizontal },
  { id: 'preview', label: 'Prévia', icon: Eye },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function ThemeEditorShell({ tenant }: { tenant: Tenant }) {
  const { securityContext, setActiveTenant } = useAuth();
  const { showToast } = useToast();
  const draft = useThemeDraft(tenant.theme);
  const controls = useThemeControls(draft.draftTokens, draft.updateTokens);
  const [tab, setTab] = useState<Tab>('models');
  const [products, setProducts] = useState<ThemedProductItem[]>([]);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const scrollRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    productRepository
      .getProducts(securityContext, tenant.id)
      .then((items) => {
        if (active) setProducts(items.filter((p) => p.isActive !== false).slice(0, 4));
      })
      .catch(() => {
        if (active) setProducts([]);
      });
    return () => {
      active = false;
    };
  }, [tenant.id, securityContext]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tab]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (draft.isDirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [draft.isDirty]);
  const apply = (template: StoreTemplate) => {
    draft.applyTemplate(template);
    setTab('identity');
    showToast({
      type: 'info',
      title: 'Modelo no rascunho',
      message: 'Sua marca foi preservada. Clique em Salvar quando estiver tudo do seu jeito.',
    });
  };
  const save = async () => {
    if (!draft.isDirty || saveInFlight.current) return;
    if (!draft.draftTheme.storeName?.trim()) {
      showToast({
        type: 'error',
        title: 'Informe o nome da loja',
        message: 'O nome aparece para seus clientes.',
      });
      setTab('identity');
      return;
    }
    if (Object.values(draft.draftTokens.palette).some((color) => !validateHexColor(color))) {
      showToast({
        type: 'error',
        title: 'Confira as cores',
        message: 'Uma das cores precisa ser corrigida antes de salvar.',
      });
      setTab('colors');
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    const submitted = draft.draftTheme;
    const cleanImage = (url?: string) => (url ? safeImageUrl(url) || '' : '');
    const backgrounds = { ...draft.draftTokens.backgrounds };
    for (const surface of ['general', 'header', 'card'] as const) {
      backgrounds[surface] = {
        ...backgrounds[surface],
        imageUrl: backgrounds[surface].imageUrl
          ? cleanImage(backgrounds[surface].imageUrl)
          : undefined,
      };
    }
    try {
      const saved = await themeService.updateTheme(securityContext, tenant.id, {
        ...submitted,
        logoUrl: cleanImage(submitted.logoUrl),
        bannerUrl: cleanImage(submitted.bannerUrl),
        tokens: { ...draft.draftTokens, backgrounds },
      });
      draft.markSaved(saved, submitted);
      setActiveTenant({ ...tenant, theme: saved });
      showToast({
        type: 'success',
        title: 'Design salvo',
        message: 'Sua loja já está com o novo visual.',
      });
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Não foi possível salvar',
        message:
          error instanceof Error
            ? error.message
            : 'Tente novamente. Suas alterações continuam aqui.',
      });
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };
  const navItems = (mobile = false) =>
    TABS.map((item) => (
      <button
        key={item.id}
        type="button"
        aria-current={tab === item.id ? 'page' : undefined}
        onClick={() => setTab(item.id)}
        disabled={saving}
        className={`theme-nav-item ${tab === item.id ? 'theme-nav-item-active' : ''}`}
      >
        <item.icon size={mobile ? 18 : 17} strokeWidth={1.7} />
        <span>{mobile && 'short' in item ? item.short : item.label}</span>
      </button>
    ));
  const preview = (
    <LiveStorePreview
      theme={draft.draftTheme}
      products={products}
      segmentId={resolveSegment(tenant.category)}
      isOpen={tenant.settings?.isOpen}
    />
  );
  return (
    <ThemeEditorContext.Provider value={{ ...draft, ...controls, activeTenant: tenant }}>
      <div className="theme-editor" data-testid="theme-editor">
        <header className="theme-editor-header">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800">
              <Paintbrush size={16} />
            </span>
            <h1 className="text-lg font-bold tracking-tight text-slate-900">Design do App</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">
            Veja como sua loja vai aparecer para seus clientes.
          </p>
        </header>
        <div className="theme-editor-body">
          <nav className="theme-desktop-nav" aria-label="Seções do editor">
            <p className="theme-eyebrow mb-4 px-3">SUA VITRINE</p>
            {navItems()}
            <div className="mt-auto px-3 pb-3 pt-8 text-[11px] leading-relaxed text-slate-400">
              Cada detalhe conta.
              <br />
              Deixe sua marca aparecer.
            </div>
          </nav>
          <main
            ref={scrollRef}
            data-theme-scroll
            className="theme-editor-content"
            aria-label="Conteúdo do editor"
          >
            <fieldset disabled={saving} className="min-w-0 border-0 p-0">
              <div hidden={tab !== 'models'}>
                <TemplateGallery
                  tenantId={tenant.id}
                  category={tenant.category}
                  savedTheme={tenant.theme}
                  draftTheme={draft.draftTheme}
                  products={products}
                  isStoreOpen={tenant.settings?.isOpen}
                  onApply={apply}
                />
              </div>
              {tab === 'identity' && <IdentityTab />}
              {tab === 'colors' && <ColorsTab />}
              {tab === 'backgrounds' && <BackgroundsTab />}
              {tab === 'fonts' && <FontsTab />}
              {tab === 'style' && <StyleTab />}
              {tab === 'preview' && (
                <div className="mx-auto max-w-lg space-y-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      Assim seus clientes vão ver
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Confira seu novo visual antes de salvar.
                    </p>
                  </div>
                  {preview}
                </div>
              )}
            </fieldset>
          </main>
          {tab !== 'models' && tab !== 'preview' && (
            <aside className="theme-editor-preview" aria-label="Prévia da sua loja">
              {preview}
            </aside>
          )}
        </div>
        <footer className="theme-editor-actions">
          <span
            role="status"
            className={`theme-save-status ${draft.isDirty ? 'text-amber-700' : 'text-slate-500'}`}
          >
            {draft.isDirty ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Alterações não salvas
              </>
            ) : (
              <>
                <Check size={14} /> Tudo salvo
              </>
            )}
          </span>
          <div className="theme-action-buttons">
            <button
              type="button"
              disabled={!draft.canUndo || saving}
              onClick={draft.undo}
              className="theme-secondary"
            >
              <Undo2 size={14} />
              <span>Desfazer</span>
            </button>
            <button
              type="button"
              disabled={!draft.isDirty || saving}
              onClick={draft.cancel}
              className="theme-secondary"
            >
              Cancelar alterações
            </button>
            <button
              type="button"
              disabled={!draft.isDirty || saving}
              onClick={save}
              className="theme-primary"
            >
              <Save size={14} />
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </footer>
        <nav className="theme-mobile-nav" aria-label="Seções do editor no celular">
          {navItems(true)}
        </nav>
      </div>
    </ThemeEditorContext.Provider>
  );
}
