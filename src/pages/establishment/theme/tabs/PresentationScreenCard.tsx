import React, { useEffect, useRef, useState } from 'react';
import { Clapperboard } from 'lucide-react';
import { useThemeEditorContext } from '../ThemeEditorContext';
import { presentationRepository, type PresentationSettings } from '../../../../repositories/presentationRepository';
import { requestPresentationPreview } from '../../../../lib/theme/previewBridge';
import { clampImageSeconds, presentationPlan, prefersReducedMotion, PRESENTATION_DEFAULT_IMAGE_SECONDS, type PresentationPlan } from '../../../../lib/pwa/presentation';
import { StorePresentationScreen } from '../../../../components/pwa/StorePresentationScreen';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';

/** Só montado quando o módulo está habilitado e o usuário é OWNER/MANAGER. */
export function PresentationScreenCard() {
  const { activeTenant } = useThemeEditorContext();
  const [settings, setSettings] = useState<PresentationSettings | null>(null);
  const [seconds, setSeconds] = useState(PRESENTATION_DEFAULT_IMAGE_SECONDS);
  const [oncePerDay, setOncePerDay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [localRun, setLocalRun] = useState<{ plan: PresentationPlan; key: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    presentationRepository.get(activeTenant.id).then(value => {
      if (!alive) return;
      setSettings(value);
      setSeconds(value?.imageSeconds ?? PRESENTATION_DEFAULT_IMAGE_SECONDS);
      setOncePerDay(Boolean(value?.oncePerDay));
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Falha ao carregar a abertura.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [activeTenant.id]);

  const perform = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void perform(async () => {
      const saved = await presentationRepository.upload(activeTenant.id, file, { imageSeconds: seconds, oncePerDay });
      setSettings(saved); setSeconds(saved.imageSeconds);
    });
  };
  const preview = () => {
    if (!settings?.url) return;
    const media = { url: settings.url, mediaType: settings.mediaType,
      imageSeconds: clampImageSeconds(seconds), oncePerDay };
    if (requestPresentationPreview(media)) return;
    const plan = presentationPlan(media, { reducedMotion: prefersReducedMotion() });
    if (plan) setLocalRun({ plan, key: Date.now() });
  };
  const field: React.CSSProperties = {
    color: 'var(--dc-text-main)', borderColor: 'var(--dc-border)',
    background: 'var(--dc-bg-card-color)',
  };
  const action: React.CSSProperties = {
    background: 'var(--dc-primary)', color: 'var(--dc-button-text)',
    border: 'none', borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontWeight: 600,
  };
  return (
    <section data-testid="presentation-screen-card" aria-label="Abertura da loja"
      style={{ ...field, border: '1px solid var(--dc-border)', borderRadius: 18, padding: 18, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Clapperboard size={20} />
        <div>
          <h3 style={{ fontWeight: 700 }}>Abertura da loja</h3>
          <p style={{ fontSize: 12, opacity: 0.75 }}>Sua marca em tela cheia, depois do splash do celular. Imagem por 3 s ou vídeo de até 10 s.</p>
        </div>
      </div>
      {loading ? <p>Carregando…</p> : <>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div data-testid="presentation-thumb" style={{ width: 95, aspectRatio: '9/16', borderRadius: 12,
            overflow: 'hidden', background: 'var(--dc-bg-general-color)', border: '1px solid var(--dc-border)' }}>
            {settings?.url && settings.mediaType === 'IMAGE' && <img src={settings.url} alt="Prévia da imagem" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            {settings?.url && settings.mediaType === 'VIDEO' && <video src={settings.url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
          <div style={{ display: 'grid', gap: 7, fontSize: 13 }}>
            <strong data-testid="presentation-status">{settings?.url ? (settings.mediaType === 'VIDEO' ? 'Vídeo salvo' : 'Imagem salva') : 'Nenhuma mídia ativa'}</strong>
            <span>JPG, PNG, WebP até 3 MB · MP4 ou WebM até 15 MB / 10 s</span>
            <span>Se desabilitar a ferramenta, a mídia continuará salva.</span>
          </div>
        </div>
        {settings?.mediaType === 'IMAGE' && <label style={{ display: 'grid', gap: 6 }}>
          Tempo da imagem: {seconds.toLocaleString('pt-BR')} s
          <input type="range" min="1" max="5" step="0.5" value={seconds} onChange={e => setSeconds(Number(e.target.value))} data-testid="presentation-seconds" />
        </label>}
        {settings && <label style={{ display: 'flex', gap: 9 }}>
          <input type="checkbox" checked={oncePerDay} onChange={e => setOncePerDay(e.target.checked)} data-testid="presentation-once-per-day" />
          Mostrar no máximo uma vez por dia
        </label>}
        {error && <p role="alert" data-testid="presentation-error">{error}</p>}
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={onFile} data-testid="presentation-file" />
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <button type="button" style={action} disabled={busy} onClick={() => fileRef.current?.click()} data-testid="presentation-upload">
            {settings ? 'Trocar mídia' : 'Enviar imagem ou vídeo'}
          </button>
          {settings && <button type="button" style={action} disabled={busy}
            onClick={() => void perform(async () => setSettings(await presentationRepository.save(activeTenant.id, settings.assetId, { imageSeconds: seconds, oncePerDay }, settings.url)))}
            data-testid="presentation-save">Salvar ajustes</button>}
          {settings?.url && <button type="button" style={action} disabled={busy} onClick={preview} data-testid="presentation-preview">Ver abertura</button>}
          {settings && <button type="button" style={{ ...field, border: '1px solid var(--dc-border)', borderRadius: 12, padding: 10 }} disabled={busy}
            onClick={() => void perform(async () => {
              await presentationRepository.clear(activeTenant.id);
              setSettings(null); setSeconds(PRESENTATION_DEFAULT_IMAGE_SECONDS); setOncePerDay(false);
            })} data-testid="presentation-clear">Remover mídia</button>}
        </div>
      </>}
      {localRun && <StorePresentationScreen key={localRun.key} plan={localRun.plan}
        storeName={activeTenant.name} reducedMotion={prefersReducedMotion()} onDone={() => setLocalRun(null)} />}
    </section>
  );
}
