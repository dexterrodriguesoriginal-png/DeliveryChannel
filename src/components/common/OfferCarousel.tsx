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
  // Proporção consistente 16:9 para todos os criativos (sem saltos de layout nem deformação)
  const aspectClass = 'aspect-16/9 w-full';

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl sm:rounded-3xl shadow-sm group select-none transition-all duration-300"
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
      {/* Banner Card Container 16:9 */}
      <div
        className={`relative ${aspectClass} w-full flex items-center p-0 ${
          currentOffer.destinationType === 'BANNER_ONLY' && !currentOffer.internalLink && !currentOffer.linkUrl
            ? 'cursor-default'
            : 'cursor-pointer'
        } overflow-hidden bg-black transition-all duration-500`}
        onClick={() => {
          if (onOfferClick) {
            onOfferClick(currentOffer);
          }
        }}
      >
        {/* ================================================================ */}
        {/* MÍDIA COMPLETA PURA (A ARTE DO ESTABELECIMENTO É 100% SOBERANA)  */}
        {/* Ocupa toda a área do card sem faixas coloridas e sem textos      */}
        {/* ================================================================ */}
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
      </div>

      {/* Setas de Navegação Manual */}
      {total > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              prevSlide();
            }}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer shadow-md"
            aria-label="Oferta anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              nextSlide();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/70 text-white flex items-center justify-center backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer shadow-md"
            aria-label="Próxima oferta"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* ================================================================ */}
      {/* INDICADORES DE PROGRESSO SEGMENTADOS NO ESTILO DO IFOOD          */}
      {/* 1 anúncio = 1 segmento. Segmento ativo preenche de 0 a 100%.    */}
      {/* Segmentos anteriores ficam concluídos (100%) e próximos vazios.  */}
      {/* ================================================================ */}
      {total > 1 && (
        <div className="absolute bottom-0 left-0 right-0 z-30 pt-7 pb-2.5 px-3 sm:px-4 bg-gradient-to-t from-black/80 via-black/35 to-transparent pointer-events-auto">
          <div className="flex items-center gap-1.5 sm:gap-2 w-full">
            {validOffers.map((o, idx) => {
              const isPast = idx < currentIndex;
              const isCurrent = idx === currentIndex;
              const fillPct = isPast ? 100 : isCurrent ? progress : 0;

              return (
                <button
                  key={`${o.source || 'OFFER'}:${o.id}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setProgress(0);
                    setCurrentIndex(idx);
                  }}
                  className="flex-1 h-1 sm:h-1.5 rounded-full overflow-hidden bg-white/35 hover:bg-white/55 transition-colors cursor-pointer relative shadow-2xs"
                  aria-label={`Ir para card promocional ${idx + 1} de ${total}`}
                  title={`Card ${idx + 1}: ${o.title || 'Oferta'}`}
                >
                  <div
                    className="h-full bg-white rounded-full transition-all duration-75 ease-linear shadow-xs"
                    style={{ width: `${fillPct}%` }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
