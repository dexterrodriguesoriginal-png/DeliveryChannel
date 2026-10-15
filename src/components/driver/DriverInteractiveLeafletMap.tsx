import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { isValidCoordinate } from '../../lib/driverNavigation';

export interface DriverInteractiveLeafletMapProps {
  driverCoords?: { lat: number; lng: number; accuracy?: number | null } | null;
  destinationCoords?: { lat: number; lng: number } | null;
  destinationLabel?: string;
  customerName?: string;
}

// Ícone do entregador (ponto azul pulsante com anel branco de alta visibilidade)
const driverMarkerIcon = L.divIcon({
  className: 'driver-live-marker',
  html: `
    <div style="position:relative;width:28px;height:28px;display:flex;align-items:center;justify-content:center;">
      <span style="position:absolute;inset:0;border-radius:9999px;background-color:#3b82f6;opacity:0.35;animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></span>
      <div style="width:20px;height:20px;border-radius:9999px;background-color:#2563eb;border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
        <div style="width:6px;height:6px;border-radius:9999px;background-color:#ffffff;"></div>
      </div>
    </div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

// Ícone do destino (pin vermelho nítido)
const destinationMarkerIcon = L.divIcon({
  className: 'destination-live-marker',
  html: `
    <div style="position:relative;width:30px;height:30px;display:flex;align-items:center;justify-content:center;">
      <div style="width:24px;height:24px;border-radius:9999px;background-color:#e11d48;border:2.5px solid #ffffff;box-shadow:0 2px 8px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:white;font-size:12px;font-weight:bold;">
        📍
      </div>
    </div>
  `,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

// Controlador de centralização suave: atualiza a visualização sem saltos bruscos
function MapRecenterController({ coords }: { coords?: { lat: number; lng: number } | null }) {
  const map = useMap();
  const lastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    map.invalidateSize();
  }, [map]);

  useEffect(() => {
    if (!coords || !isValidCoordinate(coords.lat, coords.lng)) return;

    const last = lastCoordsRef.current;
    if (!last) {
      lastCoordsRef.current = coords;
      map.setView([coords.lat, coords.lng], 16);
      return;
    }

    const dLat = Math.abs(coords.lat - last.lat);
    const dLng = Math.abs(coords.lng - last.lng);
    // Suaviza movimentos pequenos (< ~5m) e realiza pan suave sem saltos bruscos
    if (dLat > 0.00005 || dLng > 0.00005) {
      lastCoordsRef.current = coords;
      map.panTo([coords.lat, coords.lng], { animate: true, duration: 0.8 });
    }
  }, [coords, map]);

  return null;
}

export const DriverInteractiveLeafletMap: React.FC<DriverInteractiveLeafletMapProps> = ({
  driverCoords,
  destinationCoords,
  destinationLabel,
  customerName,
}) => {
  const hasValidDriverCoords =
    driverCoords != null && isValidCoordinate(driverCoords.lat, driverCoords.lng);

  const hasValidDestCoords =
    destinationCoords != null && isValidCoordinate(destinationCoords.lat, destinationCoords.lng);

  // Centro padrão inicial: posição do entregador se houver; senão destino se houver; senão centro padrão SP
  const initialCenter: [number, number] = hasValidDriverCoords
    ? [driverCoords.lat, driverCoords.lng]
    : hasValidDestCoords
    ? [destinationCoords.lat, destinationCoords.lng]
    : [-23.5505, -46.6333];

  return (
    <MapContainer
      center={initialCenter}
      zoom={16}
      scrollWheelZoom={true}
      className="w-full h-full absolute inset-0 z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapRecenterController coords={hasValidDriverCoords ? driverCoords : undefined} />

      {/* Marcador e raio de precisão da posição atual do entregador */}
      {hasValidDriverCoords && (
        <>
          <Marker position={[driverCoords.lat, driverCoords.lng]} icon={driverMarkerIcon}>
            <Popup>
              <div className="text-xs font-sans">
                <p className="font-bold text-blue-700">Sua Posição</p>
                <p className="text-gray-600 font-mono text-[10px]">
                  {driverCoords.lat.toFixed(5)}, {driverCoords.lng.toFixed(5)}
                </p>
                {driverCoords.accuracy != null && (
                  <p className="text-gray-500 text-[10px]">
                    Precisão: ~{Math.round(driverCoords.accuracy)}m
                  </p>
                )}
              </div>
            </Popup>
          </Marker>

          {typeof driverCoords.accuracy === 'number' &&
            driverCoords.accuracy > 0 &&
            driverCoords.accuracy <= 500 && (
              <Circle
                center={[driverCoords.lat, driverCoords.lng]}
                radius={driverCoords.accuracy}
                pathOptions={{
                  color: '#3b82f6',
                  fillColor: '#3b82f6',
                  fillOpacity: 0.12,
                  weight: 1,
                }}
              />
            )}
        </>
      )}

      {/* Marcador do destino SOMENTE quando houver coordenadas reais e válidas */}
      {hasValidDestCoords && (
        <Marker position={[destinationCoords.lat, destinationCoords.lng]} icon={destinationMarkerIcon}>
          <Popup>
            <div className="text-xs font-sans">
              <p className="font-bold text-rose-600">Destino da Entrega</p>
              {customerName && <p className="font-medium text-gray-800">{customerName}</p>}
              {destinationLabel && (
                <p className="text-gray-600 text-[11px] mt-0.5">{destinationLabel}</p>
              )}
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
};

export default DriverInteractiveLeafletMap;
