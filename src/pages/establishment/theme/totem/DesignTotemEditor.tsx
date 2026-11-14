import { ScaledPreview } from '../../../../components/common/ScaledPreview';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CheckCheck, MonitorPlay, Palette, RotateCcw, Sparkles } from 'lucide-react';
import { useAuth } from '../../../../context/AuthContext';
import type { Tenant } from '../../../../types';
import { DEFAULT_MENU_THEME } from '../../../../lib/theme/menuTheme';
import {
  DEFAULT_TOTEM_DESIGN, TOTEM_COLOR_KEYS, TOTEM_COLOR_LABELS, TOTEM_THEME_PRESETS,
  designFromPreset, normalizeTotemDesign, totemDesignCssVars, type TotemDesign,
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
  const inFlight = useRef(false);

  useEffect(() => {
    if (!active || !allowed) return;
    let alive = true;
    setLoading(true); setError(''); setNotice('');
    totemDesignRepository.load(securityContext, tenant.id)
      .then(design => { if (alive) { setDraft(design); setSaved(design); } })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o design.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active, allowed, tenant.id, securityContext.userId, securityContext.userRole]);

  const update = (partial: Partial<TotemDesign> | { colors: Partial<TotemDesign['colors']> }) => {
    setDraft(current => {
      const next = { ...current, colors: { ...current.colors } };
      if ('preset' in partial && partial.preset) next.preset = partial.preset;
      if ('bannerRadius' in partial && typeof partial.bannerRadius === 'number') next.bannerRadius = partial.bannerRadius;
      if ('colors' in partial && partial.colors) next.colors = { ...next.colors, ...partial.colors };
      return next;
    });
    setNotice('');
  };

  const applyPreset = (id: string) => {
    setDraft(designFromPreset(id));
    setNotice('');
  };

  const restoreTheme = () => setDraft(designFromPreset(draft.preset));

  const save = async () => {
    if (inFlight.current || same(draft, saved)) return;
    inFlight.current = true; setSaving(true); setError('');
    try {
      const stored = await totemDesignRepository.save(securityContext, tenant.id, draft);
      setSaved(stored);
      setDraft(current => same(current, draft) ? stored : current);
      setNotice('Design do totem salvo.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.');
    } finally {
      inFlight.current = false; setSaving(false);
    }
  };

  if (!allowed) {
    return <p className="menu-design-error">Apenas o dono ou gerente edita o design do totem.</p>;
  }

  const vars = totemDesignCssVars(draft);

  return (
    <div className="theme-editor menu-design totem-design" data-testid="totem-design-editor">
      <header className="theme-editor-header menu-design-header">
        <div>
          <span className="theme-eyebrow">TOTEM DO SALÃO</span>
          <h1><MonitorPlay size={21} /> Design do Totem</h1>
          <p>Visual, acesso e usuários do totem — separado do cardápio do cliente e da mesa.</p>
        </div>
        <span className="menu-design-independent"><CheckCheck size={15} /> Independente do app</span>
      </header>
      <div className="menu-design-layout totem-design-layout">
        <main className="menu-design-controls" aria-label="Design do totem">
          {!loading && (
            <TotemWelcomePanel
              securityContext={securityContext}
              tenantId={tenant.id}
              theme={tenant.theme ? { ...DEFAULT_MENU_THEME, background: draft.colors.pageBg, accent: draft.colors.addButtonBg, accentText: draft.colors.addButtonText, text: draft.colors.productCardText, surface: draft.colors.productCardBg } : DEFAULT_MENU_THEME}
              slug={tenant.slug}
              storeName={tenant.theme?.storeName || tenant.name}
              afterAccess={<TotemUsersPanel securityContext={securityContext} tenantId={tenant.id} />}
            />
          )}

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
                    <input type="color" aria-label={TOTEM_COLOR_LABELS[key]} value={draft.colors[key]} onChange={event => update({ colors: { [key]: event.target.value } })} />
                    <code>{draft.colors[key].toUpperCase()}</code>
                  </span>
                </label>
              ))}
            </div>
            <label className="totem-radius">
              Raio do banner: {draft.bannerRadius} px
              <input type="range" min={0} max={48} value={draft.bannerRadius} aria-label="Raio do banner" onChange={event => update({ bannerRadius: Number(event.target.value) })} />
            </label>
            <button type="button" className="theme-secondary totem-restore" data-testid="totem-design-restore" onClick={restoreTheme}>
              <RotateCcw size={15} /> Restaurar tema
            </button>
          </section>

          <div className="menu-design-save">
            {error && <p className="menu-design-error" role="alert">{error}</p>}
            {notice && <p className="menu-design-notice" role="status">{notice}</p>}
            <button type="button" className="theme-primary" data-testid="totem-design-save" disabled={saving || loading || same(draft, saved)} onClick={() => void save()}>
              {saving ? 'Salvando…' : 'Salvar design do totem'}
            </button>
          </div>
        </main>
        <aside className="menu-design-preview-col" data-testid="totem-design-preview">
          <ScaledPreview width={390} height={844}><div className="totem-design-preview" style={{ ...vars, height: 844 } as CSSProperties}>
            <div className="totem-preview-page">
              <aside className="totem-preview-sidebar">
                <span>Cervejas</span>
                <span className="is-active">Vinhos</span>
                <span>Petiscos</span>
              </aside>
              <div className="totem-preview-main">
                <div className="totem-preview-banner" />
                <article className="totem-preview-product">
                  <div className="totem-preview-photo" />
                  <div>
                    <strong>Chopp Pilsen</strong>
                    <b>R$ 12,90</b>
                    <button type="button">Adicionar</button>
                  </div>
                </article>
              </div>
            </div>
            <footer className="totem-preview-order">
              <span>Seu pedido</span>
              <button type="button">Finalizar pedido</button>
            </footer>
          </div></ScaledPreview>
        </aside>
      </div>
    </div>
  );
}
