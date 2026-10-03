import React, { useState, useEffect, useRef } from 'react';
import { Offer } from '../../types';
import { ChevronLeft, ChevronRight, Tag, ArrowRight } from 'lucide-react';

export interface OfferCarouselProps {
  offers: Offer[];
  onOfferClick?: (offer: Offer) => void;
  autoPlayInterval?: number; // default 5000ms
}

export const OfferCarousel: React.FC<OfferCarouselProps> = ({
  offers,
  onOfferClick,
  autoPlayInterval = 5000,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressTimerRef = useRef<number | null>(null);

  const total = offers.length;

  useEffect(() => {
    if (total <= 1 || isPaused) {
      return;
    }

    const intervalStep = 50; // update progress every 50ms
    const totalSteps = autoPlayInterval / intervalStep;
    let currentStep = 0;

    progressTimerRef.current = window.setInterval(() => {
      currentStep += 1;
      setProgress((currentStep / totalSteps) * 100);

      if (currentStep >= totalSteps) {
        currentStep = 0;
        setProgress(0);
        setCurrentIndex((prev) => (prev + 1) % total);
      }
    }, intervalStep);

    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    };
  }, [total, autoPlayInterval, isPaused, currentIndex]);

  if (!offers || offers.length === 0) {
    return null;
  }

  const currentOffer = offers[currentIndex];

  const handlePrev = () => {
    setProgress(0);
    setCurrentIndex((prev) => (prev - 1 + total) % total);
  };

  const handleNext = () => {
    setProgress(0);
    setCurrentIndex((prev) => (prev + 1) % total);
  };

  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl shadow-sm group select-none"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
    >
      {/* Banner Card */}
      <div
        className="relative min-h-[190px] sm:min-h-[220px] md:min-h-[240px] flex items-center p-6 sm:p-8 cursor-pointer overflow-hidden transition-all duration-500"
        style={{
          backgroundColor: currentOffer.backgroundColor || '#15803d',
        }}
        onClick={() => onOfferClick && onOfferClick(currentOffer)}
      >
        {/* Background Image Overlay with Gradient */}
        <div className="absolute inset-0 z-0">
          <img
            src={currentOffer.imageUrl}
            alt={currentOffer.title}
            className="w-full h-full object-cover object-center opacity-30 mix-blend-luminosity scale-105 transition-transform duration-700 group-hover:scale-110"
          />
          <div 
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to right, ${currentOffer.backgroundColor || '#15803d'} 45%, transparent 100%)`
            }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 max-w-sm sm:max-w-md text-white flex flex-col gap-2">
          {currentOffer.badge && (
            <div className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-black uppercase tracking-wider bg-white/20 backdrop-blur-md text-white border border-white/30">
              <Tag className="w-3 h-3" />
              <span>{currentOffer.badge}</span>
            </div>
          )}

          <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight leading-tight drop-shadow-xs">
            {currentOffer.title}
          </h2>

          <p className="text-xs sm:text-sm text-white/90 line-clamp-2 leading-relaxed">
            {currentOffer.subtitle}
          </p>

          <div className="pt-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-xl border border-white/20 transition-colors">
              Aproveitar Oferta
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
      </div>

      {/* Progress Bar (5s auto-play visualization) */}
      {total > 1 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20 z-20 overflow-hidden">
          <div
            className="h-full bg-white/90 transition-all duration-75 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Manual Navigation Arrows */}
      {total > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/25 hover:bg-black/50 text-white flex items-center justify-center backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
            aria-label="Oferta anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/25 hover:bg-black/50 text-white flex items-center justify-center backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
            aria-label="Próxima oferta"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* Slide Indicators */}
      {total > 1 && (
        <div className="absolute bottom-3 right-4 z-20 flex items-center gap-1.5">
          {offers.map((_, idx) => (
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
