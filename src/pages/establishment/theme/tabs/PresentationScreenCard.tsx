import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Clapperboard, Loader2, Upload } from 'lucide-react';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { useThemeEditorContext } from '../ThemeEditorContext';
import { presentationRepository, type PresentationSettings } from '../../../../repositories/presentationRepository';
import { requestPresentationPreview } from '../../../../lib/theme/previewBridge';
import {
  clampImageSeconds, presentationPlan, prefersReducedMotion,
  PRESENTATION_DEFAULT_IMAGE_SECONDS, PRESENTATION_MIN_IMAGE_SECONDS,
  PRESENTATION_MAX_IMAGE_SECONDS, type PresentationPlan,
} from '../../../../lib/pwa/presentation';
import { StorePresentationScreen } from '../../../../components/pwa/StorePresentationScreen';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';
const LIMITS = 'JPG, PNG, WebP até 3 MB · MP4 ou WebM até 15 MB / 10 s';

/** Só montado quando a ferramenta está habilitada para o proprietário. */
export function PresentationScreenCard() {
  const { activeTenant } = useThemeEditorContext();
  const [settings, setSettings] = useState<PresentationSettings | null>(null);
  const [seconds, setSeconds] = useState(PRESENTATION_DEFAULT_IMAGE_SECONDS);
  const [oncePerDay, setOncePerDay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [localRun, setLocalRun] = useState<{ plan: PresentationPlan; key: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopProgress = () => {
    if (progressTimer.current !== null) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  };

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

  useEffect(() => () => stopProgress(), []);

  const perform = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };

  const upload = (file?: File) => {
    if (!file || busy) return;
    void perform(async () => {
      // O repositório não expõe bytes transferidos; indicador estimado, nunca apresentado como real.
      setUploadProgress(12);
      stopProgress();
      progressTimer.current = setInterval(() => {
        setUploadProgress(current => Math.min(90, current + Math.max(1, Math.round((90 - current) / 7))));
      }, 320);
      try {
        const saved = await presentationRepository.upload(activeTenant.id, file, { imageSeconds: seconds, oncePerDay });
        setSettings(saved);
        setSeconds(saved.imageSeconds);
        setUploadProgress(100);
      } finally {
        stopProgress();
        setUploadProgress(0);
      }
    });
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    upload(file);
  };

  const openPicker = () => {
    if (!busy) fileRef.current?.click();
  };

  const preview = () => {
    if (!settings?.url) return;
    const media = { url: settings.url, mediaType: settings.mediaType,
      imageSeconds: clampImageSeconds(seconds), oncePerDay };
    if (requestPresentationPreview(media)) return;
    const plan = presentationPlan(media, { reducedMotion: prefersReducedMotion() });
    if (plan) setLocalRun({ plan, key: Date.now() });
  };

  const hasMedia = Boolean(settings?.url);
  const isActive = Boolean(settings?.enabled && settings?.url);
  const status = !settings ? 'Nenhuma mídia' : isActive ? 'Ativa' : 'Não publicada';
  const statusVariant = !settings ? 'neutral' : isActive ? 'success' : 'warning';

  return (
    <section aria-label="Abertura da loja" data-testid="presentation-screen-card">
      <Card className="theme-tab-card p-5 space-y-4">
        <div className="pb-3 border-b border-gray-100">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Clapperboard className="w-4 h-4 text-emerald-700" />
            Abertura da loja
          </h3>
          <p className="text-xs text-gray-500">
            Sua marca em tela cheia, depois do splash do celular. Imagem por 3 s ou vídeo de até 10 s.
          </p>
        </div>

        {loading ? (
          <div className="flex items-start gap-4 animate-pulse" data-testid="presentation-skeleton" aria-label="Carregando abertura da loja">
            <div className="w-24 aspect-[9/16] shrink-0 rounded-xl bg-gray-200" />
            <div className="flex-1 space-y-3 py-2">
              <div className="h-5 w-24 rounded-full bg-gray-200" />
              <div className="h-3 w-3/4 rounded bg-gray-200" />
              <div className="h-3 w-1/2 rounded bg-gray-200" />
              <div className="h-9 w-36 rounded-xl bg-gray-200 mt-4" />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge data-testid="presentation-status" variant={statusVariant} dot>{status}</Badge>
              {hasMedia && <span className="text-xs font-semibold text-gray-700">
                {settings?.mediaType === 'VIDEO' ? 'Vídeo salvo' : 'Imagem salva'}
              </span>}
            </div>

            {settings && (
              <div className="flex flex-wrap items-start gap-4">
                <div data-testid="presentation-thumb"
                  className="w-24 aspect-[9/16] shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100">
                  {settings.url && settings.mediaType === 'IMAGE' && (
                    <img src={settings.url} alt="Prévia da imagem" className="h-full w-full object-cover" />
                  )}
                  {settings.url && settings.mediaType === 'VIDEO' && (
                    <video src={settings.url} muted loop autoPlay playsInline preload="metadata"
                      aria-label="Prévia do vídeo" className="h-full w-full object-cover" />
                  )}
                  {!settings.url && <div className="h-full w-full flex items-center justify-center text-gray-400">
                    <Clapperboard className="w-6 h-6" aria-hidden="true" />
                  </div>}
                </div>
                <div className="space-y-2 flex-1 min-w-40 pt-1">
                  <p className="text-xs font-semibold text-gray-800">
                    {settings.mediaType === 'VIDEO' ? 'Vídeo salvo' : 'Imagem salva'}
                  </p>
                  <p className="text-xs text-gray-500">Se desabilitar a ferramenta, a mídia continuará salva.</p>
                </div>
              </div>
            )}

            <input ref={fileRef} type="file" accept={ACCEPT} hidden
              onChange={onFile} disabled={busy} data-testid="presentation-file" />
            <div role="button" tabIndex={busy ? -1 : 0}
              aria-label={settings ? 'Arraste ou selecione para trocar mídia' : 'Arraste ou selecione uma mídia'}
              data-testid="presentation-dropzone"
              aria-disabled={busy}
              onClick={openPicker}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openPicker();
                }
              }}
              onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }}
              onDragLeave={event => { event.preventDefault(); setDragging(false); }}
              onDrop={event => {
                event.preventDefault();
                setDragging(false);
                if (!busy) upload(event.dataTransfer.files?.[0]);
              }}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                dragging ? 'border-emerald-500 bg-emerald-50/60'
                  : 'border-gray-300 hover:border-emerald-400 hover:bg-gray-50/70 bg-white'
              } ${busy ? 'opacity-80 cursor-default' : ''}`}
            >
              <div className="flex flex-col items-center justify-center gap-2">
                {busy && uploadProgress > 0 ? (
                  <div className="w-full max-w-xs space-y-2.5" data-testid="presentation-progress">
                    <div className="flex items-center justify-between text-xs font-semibold text-gray-700">
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
                        Enviando mídia…
                      </span>
                      <span className="font-mono text-emerald-800">{uploadProgress}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden"
                      role="progressbar" aria-label="Progresso estimado do envio"
                      aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}>
                      <div className="h-full bg-emerald-600 rounded-full transition-all duration-200"
                        style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center">
                      <Upload className="w-4 h-4" />
                    </div>
                    <p className="text-xs text-gray-700">
                      <span className="font-bold text-emerald-700">Clique para enviar</span> ou arraste o arquivo aqui
                    </p>
                    <span className="text-[10px] text-gray-400">{LIMITS}</span>
                  </>
                )}
              </div>
            </div>

            {settings?.mediaType === 'IMAGE' && (
              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Tempo da imagem: {seconds.toLocaleString('pt-BR')} s
                <input type="range" min={PRESENTATION_MIN_IMAGE_SECONDS} max={PRESENTATION_MAX_IMAGE_SECONDS}
                  step="0.5" value={seconds} onChange={event => setSeconds(clampImageSeconds(event.target.value))}
                  data-testid="presentation-seconds" disabled={busy}
                  className="w-full accent-emerald-700" />
              </label>
            )}
            {settings && (
              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input type="checkbox" checked={oncePerDay} onChange={event => setOncePerDay(event.target.checked)}
                  data-testid="presentation-once-per-day" disabled={busy} className="accent-emerald-700" />
                Mostrar no máximo uma vez por dia
              </label>
            )}

            {error && (
              <p role="alert" data-testid="presentation-error"
                className="flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 p-2.5 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={settings ? 'secondary' : 'primary'} size="md"
                isLoading={busy && uploadProgress > 0} disabled={busy}
                data-testid="presentation-upload" onClick={openPicker}
                leftIcon={<Upload className="w-4 h-4" />}>
                {settings ? 'Trocar mídia' : 'Enviar imagem ou vídeo'}
              </Button>
              {settings && (
                <Button type="button" variant={!isActive ? 'primary' : 'outline'} size="md"
                  disabled={busy} data-testid="presentation-save"
                  onClick={() => void perform(async () => setSettings(
                    await presentationRepository.save(activeTenant.id, settings.assetId,
                      { imageSeconds: seconds, oncePerDay }, settings.url)
                  ))}>
                  {isActive ? 'Salvar ajustes' : 'Publicar'}
                </Button>
              )}
              {settings?.url && (
                <Button type="button" variant="outline" size="md" disabled={busy}
                  data-testid="presentation-preview" onClick={preview}>Ver abertura</Button>
              )}
              {settings && (
                <Button type="button" variant="danger" size="md" disabled={busy}
                  data-testid="presentation-clear"
                  onClick={() => {
                    if (!window.confirm('Remover a mídia da abertura da loja? A ferramenta pode ser habilitada de novo e a mídia continua na biblioteca.')) return;
                    void perform(async () => {
                      await presentationRepository.clear(activeTenant.id);
                      setSettings(null);
                      setSeconds(PRESENTATION_DEFAULT_IMAGE_SECONDS);
                      setOncePerDay(false);
                    });
                  }}>Remover</Button>
              )}
            </div>
          </div>
        )}
      </Card>
      {localRun && (
        <StorePresentationScreen key={localRun.key} plan={localRun.plan}
          storeName={activeTenant.name} reducedMotion={prefersReducedMotion()}
          onDone={() => setLocalRun(null)} />
      )}
    </section>
  );
}
