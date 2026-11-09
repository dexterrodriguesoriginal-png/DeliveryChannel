import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, MonitorPlay, Save, Trash2 } from 'lucide-react';
import type { SecurityContext } from '../../../../services/securityEngine';
import { totemWelcomeRepository, totemMediaFileError } from '../../../../repositories/totemWelcomeRepository';
import {
  DEFAULT_TOTEM_WELCOME,
  MAX_TOTEM_SLIDES,
  TOTEM_BUTTON_STYLES,
  TOTEM_BUTTON_TEXT_PRESETS,
  MAX_TOTEM_BUTTON_TEXT,
  MIN_TOTEM_IMAGE_SECONDS,
  MAX_TOTEM_IMAGE_SECONDS,
  normalizeTotemWelcome,
  resolvedTotemButtonColors,
  totemButtonContrastWarning,
  type TotemButtonStyle,
  type TotemWelcomeSettings,
  type TotemWelcomeSlide,
} from '../../../../lib/menu/totemWelcome';
import { MIN_IDLE_TIMEOUT_SECONDS, MAX_IDLE_TIMEOUT_SECONDS } from '../../../../hooks/useIdleTimer';
import { TotemCapaScreen } from '../../../../components/client/totem/TotemCapaScreen';
import { TotemAccessCard } from './TotemAccessCard';
import type { MenuTheme } from '../../../../types/menuTheme';
import { DEFAULT_MENU_THEME } from '../../../../lib/theme/menuTheme';
import './totemWelcomePanel.css';

const same = (a: TotemWelcomeSettings, b: TotemWelcomeSettings) =>
  JSON.stringify(normalizeTotemWelcome(a)) === JSON.stringify(normalizeTotemWelcome(b));

