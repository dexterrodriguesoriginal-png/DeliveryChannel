import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  PRESENTATION_FADE_MS, PRESENTATION_MAX_VIDEO_SECONDS, PRESENTATION_START_TIMEOUT_MS, PresentationPlan,
} from '../../lib/pwa/presentation';
import { DC_PRESENTS_BACKGROUND, DC_PRESENTS_TEXT_COLOR } from '../../lib/pwa/bootScreen';
import { DcBootScreen } from './DcBootScreen';

export interface StorePresentationScreenProps {
  plan: PresentationPlan;
  /** Cores vindas do tema da loja (fundo e texto). Sem tema: cores padrão do Delivery Channel. */
  background?: string;
  textColor?: string;
  storeName?: string;
  logoUrl?: string;
  onDone: () => void;
}

/** Acima da vitrine, abaixo da #dc-boot do servidor (que some por cima com fade). */
export const PRESENTATION_Z_INDEX = 2147483000;

/**
 * Tela inicial da loja: imagem (tempo configurado), vídeo mudo (até 10 s) ou fundo do tema com logo/nome.
 * Só o botão "Pular" encerra antes do fim (toque no resto da tela não pula). Erro ou mídia que não
 * começa em 3 s → vitrine, sem tela preta.
 */
export function StorePresentationScreen({ plan, background, textColor, storeName, logoUrl, onDone }: StorePresentationScreenProps) {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (startTimer.current) clearTimeout(startTimer.current);
    timers.current.forEach(clearTimeout);
    try { videoRef.current?.pause(); } catch { /* ignore */ }
    setLeaving(true);
    timers.current = [setTimeout(() => onDoneRef.current(), PRESENTATION_FADE_MS)];
  }, []);
  const after = useCallback((ms: number) => { timers.current.push(setTimeout(finish, ms)); }, [finish]);
  const started = useCallback((runMs: number) => {
    if (startTimer.current) { clearTimeout(startTimer.current); startTimer.current = null; }
    after(runMs);
  }, [after]);

  useEffect(() => {
    if (plan.kind === 'THEME') after(plan.durationMs);
    else startTimer.current = setTimeout(finish, PRESENTATION_START_TIMEOUT_MS);
    if (plan.kind === 'VIDEO') {
      const v = videoRef.current;
      try {
        const p = v?.play?.();
        if (p && typeof p.catch === 'function') p.catch(finish); // autoplay bloqueado → vitrine
      } catch { finish(); }
    }
    return () => {
      if (startTimer.current) clearTimeout(startTimer.current);
      timers.current.forEach(clearTimeout);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bg = background || DC_PRESENTS_BACKGROUND;
  const fg = textColor || DC_PRESENTS_TEXT_COLOR;
  const mediaStyle: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={storeName ? `Abertura de ${storeName}` : 'Abertura da loja'}
      data-testid="store-presentation"
      data-kind={plan.kind}
      style={{
        position: 'fixed', inset: 0, zIndex: PRESENTATION_Z_INDEX, background: bg, color: fg, overflow: 'hidden',
        opacity: leaving ? 0 : 1, transition: `opacity ${PRESENTATION_FADE_MS}ms ease`, pointerEvents: leaving ? 'none' : 'auto',
        animation: `dc-presentation-in ${PRESENTATION_FADE_MS}ms ease`,
      }}
    >
      <style>{'@keyframes dc-presentation-in{from{opacity:0}to{opacity:1}}'}</style>
      {plan.kind === 'IMAGE' && (
        <img
          data-testid="store-presentation-image"
          src={plan.url}
          alt=""
          style={mediaStyle}
          onLoad={() => started(plan.durationMs)}
          onError={finish}
        />
      )}
      {plan.kind === 'VIDEO' && (
        <video
          ref={videoRef}
          data-testid="store-presentation-video"
          src={plan.url}
          autoPlay
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          controls={false}
          style={mediaStyle}
          onPlaying={() => started(plan.maxMs)}
          onTimeUpdate={(e) => { if (e.currentTarget.currentTime >= PRESENTATION_MAX_VIDEO_SECONDS) finish(); }}
          onEnded={finish}
          onError={finish}
        />
      )}
      {plan.kind === 'STILL' && (
        <video
          ref={videoRef}
          data-testid="store-presentation-still"
          src={`${plan.url}#t=0.1`}
          muted
          playsInline
          preload="auto"
          controls={false}
          style={mediaStyle}
          onLoadedData={() => started(plan.durationMs)}
          onError={finish}
        />
      )}
      {plan.kind === 'THEME' && (
        <div data-testid="store-presentation-theme" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          {logoUrl && <img src={logoUrl} alt="" style={{ width: 96, height: 96, objectFit: 'contain', borderRadius: 20 }} />}
          {storeName && <span style={{ fontWeight: 700, fontSize: 20, lineHeight: 1.25 }}>{storeName}</span>}
        </div>
      )}
      <button
        type="button"
        data-testid="store-presentation-skip"
        aria-label="Pular abertura e ir para a loja"
        onClick={finish}
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
          padding: '8px 16px', borderRadius: 999, border: 0, fontWeight: 700, fontSize: 14, cursor: 'pointer',
          // Cor de destaque do tema quando disponível (app da loja); fora dele, texto/fundo invertidos (contraste).
          background: `var(--dc-primary, ${fg})`, color: `var(--dc-button-text, ${bg})`,
        }}
      >
        Pular
      </button>
    </div>
  );
}

/** Prévia do painel ("Ver abertura"): simula a "Delivery Channel apresenta" e depois a tela da loja. */
export function StorePresentationSequence({ withBoot, bootMs, ...props }: StorePresentationScreenProps & { withBoot?: boolean; bootMs: number }) {
  const [stage, setStage] = useState<'boot' | 'store'>(withBoot ? 'boot' : 'store');
  useEffect(() => {
    if (stage !== 'boot') return;
    const t = setTimeout(() => setStage('store'), bootMs);
    return () => clearTimeout(t);
  }, [stage, bootMs]);
  if (stage === 'boot') {
    return (
      <div data-testid="store-presentation-boot" style={{ position: 'fixed', inset: 0, zIndex: PRESENTATION_Z_INDEX + 1 }}>
        <DcBootScreen />
      </div>
    );
  }
  return <StorePresentationScreen {...props} />;
}
