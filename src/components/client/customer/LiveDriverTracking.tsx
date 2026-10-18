/**
 * Mapa ao vivo do motoboy no detalhe do pedido (cliente), só enquanto OUT_FOR_DELIVERY.
 * Leaflet/OSM (mesmo padrão do DriverInteractiveLeafletMap). Polling ~12 s só com a aba visível;
 * para sozinho quando o status sai de "em rota" (DELIVERED/CANCELLED desmontam o componente).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Bike, Crosshair, AlertTriangle } from 'lucide-react';
import { customerAppRepository } from '../../../repositories/customerAppRepository';
import {
  LIVE_POLL_MS, boundsFor, interpolateLatLng, isValidLatLng, shouldAnimateMove, shouldPollLive, updatedAgoLabel,
  type DriverLivePosition, type LatLng,
} from '../../../lib/customer/liveTracking';

const ANIM_MS = 1200;

const driverIcon = L.divIcon({
  className: 'customer-live-driver-marker',
  html: `
    <div style="position:relative;width:38px;height:38px;display:flex;align-items:center;justify-content:center;">
      <span style="position:absolute;inset:0;border-radius:9999px;background:#7c3aed;opacity:.25;animation:ping 1.6s cubic-bezier(0,0,.2,1) infinite;"></span>
      <div style="width:30px;height:30px;border-radius:9999px;background:#6d28d9;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;">🛵</div>
    </div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

const destinationIcon = L.divIcon({
  className: 'customer-live-dest-marker',
  html: `
    <div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;">
      <div style="width:26px;height:26px;border-radius:9999px;background:#e11d48;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:13px;">🏠</div>
    </div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

/** Marcador do motoboy animado entre leituras (rAF + easing), sem re-render por quadro. */
function AnimatedDriverMarker({ target }: { target: LatLng }) {
  const markerRef = useRef<L.Marker | null>(null);
  const shownRef = useRef<LatLng | null>(null);
  const [initial] = useState<LatLng>(target);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const from = shownRef.current;
    if (!shouldAnimateMove(from, target) || typeof requestAnimationFrame !== 'function') {
      marker.setLatLng([target.lat, target.lng]);
      shownRef.current = target;
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / ANIM_MS;
      const p = interpolateLatLng(from!, target, t);
      marker.setLatLng([p.lat, p.lng]);
      shownRef.current = p;
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target.lat, target.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Marker ref={markerRef} position={[initial.lat, initial.lng]} icon={driverIcon} zIndexOffset={1000} />;
}

/** Enquadra motoboy + destino; reenquadra só se o motoboy sair da tela e o cliente não mexeu no mapa. */
function FitController({ driver, destination, recenterTick }: { driver: LatLng | null; destination: LatLng | null; recenterTick: number }) {
  const map = useMap();
  const userMovedRef = useRef(false);
  const fittedRef = useRef(false);

  useEffect(() => {
    const onDrag = () => { userMovedRef.current = true; };
    map.on('dragstart', onDrag);
    map.on('zoomstart', onDrag);
    // Mapa dentro de cartão/aba animada: corrige tiles cinza.
    const timers = [0, 150, 400, 900].map(ms => window.setTimeout(() => map.invalidateSize(), ms));
    return () => { map.off('dragstart', onDrag); map.off('zoomstart', onDrag); timers.forEach(clearTimeout); };
  }, [map]);

  const fit = useCallback(() => {
    const b = boundsFor([driver, destination]);
    if (!b) return;
    map.fitBounds(b, { padding: [36, 36], maxZoom: 17, animate: fittedRef.current });
    fittedRef.current = true;
    // fitBounds dispara zoomstart; não conta como gesto do cliente.
    window.setTimeout(() => { userMovedRef.current = false; }, 0);
  }, [driver?.lat, driver?.lng, destination?.lat, destination?.lng, map]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!fittedRef.current) { fit(); return; }
    if (userMovedRef.current || !driver) return;
    if (!map.getBounds().pad(-0.1).contains([driver.lat, driver.lng])) fit();
  }, [fit, driver, map]);

  useEffect(() => { if (recenterTick > 0) { userMovedRef.current = false; fit(); } }, [recenterTick]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export interface LiveDriverTrackingProps {
  orderId: string;
  status: string;
  destination?: { latitude?: number | string; longitude?: number | string } | null;
  destinationLabel?: string;
  accentColor?: string;
  /** Teste/injeção: fonte da posição (padrão: RPC). */
  fetchLocation?: (orderId: string) => Promise<DriverLivePosition | null | 'unavailable'>;
}

export const LiveDriverTracking: React.FC<LiveDriverTrackingProps> = ({
  orderId, status, destination, destinationLabel, fetchLocation = customerAppRepository.getOrderDriverLocation,
}) => {
  const [pos, setPos] = useState<DriverLivePosition | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [recenterTick, setRecenterTick] = useState(0);
  const inFlight = useRef(false);

  const dest: LatLng | null = (() => {
    const p = { lat: Number(destination?.latitude), lng: Number(destination?.longitude) };
    return isValidLatLng(p) ? p : null;
  })();

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await fetchLocation(orderId);
      if (r === 'unavailable') { setUnavailable(true); return; }
      // Vazio = servidor diz que não há o que mostrar agora; mantém a última posição conhecida (marcada como antiga pelo relógio).
      if (r) setPos(r);
    } catch (e) {
      console.warn('[tracking] localização do entregador:', (e as Error).message);
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, [fetchLocation, orderId]);

  useEffect(() => {
    if (unavailable) return;
    let timer: number | undefined;
    const tick = () => {
      if (shouldPollLive(status, document.visibilityState)) void poll();
    };
    const start = () => { window.clearInterval(timer); tick(); timer = window.setInterval(tick, LIVE_POLL_MS); };
    const onVis = () => { if (document.visibilityState === 'visible') start(); else window.clearInterval(timer); };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [poll, status, unavailable]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  if (status !== 'OUT_FOR_DELIVERY' || unavailable) return null;

  const driver: LatLng | null = pos ? { lat: pos.lat, lng: pos.lng } : null;
  const stale = !!pos && (pos.isStale || now - Date.parse(pos.recordedAt) > 2 * 60_000);
  const center = driver || dest || { lat: -23.5505, lng: -46.6333 };

  return (
    <div className="rounded-2xl border border-purple-200 overflow-hidden bg-white" data-testid="live-tracking">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-purple-50 border-b border-purple-100">
        <div className="flex items-center gap-1.5 min-w-0">
          <Bike className="w-4 h-4 text-purple-700 shrink-0" />
          <span className="text-xs font-bold text-purple-900 truncate">Seu pedido está a caminho</span>
        </div>
        <span className={`text-[11px] font-mono shrink-0 ${stale ? 'text-amber-700' : 'text-purple-700'}`} data-testid="live-updated">
          {pos ? updatedAgoLabel(pos.recordedAt, now) : loaded ? 'Aguardando sinal' : 'Localizando…'}
        </span>
      </div>

      <div className="relative h-56 sm:h-64 z-0" data-testid="live-map">
        {(driver || dest) ? (
          <MapContainer center={[center.lat, center.lng]} zoom={15} scrollWheelZoom={false} className="w-full h-full absolute inset-0 z-0" attributionControl>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {dest && <Marker position={[dest.lat, dest.lng]} icon={destinationIcon} title={destinationLabel || 'Endereço de entrega'} />}
            {driver && <AnimatedDriverMarker target={driver} />}
            <FitController driver={driver} destination={dest} recenterTick={recenterTick} />
          </MapContainer>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500 bg-gray-50">
            {loaded ? 'O entregador ainda não compartilhou a localização.' : 'Carregando mapa…'}
          </div>
        )}
        {(driver || dest) && (
          <button
            type="button"
            onClick={() => setRecenterTick(t => t + 1)}
            className="absolute right-2 bottom-2 z-[500] w-9 h-9 rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center cursor-pointer"
            aria-label="Centralizar mapa"
            data-testid="live-recenter"
          >
            <Crosshair className="w-4 h-4 text-gray-700" />
          </button>
        )}
      </div>

      {(stale || (loaded && !pos)) && (
        <div className="flex items-start gap-1.5 px-3 py-2 bg-amber-50 border-t border-amber-100 text-[11px] text-amber-800" data-testid="live-stale">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>
            {pos
              ? 'A localização do entregador não é atualizada há alguns minutos (pode ser sinal fraco). Ele continua a caminho.'
              : 'Ainda sem sinal do entregador. O mapa aparece assim que a localização chegar.'}
          </span>
        </div>
      )}
    </div>
  );
};

export default LiveDriverTracking;
