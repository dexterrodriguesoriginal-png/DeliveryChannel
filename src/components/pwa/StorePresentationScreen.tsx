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
      const video = videoRef.current;
      if (video) {
        // Primeiro tenta reproduzir COM som. Se autoplay com áudio for bloqueado,
        // tenta mudo antes de liberar a vitrine.
        const tryMuted = () => {
          if (completed.current) return;
          video.muted = true;
          try { Promise.resolve(video.play()).catch(finish); } catch { finish(); }
        };
        video.muted = false;
        try { Promise.resolve(video.play()).catch(tryMuted); } catch { tryMuted(); }
      }
    }
    return () => clearTimers();
  }, []); // A abertura é um evento único; troca de mídia remonta por key.

  const mediaStyle: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
  };
  return (
    <div
      data-testid="store-presentation"
      data-kind={plan.kind}
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
          src={plan.url} autoPlay playsInline preload="auto" controls={false} disablePictureInPicture
          style={mediaStyle} onPlaying={() => start(Math.min(plan.maxMs, PRESENTATION_MAX_VIDEO_SECONDS * 1000))}
          onTimeUpdate={e => { if (e.currentTarget.currentTime >= PRESENTATION_MAX_VIDEO_SECONDS) finish(); }}
          onEnded={finish} onError={finish} />
      )}
      {plan.kind === 'STILL' && (
        <video ref={videoRef} data-testid="store-presentation-still" src={`${plan.url}#t=0.1`}
          muted playsInline preload="metadata" controls={false} style={mediaStyle}
          onLoadedData={() => start(plan.durationMs)} onError={finish} />
      )}

    </div>
  );
}
