import React, { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, LocateFixed } from 'lucide-react';
import { GeoPoint } from '../../../lib/customer/geocode';

/**
 * Mapa de confirmação com PIN FIXO no centro: o cliente arrasta o mapa até o pin ficar na porta de casa.
 * Google Maps quando a chave está liberada para o domínio; senão OpenStreetMap (Leaflet) — mesmo comportamento.
 */
export const MapConfirm: React.FC<{
  center: GeoPoint;
  onCenterChange: (p: GeoPoint) => void;
  onLocateMe?: () => void;
  moving?: (m: boolean) => void;
}> = ({ center, onCenterChange, onLocateMe, moving }) => {
  const [engine, setEngine] = useState<'loading' | 'google' | 'leaflet'>('loading');
  const googleDiv = useRef<HTMLDivElement>(null);
  const gmapRef = useRef<any>(null);
  const [dragging, setDragging] = useState(false);
  const cbRef = useRef(onCenterChange);
  cbRef.current = onCenterChange;
  const movingRef = useRef(moving);
  movingRef.current = moving;

  useEffect(() => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key) { setEngine('leaflet'); return; }
    let alive = true;
    const win = window as any;
    const prev = win.gm_authFailure;
    win.gm_authFailure = () => { if (alive) setEngine('leaflet'); if (typeof prev === 'function') prev(); };
    const t = setTimeout(() => { if (alive && !gmapRef.current) setEngine('leaflet'); }, 8000);
    try {
      setOptions({ key, v: 'weekly', language: 'pt-BR', region: 'BR' });
    } catch {
      // já configurado pelo autocomplete
    }
    importLibrary('maps')
      .then((lib: any) => {
        if (!alive || !googleDiv.current) return;
        const map = new lib.Map(googleDiv.current, {
          center, zoom: 18, disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: false, zoomControl: false,
        });
        gmapRef.current = map;
        setEngine('google');
        map.addListener('dragstart', () => { setDragging(true); movingRef.current?.(true); });
        map.addListener('idle', () => {
          setDragging(false);
          movingRef.current?.(false);
          const c = map.getCenter();
          if (c) cbRef.current({ lat: c.lat(), lng: c.lng() });
        });
      })
      .catch(() => alive && setEngine('leaflet'));
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recentraliza quando o centro muda por fora (ex.: "usar minha localização").
  useEffect(() => {
    const m = gmapRef.current;
    if (engine === 'google' && m) {
      const c = m.getCenter();
      if (!c || Math.abs(c.lat() - center.lat) > 1e-6 || Math.abs(c.lng() - center.lng) > 1e-6) m.panTo(center);
    }
  }, [center.lat, center.lng, engine]);

  return (
    <div className="relative w-full h-full bg-gray-100 overflow-hidden" data-testid="map-confirm" data-engine={engine}>
      <div ref={googleDiv} className={engine === 'google' ? 'absolute inset-0' : 'absolute inset-0 invisible'} />
      {engine === 'leaflet' && (
        <MapContainer center={[center.lat, center.lng]} zoom={18} zoomControl={false} attributionControl className="absolute inset-0 z-0" style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" maxZoom={19} />
          <LeafletCenterWatcher center={center} onDrag={d => { setDragging(d); movingRef.current?.(d); }} onIdle={p => cbRef.current(p)} />
        </MapContainer>
      )}
      {engine === 'loading' && <div className="absolute inset-0 animate-pulse bg-gray-200" />}

      {/* Pin fixo no centro (a ponta encosta no centro exato do mapa) */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full flex flex-col items-center">
        <div className={`transition-transform duration-200 ${dragging ? '-translate-y-2' : ''}`}>
          <div className="bg-gray-900 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg shadow-md mb-1 whitespace-nowrap">
            {dragging ? 'Solte para confirmar' : 'Você está aqui?'}
          </div>
          <MapPin className="w-10 h-10 mx-auto text-rose-600 fill-rose-600 drop-shadow-md" strokeWidth={1.5} color="#ffffff" />
        </div>
      </div>
      <div className={`pointer-events-none absolute left-1/2 top-1/2 z-[499] -translate-x-1/2 w-3 h-1.5 rounded-full bg-black/30 transition-all ${dragging ? 'scale-150 opacity-60' : ''}`} />

      {onLocateMe && (
        <button type="button" onClick={onLocateMe} aria-label="Usar minha localização"
          className="absolute right-3 bottom-3 z-[500] w-11 h-11 rounded-full bg-white shadow-lg flex items-center justify-center text-gray-800 hover:bg-gray-50 cursor-pointer">
          <LocateFixed className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};

const LeafletCenterWatcher: React.FC<{ center: GeoPoint; onDrag: (d: boolean) => void; onIdle: (p: GeoPoint) => void }> = ({ center, onDrag, onIdle }) => {
  const map = useMapEvents({
    movestart: () => onDrag(true),
    moveend: () => {
      onDrag(false);
      const c = map.getCenter();
      onIdle({ lat: c.lat, lng: c.lng });
    },
  });
  useEffect(() => {
    const c = map.getCenter();
    if (Math.abs(c.lat - center.lat) > 1e-6 || Math.abs(c.lng - center.lng) > 1e-6) map.setView([center.lat, center.lng], map.getZoom(), { animate: true });
  }, [center.lat, center.lng, map]);
  return null;
};
