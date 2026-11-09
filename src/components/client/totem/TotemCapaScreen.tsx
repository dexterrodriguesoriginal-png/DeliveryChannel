import React, { useCallback, useEffect, useState } from 'react';
import { Hand, Pointer } from 'lucide-react';
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

/** Quebra o texto do CTA em até duas linhas, no espaço mais equilibrado. */
export function splitCtaLines(text: string): string[] {
  const value = text.trim();
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= 1 || value.length <= 12) return [value];
  let best = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(' ');
    const right = words.slice(i).join(' ');
    const score = Math.abs(left.length - right.length);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
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
  if (style === 'PILL' || style === 'OUTLINE') return <Pointer aria-hidden={true} />;
  return <Hand aria-hidden={true} />;
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
  const lines = splitCtaLines(settings.buttonText);
  const isBar = styleName === 'BAR';

  return (
    <div
      className="dc-totem-capa"
      data-testid="totem-capa"
      data-style={styleName}
      style={{ background: backdrop }}
    >
      <div className="dc-totem-capa-stage" aria-hidden={Boolean(active)}>
        {active ? (
          <SlideMedia slide={active} onEnded={next} loop={count === 1} />
        ) : (
          <div className="dc-totem-capa-empty" data-testid="totem-capa-empty" />
        )}
        {count > 1 && (
          <div className="dc-totem-capa-dots" data-testid="totem-capa-dots">
            {slides.map((slide, i) => (
              <button
                key={`${slide.url}-${i}`}
                type="button"
                aria-label={`Exibir mídia ${i + 1}`}
                aria-current={i === index % count}
                className={i === index % count ? 'is-active' : undefined}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
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
          {isBar && (
            <>
              <span className="dc-totem-capa-button-icon"><CtaIcon style={styleName} /></span>
              <span className="dc-totem-capa-button-divider" aria-hidden={true} />
              <span className="dc-totem-capa-button-text">{settings.buttonText}</span>
            </>
          )}
          {!isBar && (
            <>
              <span className="dc-totem-capa-button-text">
                {lines.map(line => <span key={line}>{line}</span>)}
              </span>
              <span className="dc-totem-capa-button-icon dc-totem-capa-button-icon--ripple">
                <CtaIcon style={styleName} />
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default TotemCapaScreen;