export function TotemWelcomePanel({
  securityContext,
  tenantId,
  theme = DEFAULT_MENU_THEME,
  slug = '',
  storeName = '',
}: {
  securityContext: SecurityContext;
  tenantId: string;
  theme?: MenuTheme;
  slug?: string;
  storeName?: string;
}) {
  const [saved, setSaved] = useState<TotemWelcomeSettings>({ ...DEFAULT_TOTEM_WELCOME, slides: [] });
  const [draft, setDraft] = useState<TotemWelcomeSettings>({ ...DEFAULT_TOTEM_WELCOME, slides: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = !same(saved, draft);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setNotice('');
    totemWelcomeRepository.load(securityContext, tenantId).then(settings => {
      if (active) { setSaved(settings); setDraft(settings); }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a capa do totem.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, securityContext.userId, securityContext.userRole, securityContext.tenantId]);

  const patch = (partial: Partial<TotemWelcomeSettings>) => {
    setDraft(current => ({ ...current, ...partial }));
    setNotice('');
  };

  const colors = useMemo(() => resolvedTotemButtonColors(draft, theme), [draft, theme]);
  const contrastWarning = totemButtonContrastWarning(colors.color, colors.background);

  const pickFile = async (file: File | undefined) => {
    if (!file || inFlight.current) return;
    if (draft.slides.length >= MAX_TOTEM_SLIDES) {
      setError(`A capa aceita no máximo ${MAX_TOTEM_SLIDES} mídias.`);
      return;
    }
    const problem = totemMediaFileError(file);
    if (problem) { setError(problem); return; }
    inFlight.current = true; setUploading(true); setError(''); setNotice('');
    try {
      const uploaded = await totemWelcomeRepository.uploadSlide(securityContext, tenantId, file);
      setDraft(current => ({ ...current, slides: [...current.slides, uploaded] }));
      setNotice('Mídia enviada. Clique em “Salvar capa do totem” para publicar.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar a mídia.');
    } finally {
      setUploading(false); inFlight.current = false;
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const moveSlide = (index: number, direction: -1 | 1) => {
    const next = index + direction;
    if (next < 0 || next >= draft.slides.length) return;
    const slides = draft.slides.slice();
    const [item] = slides.splice(index, 1);
    slides.splice(next, 0, item);
    patch({ slides });
  };

  const removeSlide = (index: number) => {
    patch({ slides: draft.slides.filter((_, i) => i !== index) });
  };

  const save = async () => {
    if (loading || inFlight.current || !dirty) return;
    inFlight.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const settings = await totemWelcomeRepository.save(securityContext, tenantId, draft);
      setSaved(settings); setDraft(settings); setNotice('Capa do totem salva.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar. Suas alterações continuam aqui.');
    } finally { setSaving(false); inFlight.current = false; }
  };

  const useThemeColors = !draft.buttonBg && !draft.buttonFg;
  const busy = loading || saving || uploading;
  const presetMatch = TOTEM_BUTTON_TEXT_PRESETS.includes(draft.buttonText as typeof TOTEM_BUTTON_TEXT_PRESETS[number]);

  return (
    <section className="menu-design-section" data-testid="totem-welcome-panel">
      <div className="menu-design-section-title">
        <MonitorPlay size={18} />
        <div>
          <h2>Capa do totem do salão</h2>
          <p>Tela de boas-vindas do dispositivo de balcão em /totem/{'{slug}'}. O cardápio da mesa (QR) não muda.</p>
        </div>
      </div>
      {error && <div role="alert" className="menu-design-error">{error}</div>}

      <TotemAccessCard slug={slug} storeName={storeName} />

      <div className="totem-welcome-layout">
        <div className="totem-welcome-settings">
          <h3>Carrossel</h3>
          <p className="totem-welcome-hint">Fotos e vídeos em tela cheia, sem nome ou logo por cima. Imagens trocam no tempo definido; vídeos rodam até o fim. JPG, PNG, WEBP (até 5 MB) ou MP4/WEBM (até 50 MB, 5 min).</p>
          <ul className="totem-welcome-slides">
            {draft.slides.length === 0 && <li className="totem-welcome-empty">Nenhuma mídia ainda. O fundo do tema aparece até você enviar as fotos.</li>}
            {draft.slides.map((slide: TotemWelcomeSlide, index: number) => (
              <li key={`${slide.url}-${index}`} className="totem-welcome-slide">
                {slide.kind === 'VIDEO'
                  ? <video src={slide.url} muted playsInline preload="metadata" />
                  : <img src={slide.url} alt="" referrerPolicy="no-referrer" />}
                <span>{slide.kind === 'VIDEO' ? 'Vídeo' : 'Imagem'} {index + 1}</span>
                <div className="totem-welcome-slide-actions">
                  <button type="button" aria-label={`Subir mídia ${index + 1}`} disabled={index === 0} onClick={() => moveSlide(index, -1)}><ArrowUp size={14} /></button>
                  <button type="button" aria-label={`Descer mídia ${index + 1}`} disabled={index === draft.slides.length - 1} onClick={() => moveSlide(index, 1)}><ArrowDown size={14} /></button>
                  <button type="button" aria-label={`Remover mídia ${index + 1}`} onClick={() => removeSlide(index)}><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
          <fieldset disabled={busy} className="menu-design-cover-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              aria-label="Enviar mídia da capa do totem"
              hidden
              onChange={event => void pickFile(event.target.files?.[0])}
            />
            <button type="button" className="theme-secondary" disabled={draft.slides.length >= MAX_TOTEM_SLIDES} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={15} />{uploading ? 'Enviando…' : 'Enviar foto ou vídeo'}
            </button>
          </fieldset>
          <label className="totem-welcome-field">
            Tempo de cada imagem (segundos)
            <input
              type="number"
              min={MIN_TOTEM_IMAGE_SECONDS}
              max={MAX_TOTEM_IMAGE_SECONDS}
              aria-label="Tempo de cada imagem em segundos"
              value={draft.imageSeconds}
              disabled={busy}
              onChange={event => patch({ imageSeconds: Number(event.target.value) })}
            />
          </label>

          <h3>Botão de começar</h3>
          <fieldset disabled={busy} role="radiogroup" aria-label="Texto do botão" className="totem-welcome-presets">
            {TOTEM_BUTTON_TEXT_PRESETS.map(text => (
              <label key={text}>
                <input
                  type="radio"
                  name="totem-button-text"
                  checked={draft.buttonText === text}
                  onChange={() => patch({ buttonText: text })}
                />
                {text}
              </label>
            ))}
            <label>
              <input
                type="radio"
                name="totem-button-text"
                checked={!presetMatch}
                onChange={() => { if (presetMatch) patch({ buttonText: 'Comece aqui' }); }}
              />
              Texto personalizado
            </label>
          </fieldset>
          <label className="totem-welcome-field">
            Texto do botão
            <input
              type="text"
              maxLength={MAX_TOTEM_BUTTON_TEXT}
              aria-label="Texto personalizado do botão"
              value={draft.buttonText}
              disabled={busy}
              onChange={event => patch({ buttonText: event.target.value })}
            />
          </label>
          <fieldset disabled={busy} role="radiogroup" aria-label="Estilo do botão" className="totem-welcome-styles">
            {TOTEM_BUTTON_STYLES.map(style => (
              <label key={style.id}>
                <input
                  type="radio"
                  name="totem-button-style"
                  aria-label={style.label}
                  checked={draft.buttonStyle === style.id}
                  onChange={() => patch({ buttonStyle: style.id as TotemButtonStyle })}
                />
                <strong>{style.label}</strong>
                <small>{style.hint}</small>
              </label>
            ))}
          </fieldset>

          <h3>Cores do botão</h3>
          <label className="totem-welcome-field totem-welcome-check">
            <input
              type="checkbox"
              aria-label="Usar cores do tema"
              checked={useThemeColors}
              disabled={busy}
              onChange={event => {
                if (event.target.checked) patch({ buttonBg: null, buttonFg: null });
                else patch({ buttonBg: theme.accent, buttonFg: theme.accentText });
              }}
            />
            Usar cores do tema do cardápio
          </label>
          <div className="totem-welcome-colors">
            <label className="menu-design-color">
              <span>Fundo do botão</span>
              <span>
                <input
                  type="color"
                  aria-label="Cor de fundo do botão"
                  disabled={busy || useThemeColors}
                  value={colors.background}
                  onChange={event => patch({ buttonBg: event.target.value, buttonFg: draft.buttonFg ?? theme.accentText })}
                />
                <code>{colors.background.toUpperCase()}</code>
              </span>
            </label>
            <label className="menu-design-color">
              <span>Texto do botão</span>
              <span>
                <input
                  type="color"
                  aria-label="Cor do texto do botão"
                  disabled={busy || useThemeColors}
                  value={colors.color}
                  onChange={event => patch({ buttonFg: event.target.value, buttonBg: draft.buttonBg ?? theme.accent })}
                />
                <code>{colors.color.toUpperCase()}</code>
              </span>
            </label>
          </div>
          {contrastWarning && <div role="status" className="menu-design-contrast" data-testid="totem-button-contrast">{contrastWarning}</div>}

          <h3>Inatividade</h3>
          <label className="totem-welcome-field">
            Voltar à capa após (segundos)
            <input
              type="number"
              min={MIN_IDLE_TIMEOUT_SECONDS}
              max={MAX_IDLE_TIMEOUT_SECONDS}
              step={5}
              aria-label="Tempo de inatividade em segundos"
              value={draft.idleSeconds}
              disabled={busy}
              onChange={event => patch({ idleSeconds: Number(event.target.value) })}
            />
          </label>
          <p className="totem-welcome-hint">Padrão 90 s. Antes de limpar o pedido, o totem pergunta “Ainda está aí?”. A volta nunca interrompe a confirmação do pedido.</p>
        </div>

        <aside className="totem-welcome-preview" aria-label="Prévia da capa do totem">
          <span className="theme-eyebrow">PRÉVIA DA CAPA</span>
          <div className="totem-welcome-preview-frame" data-testid="totem-capa-preview">
            <TotemCapaScreen
              settings={draft}
              buttonBackground={colors.background}
              buttonColor={colors.color}
              backdrop={theme.background}
              onStart={() => undefined}
            />
          </div>
        </aside>
      </div>

      <div className="theme-action-buttons">
        <span role="status" className="theme-save-status">{notice || (dirty ? 'Alterações não salvas' : '')}</span>
        <button type="button" className="theme-primary" disabled={!dirty || busy} onClick={() => void save()}>
          <Save size={15} />{saving ? 'Salvando…' : 'Salvar capa do totem'}
        </button>
      </div>
    </section>
  );
}
