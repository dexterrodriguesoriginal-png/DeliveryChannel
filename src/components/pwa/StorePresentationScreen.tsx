import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PresentationPlan } from '../../lib/pwa/presentation';
import { PRESENTATION_MAX_VIDEO_SECONDS, PRESENTATION_START_TIMEOUT_MS, PRESENTATION_FADE_MS } from '../../lib/pwa/presentation';

export interface StorePresentationScreenProps {
  plan: PresentationPlan;
  storeName?: string;
  reducedMotion?: boolean;
  onDone: () => void;
}

/**
 * Apresentação imersiva: ocupa toda a viewport, sem cartões, marca da plataforma,
 * textos adicionais ou interferência no splash nativo.
 * Erro, autoplay bloqueado ou demora > 1,5s liberam imediatamente a vitrine.
 */
export function StorePresentationScreen({ plan, storeName, reducedMotion = false, onDone }: StorePresentationScreenProps) {
  const [leaving, setLeaving] = useState(false);
  const completed = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const videoRef = useRef<HTMLVideoElement>(null);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    clearTimers();
    try { videoRef.current?.pause(); } catch { /* browser */ }
    if (reducedMotion) { doneRef.current(); return; }
    setLeaving(true);
    timers.current.push(setTimeout(() => doneRef.current(), PRESENTATION_FADE_MS));
  }, [reducedMotion]);
  const start = useCallback((ms: number) => {
    if (completed.current) return;
    clearTimers();
    timers.current.push(setTimeout(finish, ms));
  }, [finish]);

  useEffect(() => {
    timers.current.push(setTimeout(finish, PRESENTATION_START_TIMEOUT_MS));
    if (plan.kind === 'VIDEO') {
      const p = videoRef.current?.play();
      p?.catch(finish);
    }
    return () => clearTimers();
  }, []); // A abertura é um evento único; troca de mídia remonta por key.

  const mediaStyle: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
  };
  return (
    <div
      data-testid="store-presentation"
      role="dialog"
      aria-modal="true"
      aria-label={storeName ? `Abertura de ${storeName}` : 'Abertura da loja'}
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483000, overflow: 'hidden',
        background: 'var(--dc-bg-general-color)', color: 'var(--dc-text-main)',
        opacity: leaving ? 0 : 1, pointerEvents: leaving ? 'none' : 'auto',
        transition: reducedMotion ? 'none' : `opacity ${PRESENTATION_FADE_MS}ms ease`,
      }}
    >
      {plan.kind === 'IMAGE' && (
        <img data-testid="store-presentation-image" src={plan.url} alt="" style={mediaStyle}
          onLoad={() => start(reducedMotion ? 1500 : plan.durationMs)} onError={finish} />
      )}
      {plan.kind === 'VIDEO' && (
        <video ref={videoRef} data-testid="store-presentation-video"
          src={plan.url} autoPlay muted playsInline preload="auto" controls={false} disablePictureInPicture
          style={mediaStyle} onPlaying={() => start(Math.min(plan.maxMs, PRESENTATION_MAX_VIDEO_SECONDS * 1000))}
          onTimeUpdate={e => { if (e.currentTarget.currentTime >= PRESENTATION_MAX_VIDEO_SECONDS) finish(); }}
          onEnded={finish} onError={finish} />
      )}
      {plan.kind === 'STILL' && (
        <video ref={videoRef} data-testid="store-presentation-still" src={`${plan.url}#t=0.1`}
          muted playsInline preload="metadata" controls={false} style={mediaStyle}
          onLoadedData={() => start(plan.durationMs)} onError={finish} />
      )}
      <button type="button" data-testid="store-presentation-skip"
        aria-label="Pular abertura e ir para a loja" onClick={finish}
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
          border: '1px solid var(--dc-border)', borderRadius: 999, padding: '7px 13px',
          background: 'var(--dc-bg-card-color)', color: 'var(--dc-text-main)',
          fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: 0.9,
        }}>Pular</button>
    </div>
  );
}
