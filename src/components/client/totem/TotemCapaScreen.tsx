import React, { useCallback, useEffect, useState } from 'react';
import { Hand, Pointer, Sparkles } from 'lucide-react';
import { safeHomeImageUrl } from '../../../lib/storeHome/storeHome.model';
import {
  DEFAULT_TOTEM_IMAGE_SECONDS,
  type TotemButtonStyle,
  type TotemWelcomeSettings,
  type TotemWelcomeSlide,
} from '../../../lib/menu/totemWelcome';
import './totemCapa.css';

export interface TotemCapaScreenProps {
  settings: TotemWelcomeSettings;
  buttonBackground: string;
  buttonColor: string;
  /** Fundo da tela quando não há mídia (vem do tema). */
  backdrop?: string;
  onStart(): void;
}

export function totemImageDurationMs(seconds: number): number {
  const n = Number.isInteger(seconds) ? seconds : DEFAULT_TOTEM_IMAGE_SECONDS;
  const clamped = Math.min(120, Math.max(2, n));
  return clamped * 1000;
}

function SlideMedia({
  slide,
  onEnded,
  loop,
}: {
  slide: TotemWelcomeSlide;
  onEnded(): void;
  loop: boolean;
}) {
  const src = safeHomeImageUrl(slide.url);
  if (!src) {
    return <div className="dc-totem-capa-fallback" data-testid="totem-capa-unavailable">Mídia indisponível</div>;
  }
  if (slide.kind === 'VIDEO') {
    return (
      <video
        key={slide.url}
        data-testid="totem-capa-video"
        src={src}
        autoPlay
        muted
        playsInline
        preload="auto"
        loop={loop}
        onEnded={onEnded}
        onError={onEnded}
        className="dc-totem-capa-media"
      />
    );
  }
  return (
    <img
      key={slide.url}
      data-testid="totem-capa-image"
      src={src}
      alt=""
      className="dc-totem-capa-media"
      referrerPolicy="no-referrer"
      draggable={false}
    />
  );
}

function CtaIcon({ style }: { style: TotemButtonStyle }) {
  if (style === 'PILL') return <Pointer size={28} aria-hidden={true} />;
  if (style === 'OUTLINE') return <Sparkles size={26} aria-hidden={true} />;
  return <Hand size={28} aria-hidden={true} />;
}

export function TotemCapaScreen({
  settings,
  buttonBackground,
  buttonColor,
  backdrop = '#111111',
  onStart,
}: TotemCapaScreenProps) {
  const slides = settings.slides;
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const active = count > 0 ? slides[index % count] : null;
  const next = useCallback(() => {
    setIndex(i => (count > 1 ? (i + 1) % count : 0));
  }, [count]);

  useEffect(() => { setIndex(0); }, [slides]);

  useEffect(() => {
    if (!active || count <= 1 || active.kind === 'VIDEO') return;
    const id = window.setTimeout(next, totemImageDurationMs(settings.imageSeconds));
    return () => window.clearTimeout(id);
  }, [active, count, next, settings.imageSeconds]);

  const styleName = settings.buttonStyle === 'PILL' || settings.buttonStyle === 'OUTLINE'
    ? settings.buttonStyle
    : 'BAR';

  return (
    <div
      className="dc-totem-capa"
      data-testid="totem-capa"
      style={{ background: backdrop }}
    >
      <div className="dc-totem-capa-stage" aria-hidden={Boolean(active)}>
        {active ? (
          <SlideMedia slide={active} onEnded={next} loop={count === 1} />
        ) : (
          <div className="dc-totem-capa-empty" data-testid="totem-capa-empty" />
        )}
      </div>
      <div className="dc-totem-capa-cta">
        <button
          type="button"
          className={`dc-totem-capa-button dc-totem-capa-button--${styleName.toLowerCase()}`}
          data-testid="totem-capa-cta"
          data-style={styleName}
          style={
            styleName === 'OUTLINE'
              ? { color: buttonBackground, borderColor: buttonBackground, background: 'transparent' }
              : { background: buttonBackground, color: buttonColor }
          }
          onClick={onStart}
        >
          <CtaIcon style={styleName} />
          <span>{settings.buttonText}</span>
        </button>
      </div>
    </div>
  );
}

export default TotemCapaScreen;
