import { useState, useEffect, useRef, useCallback } from 'react';
import { driverLocationRepository, DriverLocationUpsertResult } from '../repositories/driverLocationRepository';
import { DriverAvailability } from './membershipResolution';

export type LocationConsent = 'PROMPT' | 'ACCEPTED' | 'REJECTED';

const STORAGE_KEY_CONSENT = 'delivery_channel_driver_location_consent';
const STORAGE_KEY_PAUSED = 'delivery_channel_driver_location_paused';

export interface DriverCoords {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

/**
 * Determina se a localização deve ser enviada e com qual intervalo.
 * - 15s (15000ms): SOMENTE quando houver pedido efetivamente OUT_FOR_DELIVERY da loja correspondente.
 * - 60s (60000ms): quando disponível (AVAILABLE ou ON_DELIVERY sem pedido OUT_FOR_DELIVERY ativo da loja).
 * - 0ms (shouldTrack = false): quando UNAVAILABLE, SUSPENDED, UNKNOWN, pausado ou sem consentimento.
 */
export function resolveDriverTrackingDecision(
  availability: DriverAvailability,
  isOutForDelivery: boolean,
  consent: LocationConsent,
  isPaused: boolean
): { shouldTrack: boolean; intervalMs: number } {
  const isPermittedStatus = availability === 'AVAILABLE' || availability === 'ON_DELIVERY';
  if (consent !== 'ACCEPTED' || isPaused || !isPermittedStatus) {
    return { shouldTrack: false, intervalMs: 0 };
  }
  const isEnRoute = Boolean(isOutForDelivery);
  return { shouldTrack: true, intervalMs: isEnRoute ? 15000 : 60000 };
}

export function useDriverLocationTracking(
  availability: DriverAvailability,
  isOutForDelivery: boolean
) {
  const [consent, setConsent] = useState<LocationConsent>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONSENT);
      if (saved === 'ACCEPTED' || saved === 'REJECTED') return saved;
    } catch {}
    return 'PROMPT';
  });

  const [isPaused, setIsPaused] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_PAUSED) === 'true';
    } catch {}
    return false;
  });

  const [currentCoords, setCurrentCoords] = useState<DriverCoords | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [lastResult, setLastResult] = useState<DriverLocationUpsertResult | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const coordsRef = useRef<DriverCoords | null>(null);
  coordsRef.current = currentCoords;

  const handleAcceptConsent = useCallback(() => {
    setConsent('ACCEPTED');
    try {
      localStorage.setItem(STORAGE_KEY_CONSENT, 'ACCEPTED');
    } catch {}
  }, []);

  const handleRejectConsent = useCallback(() => {
    setConsent('REJECTED');
    try {
      localStorage.setItem(STORAGE_KEY_CONSENT, 'REJECTED');
    } catch {}
  }, []);

  const handleTogglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_PAUSED, String(next));
      } catch {}
      return next;
    });
  }, []);

  // 1. Geolocalização contínua via watchPosition (apenas com consentimento, não pausado e com status ativo)
  useEffect(() => {
    const isPermittedStatus = availability === 'AVAILABLE' || availability === 'ON_DELIVERY';
    if (consent !== 'ACCEPTED' || isPaused || !isPermittedStatus) {
      return;
    }

    if (!('geolocation' in navigator)) {
      setGeoError('Geolocalização não suportada neste dispositivo.');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoError(null);
        const coords: DriverCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          heading: pos.coords.heading ?? null,
          speed: pos.coords.speed ?? null,
          timestamp: pos.timestamp,
        };
        setCurrentCoords(coords);
      },
      (err) => {
        console.warn('[useDriverLocationTracking] Erro GPS:', err.message);
        setGeoError(err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 5000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [consent, isPaused, availability]);

  const isSendingRef = useRef(false);

  // 2. Envio periódico para o backend via upsert_my_location
  // Regras de privacidade e negócio:
  // - 15s: SOMENTE quando existir um pedido efetivamente OUT_FOR_DELIVERY da loja correspondente (isOutForDelivery === true).
  //   O status ON_DELIVERY isoladamente NÃO é condição suficiente para atualizações a cada 15s.
  // - 60s: enquanto disponível (AVAILABLE ou ON_DELIVERY sem pedido OUT_FOR_DELIVERY ativo da loja).
  // - Parar ao ficar indisponível, suspenso, sem consentimento ou pausado.
  useEffect(() => {
    const decision = resolveDriverTrackingDecision(availability, isOutForDelivery, consent, isPaused);
    if (!decision.shouldTrack) {
      return;
    }

    const intervalMs = decision.intervalMs;

    const sendCurrentLocation = async () => {
      const coords = coordsRef.current;
      if (!coords) return;
      if (isSendingRef.current) return;
      isSendingRef.current = true;

      setIsSending(true);
      try {
        const res = await driverLocationRepository.upsertMyLocation({
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracy,
          heading: coords.heading,
          speed: coords.speed,
        });
        if (res) {
          setLastSentAt(new Date());
          setLastResult(res);
        }
      } catch (err) {
        // Falha tratada silenciosamente sem travar a interface
      } finally {
        isSendingRef.current = false;
        setIsSending(false);
      }
    };

    // Envio inicial imediato se já tivermos coordenadas ao recalcular
    if (coordsRef.current) {
      sendCurrentLocation();
    }

    const timer = setInterval(sendCurrentLocation, intervalMs);
    return () => clearInterval(timer);
  }, [consent, isPaused, availability, isOutForDelivery]);

  return {
    consent,
    isPaused,
    currentCoords,
    isSending,
    lastSentAt,
    lastResult,
    geoError,
    handleAcceptConsent,
    handleRejectConsent,
    handleTogglePause,
  };
}
