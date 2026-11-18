import React, { useEffect, useRef, useState } from 'react';
import { Clapperboard } from 'lucide-react';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { useThemeEditorContext } from '../ThemeEditorContext';
import { presentationRepository, PresentationSettings } from '../../../../repositories/presentationRepository';
import { requestPresentationPreview } from '../../../../lib/theme/previewBridge';
import {
  clampImageSeconds, prefersReducedMotion, presentationPlan, PresentationPlan, PRESENTATION_DEFAULT_IMAGE_SECONDS,
  PRESENTATION_MAX_IMAGE_SECONDS, PRESENTATION_MIN_IMAGE_SECONDS, PRESENTATION_PREVIEW_BOOT_MS, StorePresentation,
} from '../../../../lib/pwa/presentation';
import { StorePresentationSequence } from '../../../../components/pwa/StorePresentationScreen';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';

/**
 * Aparência → "Tela inicial personalizada": imagem ou vídeo (até 10 s) logo depois de "Delivery Channel
 * apresenta". Grava na hora (separado do "Salvar" do tema). Sem tela: padrão do tema (fundo + logo/nome).
 */
export function PresentationScreenCard() {
  const { activeTenant, draftTheme, draftTokens } = useThemeEditorContext();
  const tenantId = activeTenant.id;
  const [settings, setSettings] = useState<PresentationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'upload' | 'save' | 'clear'>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(PRESENTATION_DEFAULT_IMAGE_SECONDS);
  const [oncePerDay, setOncePerDay] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Sem prévia do celular visível (painel no celular): a abertura toca em tela cheia aqui mesmo.
  const [localRun, setLocalRun] = useState<{ plan: PresentationPlan; key: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    presentationRepository.get(tenantId)
      .then((s) => { if (!alive) return; setSettings(s); setSeconds(s?.imageSeconds ?? PRESENTATION_DEFAULT_IMAGE_SECONDS); setOncePerDay(Boolean(s?.oncePerDay)); setError(null); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Falha ao ler a tela inicial.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tenantId]);

  const dirty = !!settings && (clampImageSeconds(seconds) !== settings.imageSeconds || oncePerDay !== settings.oncePerDay);

  const run = async (kind: 'upload' | 'save' | 'clear', fn: () => Promise<void>) => {
    setBusy(kind); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); } finally { setBusy(null); }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run('upload', async () => {
      const s = await presentationRepository.upload(tenantId, file, { imageSeconds: seconds, oncePerDay });
      setSettings(s); setSeconds(s.imageSeconds); setOncePerDay(s.oncePerDay);
    });
  };

  const preview = () => {
    const p: StorePresentation | null = settings?.url
      ? { url: settings.url, mediaType: settings.mediaType, imageSeconds: clampImageSeconds(seconds), oncePerDay }
      : null;
    if (requestPresentationPreview(p)) return;
    setLocalRun({ plan: presentationPlan(p, { reducedMotion: prefersReducedMotion() }), key: Date.now() });
  };

  return (
    <Card className="theme-tab-card p-5 space-y-4" data-testid="presentation-screen-card">
      <div className="pb-3 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <Clapperboard className="w-4 h-4 text-emerald-700" />
          Tela inicial personalizada
        </h3>
        <p className="text-xs text-gray-500">
          Aparece logo depois de “Delivery Channel apresenta”, antes da vitrine, uma vez por abertura do app. O cliente
          pode tocar em “Pular”. Imagem JPG, PNG ou WEBP até 3 MB, ou vídeo MP4/WEBM sem som de até 10 segundos e 15 MB
          (em pé, 9:16, recomendado). Sem tela enviada, o app mostra o fundo do seu tema com logo e nome.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-gray-500" data-testid="presentation-loading">Carregando…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-20 aspect-[9/16] rounded-xl overflow-hidden border border-gray-200 bg-gray-50 shrink-0 flex items-center justify-center text-[10px] text-gray-400 text-center" data-testid="presentation-thumb">
              {settings?.url
                ? (settings.mediaType === 'VIDEO'
                  ? <video src={`${settings.url}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  : <img src={settings.url} alt="" className="w-full h-full object-cover" />)
                : <span className="px-1">{settings ? 'Mídia indisponível' : 'Padrão do tema'}</span>}
            </div>
            <div className="min-w-0 space-y-1 text-xs text-gray-600">
              <p className="font-semibold text-gray-900" data-testid="presentation-status">
                {settings ? (settings.mediaType === 'VIDEO' ? 'Vídeo da loja' : 'Imagem da loja') : 'Usando o padrão do tema'}
              </p>
              {settings && !settings.url && <p className="text-amber-700">A mídia foi despublicada; os clientes veem o padrão do tema. Envie outra.</p>}
              <p>Salva na hora, separado do botão Salvar do tema.</p>
            </div>
          </div>

          {settings?.mediaType === 'IMAGE' && (
            <label className="block space-y-1 text-xs text-gray-700">
              <span className="font-semibold">Tempo da imagem: {clampImageSeconds(seconds).toLocaleString('pt-BR')} s</span>
              <input
                type="range" min={PRESENTATION_MIN_IMAGE_SECONDS} max={PRESENTATION_MAX_IMAGE_SECONDS} step={0.5}
                value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}
                className="w-full accent-emerald-700" data-testid="presentation-seconds"
              />
            </label>
          )}
          {settings && (
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={oncePerDay} onChange={(e) => setOncePerDay(e.target.checked)} data-testid="presentation-once-per-day" />
              Mostrar só uma vez por dia para cada cliente
            </label>
          )}

          {error && <p role="alert" className="text-xs text-rose-700" data-testid="presentation-error">{error}</p>}

          <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onFile} data-testid="presentation-file" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => fileRef.current?.click()} isLoading={busy === 'upload'} disabled={!!busy} data-testid="presentation-upload">
              {settings ? 'Trocar' : 'Enviar imagem ou vídeo'}
            </Button>
            {dirty && settings && (
              <Button size="sm" variant="secondary" isLoading={busy === 'save'} disabled={!!busy} data-testid="presentation-save"
                onClick={() => run('save', async () => {
                  const s = await presentationRepository.save(tenantId, settings.assetId, { imageSeconds: seconds, oncePerDay }, settings.url);
                  setSettings(s);
                })}>
                Salvar ajustes
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={preview} disabled={!!busy} data-testid="presentation-preview">Ver abertura</Button>
            {settings && (
              <Button size="sm" variant="ghost" isLoading={busy === 'clear'} disabled={!!busy} data-testid="presentation-clear"
                onClick={() => run('clear', async () => {
                  await presentationRepository.clear(tenantId);
                  setSettings(null); setSeconds(PRESENTATION_DEFAULT_IMAGE_SECONDS); setOncePerDay(false);
                })}>
                Remover (voltar ao padrão)
              </Button>
            )}
          </div>
        </div>
      )}
      {localRun && (
        <StorePresentationSequence
          key={localRun.key}
          withBoot
          bootMs={PRESENTATION_PREVIEW_BOOT_MS}
          plan={localRun.plan}
          background={draftTokens?.palette?.bgGeneral || draftTheme?.backgroundColor}
          textColor={draftTokens?.palette?.textMain || draftTheme?.textColor}
          storeName={draftTheme?.storeName || activeTenant.name}
          logoUrl={draftTheme?.logoUrl}
          onDone={() => setLocalRun(null)}
        />
      )}
    </Card>
  );
}
