import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Offer } from '../../types';
import { ChevronLeft, ChevronRight, Tag, ArrowRight, VolumeX, Percent } from 'lucide-react';
import { getCardDisplayDurationMs, isCardLiveAt, sortCardsForDisplay } from '../../utils/storefrontCards';

export interface OfferCarouselProps {
  offers: Offer[];
  onOfferClick?: (offer: Offer) => void;
  autoPlayInterval?: number; // mantido por compatibilidade (duração padrão vem de getCardDisplayDurationMs)
  /** Diferença (ms) entre o relógio do servidor e o local; filtra início/término pelo relógio do servidor. */
  clockOffsetMs?: number;
}

/** Sem progresso do vídeo por este tempo (rede travada / arquivo inválido) → avança para o próximo card. */
const VIDEO_STALL_TIMEOUT_MS = 8000;

export const OfferCarousel: React.FC<OfferCarouselProps> = ({
  offers,
  onOfferClick,
  clockOffsetMs = 0,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedKeyRef = useRef<string>('');
  const [now, setNow] = useState(() => Date.now() + clockOffsetMs);

  // Atualização periódica (10 s) para retirar cards que expiram / incluir os que iniciam sem refresh
  useEffect(() => {
    setNow(Date.now() + clockOffsetMs);
    const clockInterval = setInterval(() => {
      setNow(Date.now() + clockOffsetMs);
    }, 10000);
    return () => clearInterval(clockInterval);
  }, [clockOffsetMs]);

  // Apenas cards ativos e dentro da janela (início <= agora <= término), em ordem estável por `order`
  const validOffers = useMemo(
    () => sortCardsForDisplay(offers.filter(o => isCardLiveAt(o, now))),
    [offers, now]
  );

  const total = validOffers.length;

  // Ajusta índice caso a lista diminua
  useEffect(() => {
    if (currentIndex >= total && total > 0) {
      setCurrentIndex(0);
      setProgress(0);
    }
  }, [total, currentIndex]);

  const currentOffer: Offer | undefined = validOffers[currentIndex] || validOffers[0];

  // Duração deste slide (imagem: configurada; vídeo: duração real detectada)
  const currentDurationMs = currentOffer ? getCardDisplayDurationMs(currentOffer) : 5000;

  const nextSlide = useCallback(() => {
    setProgress(0);
    setCurrentIndex(prev => (total > 0 ? (prev + 1) % total : 0));
  }, [total]);

  const prevSlide = () => {
    setProgress(0);
    setCurrentIndex(prev => (prev - 1 + total) % total);
  };

  const currentKey = currentOffer ? `${currentOffer.source || 'OFFER'}:${currentOffer.id}` : '';
  const currentIsVideo = Boolean(currentOffer && currentOffer.mediaType === 'VIDEO' && (currentOffer.mediaUrl || currentOffer.imageUrl));

  // Gerenciamento do AutoPlay e Barra de Progresso
  useEffect(() => {
    if (total <= 1 || isPaused || !currentKey) {
      return;
    }

    // VÍDEO: avança no evento `ended` (duração REAL do arquivo). Watchdog avança se travar ou falhar.
    if (currentIsVideo && videoRef.current) {
      const videoEl = videoRef.current;
      // Reinicia do zero só quando o card muda (ao retomar após pausa, continua de onde parou).
      if (startedKeyRef.current !== currentKey) {
        startedKeyRef.current = currentKey;
        try {
          videoEl.currentTime = 0;
        } catch {
          // alguns navegadores não permitem antes do metadata; ignorar
        }
      }
      videoEl.play().catch(() => {});
      let lastProgressAt = Date.now();
      let lastTime = -1;

      const handleTimeUpdate = () => {
        if (videoEl.currentTime !== lastTime) {
          lastTime = videoEl.currentTime;
          lastProgressAt = Date.now();
        }
        if (videoEl.duration && !isNaN(videoEl.duration)) {
          const pct = (videoEl.currentTime / videoEl.duration) * 100;
          setProgress(Math.min(100, pct));
        }
      };
      const handleEnded = () => nextSlide();
      const handleError = () => nextSlide();

      videoEl.addEventListener('timeupdate', handleTimeUpdate);
      videoEl.addEventListener('ended', handleEnded);
      videoEl.addEventListener('error', handleError);
      const watchdog = window.setInterval(() => {
        if (Date.now() - lastProgressAt > VIDEO_STALL_TIMEOUT_MS) {
          nextSlide();
        }
      }, 1000);

      return () => {
        videoEl.removeEventListener('timeupdate', handleTimeUpdate);
        videoEl.removeEventListener('ended', handleEnded);
        videoEl.removeEventListener('error', handleError);
        window.clearInterval(watchdog);
      };
    }

    // IMAGEM: temporizador pela duração configurada
    const stepMs = 50;
    const totalSteps = Math.max(1, currentDurationMs / stepMs);
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
  }, [total, isPaused, currentIndex, currentDurationMs, currentKey, currentIsVideo, nextSlide]);

  if (!validOffers || validOffers.length === 0 || !currentOffer) {
    return null;
  }

  const mediaSource = currentOffer.mediaUrl || currentOffer.imageUrl;
  const isVideo = currentOffer.mediaType === 'VIDEO';
  const format = currentOffer.cardFormat || 'HORIZONTAL';

  // Proporções para o container principal
  const aspectClass = format === 'VERTICAL'
    ? 'aspect-4/5 max-h-[380px]'
    : format === 'QUADRADO' || format === 'SQUARE'
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
                key={currentKey}
                ref={videoRef}
                src={mediaSource}
                muted
                playsInline
                autoPlay
                loop={total <= 1}
                preload="auto"
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
                  key={currentKey}
                  ref={videoRef}
                  src={mediaSource}
                  muted
                  playsInline
                  autoPlay
                  loop={total <= 1}
                  preload="auto"
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
                    {currentOffer.ctaText || (currentOffer.destinationType === 'CUSTOM_OFFER' ? '⚡ Comprar Promoção' : 'Aproveitar Oferta')}
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
          {validOffers.map((o, idx) => (
            <button
              key={`${o.source || 'OFFER'}:${o.id}`}
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
