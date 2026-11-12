import { OutdoorYouTubePlayer } from './OutdoorYouTubePlayer';
import React, { useCallback, useEffect, useState } from 'react';
import { isYouTubeId } from '../../../lib/youtube';
import { safeHomeImageUrl } from '../../../lib/storeHome/storeHome.model';
import type { PublicMenuOutdoorSlide } from '../../../repositories/menuOutdoorRepository';

export const OUTDOOR_DEFAULT_IMAGE_SECONDS = 6;
export { OUTDOOR_YOUTUBE_FALLBACK_SECONDS } from './OutdoorYouTubePlayer';

export function outdoorImageDurationSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 120
    ? value : OUTDOOR_DEFAULT_IMAGE_SECONDS;
}

/** Only server-authorized PUBLIC banners. No customer identity, account or cart state here. */
export function MenuOutdoorCarousel({
  slides, onOpenProduct,
}: {
  slides: PublicMenuOutdoorSlide[];
  onOpenProduct?: (productId: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const count = slides.length;
  const active = count > 0 ? slides[index % count] : null;
  const next = useCallback(() => {
    setIndex(i => count > 1 ? (i + 1) % count : 0);
  }, [count]);
  useEffect(() => {
    setIndex(0);
  }, [slides]);
  useEffect(() => {
    if (!active || count <= 1 || active.videoUrl || active.youtubeId) return;
    const seconds = outdoorImageDurationSeconds(active.imageDurationSeconds);
    const id = window.setTimeout(next, seconds * 1000);
    return () => window.clearTimeout(id);
  }, [active?.id, active?.videoUrl, active?.youtubeId, active?.imageDurationSeconds, count, next]);

  if (!active) return null;
  const video = safeHomeImageUrl(active.videoUrl);
  const image = safeHomeImageUrl(active.imageUrl);
  const youtube = active.youtubeId && isYouTubeId(active.youtubeId) ? active.youtubeId : null;
  return (
    <section className="dc-outdoor relative h-36 sm:h-44 md:h-52 shrink-0 overflow-hidden bg-black"
      aria-label="Destaques da loja" data-testid="cardapio-outdoor">
      {video ? (
        <video key={active.id} data-testid="cardapio-outdoor-video" src={video}
          autoPlay muted playsInline preload="auto" loop={count === 1}
          onEnded={next} onError={next} className="h-full w-full object-cover" />
      ) : youtube ? (
        <OutdoorYouTubePlayer key={active.id} data-testid="cardapio-outdoor-youtube"
          youtubeId={youtube} onEnded={next} loop={count === 1} title={active.title || 'Vídeo do Outdoor'}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin" className="h-full w-full border-0" />
      ) : image ? (
        <img key={active.id} src={image} alt={active.title || 'Banner da loja'}
          className="h-full w-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <div className="grid h-full place-items-center text-sm text-white">Banner indisponível</div>
      )}
      {active.title && <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 font-bold text-white">{active.title}</div>}
      {active.productId && onOpenProduct &&
        <button type="button" className="absolute inset-0" aria-label={`Ver produto do banner: ${active.title || 'destaque'}`}
          onClick={() => onOpenProduct(active.productId!)} />}
      {count > 1 && <div className="absolute bottom-2 right-2 z-10 flex gap-1">
        {slides.map((slide, i) => <button key={slide.id} type="button"
          aria-label={`Exibir banner ${i + 1}`} aria-current={i === index % count}
          onClick={() => setIndex(i)} className={i === index % count ? 'h-2 w-5 rounded bg-white' : 'h-2 w-2 rounded bg-white/60'} />)}
      </div>}
    </section>
  );
}
