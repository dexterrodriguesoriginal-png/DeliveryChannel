import React, { useState, useEffect, useRef } from 'react';
import { Offer } from '../../types';
import { ChevronLeft, ChevronRight, Tag, ArrowRight, Play, VolumeX, Sparkles, Percent } from 'lucide-react';

export interface OfferCarouselProps {
  offers: Offer[];
  onOfferClick?: (offer: Offer) => void;
  autoPlayInterval?: number; // fallback default
}

export const OfferCarousel: React.FC<OfferCarouselProps> = ({
  offers,
  onOfferClick,
  autoPlayInterval = 5000,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Atualização periódica a cada 10 segundos para transição automática de cards agendados/expirados sem refresh
  useEffect(() => {
    const clockInterval = setInterval(() => {
      setNow(Date.now());
    }, 10000);
    return () => clearInterval(clockInterval);
  }, []);

  // Filtra apenas ofertas estritamente ativas conforme agendamento (startAt <= now <= endAt)
  const validOffers = offers.filter(o => {
    if (!o.isActive) return false;
    const startStr = o.startAt || o.startDate;
    const endStr = o.endAt || o.endDate;
    if (startStr) {
      const s = new Date(startStr).getTime();
      if (!isNaN(s) && s > now) return false;
    }
    if (endStr) {
      const e = new Date(endStr).getTime();
      if (!isNaN(e) && e < now) return false;
    }
    return true;
  });

  const total = validOffers.length;

  // Ajusta índice caso a lista diminua
  useEffect(() => {
    if (currentIndex >= total && total > 0) {
      setCurrentIndex(0);
      setProgress(0);
    }
  }, [total, currentIndex]);

  const currentOffer = validOffers[currentIndex];

  // Determina duração deste slide em milissegundos
  const currentDurationMs = React.useMemo(() => {
    if (!currentOffer) return autoPlayInterval;
    if (currentOffer.mediaType === 'VIDEO') {
      const durSec = currentOffer.videoDuration || currentOffer.durationSeconds || 10;
      return Math.max(1000, Math.round(durSec * 1000));
    }
    const durSec = currentOffer.durationSeconds || 5;
    return Math.max(1000, Math.round(durSec * 1000));
  }, [currentOffer, autoPlayInterval]);

  // Avançar slide
  const nextSlide = () => {
    setProgress(0);
    setCurrentIndex(prev => (prev + 1) % total);
  };

  const prevSlide = () => {
    setProgress(0);
    setCurrentIndex(prev => (prev - 1 + total) % total);
  };

  // Gerenciamento do AutoPlay e Barra de Progresso
  useEffect(() => {
    if (total <= 1 || isPaused || !currentOffer) {
      return;
    }

    // Se for vídeo, sincroniza com o playback do elemento <video>
    if (currentOffer.mediaType === 'VIDEO' && videoRef.current) {
      const videoEl = videoRef.current;
      videoEl.currentTime = 0;
      videoEl.play().catch(() => {});

      const handleTimeUpdate = () => {
        if (videoEl.duration && !isNaN(videoEl.duration)) {
          const pct = (videoEl.currentTime / videoEl.duration) * 100;
          setProgress(Math.min(100, pct));
        }
      };

      const handleEnded = () => {
        nextSlide();
      };

      videoEl.addEventListener('timeupdate', handleTimeUpdate);
      videoEl.addEventListener('ended', handleEnded);

      return () => {
        videoEl.removeEventListener('timeupdate', handleTimeUpdate);
        videoEl.removeEventListener('ended', handleEnded);
      };
    }

    // Para imagens: temporizador suave
    const stepMs = 50;
    const totalSteps = currentDurationMs / stepMs;
    let stepCount = 0;

    timerRef.current = window.setInterval(() => {
      stepCount += 1;
      setProgress((stepCount / totalSteps) * 100);

      if (stepCount >= totalSteps) {
        stepCount = 0;
        setProgress(0);
        nextSlide();
      }
    }, stepMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [total, isPaused, currentIndex, currentDurationMs, currentOffer]);

  if (!validOffers || validOffers.length === 0 || !currentOffer) {
    return null;
  }

  const mediaSource = currentOffer.mediaUrl || currentOffer.imageUrl;
  const isVideo = currentOffer.mediaType === 'VIDEO';
  const format = currentOffer.cardFormat || 'HORIZONTAL';

  // Proporções para o container principal
  const aspectClass = format === 'VERTICAL'
    ? 'aspect-4/5 max-h-[380px]'
    : format === 'QUADRADO' || (format as any) === 'SQUARE'
    ? 'aspect-square max-h-[320px]'
    : 'min-h-[190px] sm:min-h-[220px] md:min-h-[240px]';

  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl shadow-sm group select-none transition-all duration-300"
      onMouseEnter={() => {
        setIsPaused(true);
        if (videoRef.current) videoRef.current.pause();
      }}
      onMouseLeave={() => {
        setIsPaused(false);
        if (videoRef.current && isVideo) videoRef.current.play().catch(() => {});
      }}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
    >
      {/* Banner Card Container */}
      <div
        className={`relative ${aspectClass} w-full flex items-center p-0 ${
          currentOffer.destinationType === 'BANNER_ONLY' && !currentOffer.internalLink && !currentOffer.linkUrl
            ? 'cursor-default'
            : 'cursor-pointer'
        } overflow-hidden transition-all duration-500`}
        style={{
          backgroundColor: currentOffer.backgroundColor || '#15803d',
        }}
        onClick={() => {
          if (onOfferClick) {
            onOfferClick(currentOffer);
          }
        }}
      >
        {currentOffer.autoOverlay === false || currentOffer.displayMode === 'FULL_MEDIA' ? (
          /* ================================================================ */
          /* MODO A: MÍDIA COMPLETA (A ARTE DO ESTABELECIMENTO É SOBERANA)    */
          /* 100% da área do card, sem texto, sem overlay, sem botões        */
          /* ================================================================ */
          <div className="absolute inset-0 w-full h-full overflow-hidden bg-black flex items-center justify-center">
            {isVideo && mediaSource ? (
              <video
                ref={videoRef}
                src={mediaSource}
                muted
                playsInline
                autoPlay
                className="w-full h-full object-cover object-center"
              />
            ) : mediaSource ? (
              <img
                src={mediaSource}
                alt={currentOffer.title || 'Arte Promocional'}
                className="w-full h-full object-cover object-center"
              />
            ) : (
              <div className="text-white/40 text-xs">Mídia promocional</div>
            )}
          </div>
        ) : (
          /* ================================================================ */
          /* MODO B: CARD COM SOBREPOSIÇÃO (COMPOSIÇÃO PROFISSIONAL)          */
          /* ================================================================ */
          <div className="relative w-full h-full flex items-center p-5 sm:p-7 overflow-hidden">
            {/* Camada de Mídia de Fundo */}
            <div className="absolute inset-0 z-0 overflow-hidden">
              {isVideo && mediaSource ? (
                <video
                  ref={videoRef}
                  src={mediaSource}
                  muted
                  playsInline
                  autoPlay
                  className="w-full h-full object-cover object-center opacity-60 scale-105 transition-transform duration-700 group-hover:scale-110"
                />
              ) : mediaSource ? (
                <img
                  src={mediaSource}
                  alt={currentOffer.title}
                  className="w-full h-full object-cover object-center opacity-40 mix-blend-luminosity scale-105 transition-transform duration-700 group-hover:scale-110"
                />
              ) : null}

              {/* Gradiente de contraste escuro/marca */}
              <div 
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(to right, ${currentOffer.backgroundColor || '#15803d'}e6 0%, ${currentOffer.backgroundColor || '#15803d'}99 50%, transparent 100%)`
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
            </div>

            {/* Indicador de Tipo de Mídia (Vídeo) */}
            {isVideo && (
              <div className="absolute top-3 right-3 z-10 px-2 py-1 rounded-full bg-black/40 backdrop-blur-md text-[10px] font-semibold text-white/90 flex items-center gap-1 border border-white/20">
                <VolumeX className="w-3 h-3" />
                <span>Vídeo</span>
              </div>
            )}

            {/* Conteúdo Textual & Oferta */}
            <div className="relative z-10 max-w-sm sm:max-w-md text-white flex flex-col gap-2">
              {currentOffer.badge && (
                <div className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-wider bg-white/20 backdrop-blur-md text-white border border-white/30 shadow-xs">
                  <Tag className="w-3 h-3" />
                  <span>{currentOffer.badge}</span>
                </div>
              )}

              <h2 className="text-lg sm:text-2xl font-extrabold tracking-tight leading-tight drop-shadow-md">
                {currentOffer.destinationType === 'CUSTOM_OFFER' && currentOffer.promoTitle
                  ? currentOffer.promoTitle
                  : currentOffer.title}
              </h2>

              {(currentOffer.subtitle || (currentOffer.destinationType === 'CUSTOM_OFFER' && currentOffer.promoDescription)) && (
                <p className="text-xs sm:text-sm text-white/90 line-clamp-2 leading-relaxed drop-shadow-xs">
                  {currentOffer.destinationType === 'CUSTOM_OFFER' && currentOffer.promoDescription
                    ? currentOffer.promoDescription
                    : currentOffer.subtitle}
                </p>
              )}

              {/* Bloco de Preços Promocionais (se cadastrados ou se checkout promocional) */}
              {(() => {
                const isCustom = currentOffer.destinationType === 'CUSTOM_OFFER';
                const price = isCustom ? (currentOffer.promoPrice || currentOffer.promotionalPrice) : currentOffer.promotionalPrice;
                const origPrice = isCustom ? (currentOffer.promoOriginalPrice || currentOffer.originalPrice) : currentOffer.originalPrice;
                const discountPct = isCustom ? (currentOffer.promoDiscountPercentage || currentOffer.discountPercentage) : currentOffer.discountPercentage;

                if (!price && !discountPct) return null;

                return (
                  <div className="flex items-center gap-2 pt-1">
                    {price && (
                      <span className="text-base sm:text-lg font-mono font-black text-amber-300 drop-shadow-xs">
                        R$ {Number(price).toFixed(2)}
                      </span>
                    )}
                    {origPrice && Number(origPrice) > (Number(price) || 0) && (
                      <span className="text-xs font-mono line-through text-white/70">
                        R$ {Number(origPrice).toFixed(2)}
                      </span>
                    )}
                    {discountPct && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-400 text-gray-950 text-[10px] font-black uppercase">
                        <Percent className="w-2.5 h-2.5" />
                        {discountPct}% OFF
                      </span>
                    )}
                  </div>
                );
              })()}

              {currentOffer.destinationType !== 'BANNER_ONLY' && (
                <div className="pt-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-white/15 hover:bg-white/25 backdrop-blur-xs px-3.5 py-1.5 rounded-xl border border-white/25 transition-all shadow-xs group-hover:translate-x-0.5">
                    {currentOffer.destinationType === 'CUSTOM_OFFER' ? '⚡ Comprar Promoção' : 'Aproveitar Oferta'}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Barra de Progresso do Slide Atual */}
      {total > 1 && (
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/30 z-20 overflow-hidden">
          <div
            className="h-full bg-white transition-all duration-75 ease-linear shadow-xs"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Setas de Navegação Manual */}
      {total > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              prevSlide();
            }}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/30 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
            aria-label="Oferta anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              nextSlide();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/30 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
            aria-label="Próxima oferta"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* Indicadores de Slide */}
      {total > 1 && (
        <div className="absolute bottom-3 right-4 z-20 flex items-center gap-1.5">
          {validOffers.map((_, idx) => (
            <button
              key={idx}
              onClick={(e) => {
                e.stopPropagation();
                setProgress(0);
                setCurrentIndex(idx);
              }}
              className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                idx === currentIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
              }`}
              aria-label={`Ir para oferta ${idx + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};
