import React, { lazy, Suspense } from 'react';
import { ExternalLink, Navigation, Compass, AlertTriangle, MapPin, Smartphone, Clock, Radio } from 'lucide-react';
import { Button } from '../ui/Button';
import { Tenant, Order } from '../../types';
import { buildDriverNavigation, extractDestinationCoordinates, isValidCoordinate } from '../../lib/driverNavigation';

// Carregamento lazy com Suspense para isolamento de SSR/testes Node
const DriverInteractiveLeafletMap = lazy(() => import('./DriverInteractiveLeafletMap'));

export interface DriverDeliveryMapProps {
  tenant: Tenant;
  order: Order;
  driverCoords?: { lat: number; lng: number; accuracy?: number | null } | null;
  apiKey?: string;
  className?: string;
}

export const DriverDeliveryMap: React.FC<DriverDeliveryMapProps> = ({
  tenant,
  order,
  driverCoords,
  apiKey: propApiKey,
  className = '',
}) => {
  const envApiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const apiKey = propApiKey !== undefined ? propApiKey : envApiKey;

  const nav = buildDriverNavigation(tenant, order, apiKey);
  const destCoords = extractDestinationCoordinates(order);
  const hasValidDest = destCoords != null && isValidCoordinate(destCoords.lat, destCoords.lng);
  const hasValidDriver = driverCoords != null && isValidCoordinate(driverCoords.lat, driverCoords.lng);

  const openExternal = (url: string) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Área do Mapa Interativo do Entregador (Leaflet & OpenStreetMap) */}
      <div className="relative min-h-[14rem] sm:min-h-[16rem] w-full rounded-2xl overflow-hidden bg-slate-900 border border-gray-200 shadow-inner">
        {/* Selo: ETA indisponível (sem distância ou tempo fictício) */}
        <div className="absolute top-2 left-2 z-[400] bg-black/80 backdrop-blur-md px-2.5 py-1 rounded-lg text-[10px] font-semibold text-amber-300 border border-amber-500/30 shadow-md flex items-center gap-1.5 pointer-events-none">
          <Clock className="w-3 h-3 text-amber-400" />
          <span>ETA indisponível</span>
        </div>

        {/* Badges de Posição do Entregador e Destino */}
        <div className="absolute top-2 right-2 z-[400] flex flex-col items-end gap-1 pointer-events-none">
          {hasValidDriver ? (
            <div className="bg-blue-950/90 backdrop-blur-md px-2.5 py-1 rounded-lg text-[10px] text-blue-300 font-mono flex items-center gap-1 shadow-md border border-blue-800/40">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span>Sua Posição: {driverCoords!.lat.toFixed(4)}, {driverCoords!.lng.toFixed(4)}</span>
            </div>
          ) : (
            <div className="bg-slate-900/90 backdrop-blur-md px-2 py-1 rounded-lg text-[10px] text-amber-300 flex items-center gap-1 shadow-md border border-amber-800/30">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>Aguardando sinal GPS</span>
            </div>
          )}

          {hasValidDest ? (
            <div className="bg-emerald-950/90 backdrop-blur-md px-2 py-0.5 rounded-lg text-[10px] text-emerald-300 font-mono shadow-md border border-emerald-800/40">
              <span>Destino: {destCoords!.lat.toFixed(4)}, {destCoords!.lng.toFixed(4)}</span>
            </div>
          ) : (
            <div className="bg-black/75 backdrop-blur-md px-2 py-0.5 rounded-lg text-[10px] text-slate-300 shadow-md">
              <span>Destino: sem coordenadas GPS</span>
            </div>
          )}
        </div>

        {/* Coleta / Origem Tag overlay */}
        {tenant.name && (
          <div className="absolute bottom-2 left-2 z-[400] max-w-[80%] bg-black/80 backdrop-blur-md px-2.5 py-1 rounded-lg text-[10px] text-white flex items-center gap-1.5 shadow-md border border-white/10 pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <span className="truncate">
              <strong className="text-amber-300">Coleta:</strong> {tenant.name}
            </span>
          </div>
        )}

        <Suspense
          fallback={
            <div className="w-full h-56 sm:h-64 bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-2 p-4 text-center">
              <Radio className="w-6 h-6 text-emerald-400 animate-pulse" />
              <p className="text-xs font-semibold text-slate-200">Carregando mapa de navegação...</p>
              <p className="text-[10px] text-slate-500">Centralizando na sua posição GPS</p>
            </div>
          }
        >
          <div className="w-full h-56 sm:h-64 relative">
            <DriverInteractiveLeafletMap
              driverCoords={hasValidDriver ? driverCoords : undefined}
              destinationCoords={hasValidDest ? destCoords : undefined}
              destinationLabel={nav.destinationText}
              customerName={order.customerName}
            />
          </div>
        </Suspense>
      </div>

      {/* Detalhes de Coleta e Entrega (Painel de Rota) */}
      <div className="p-3 bg-gray-50 rounded-xl space-y-2 border border-gray-100 text-xs">
        <div className="flex items-center justify-between border-b border-gray-200/60 pb-1.5">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Painel de Rota</span>
          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60">
            Navegação da Entrega
          </span>
        </div>

        <div className="flex items-start gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Coleta (Estabelecimento)</span>
            <p className="font-semibold text-gray-900 truncate">{tenant.name}</p>
            {nav.originText && <p className="text-[11px] text-gray-600 truncate">{nav.originText}</p>}
          </div>
        </div>

        <div className="flex items-start gap-2 border-t border-gray-200/60 pt-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Entrega (Destino)</span>
            <p className="font-semibold text-gray-900">{nav.destinationText || 'Endereço não informado'}</p>
          </div>
        </div>
      </div>

      {/* Estado informativo quando o pedido não possui coordenadas geográficas reais */}
      {!hasValidDest && (
        <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 text-xs flex items-start gap-2">
          <MapPin className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-slate-800">Destino sem coordenadas no mapa</p>
            <p className="text-[11px] text-slate-600">
              {nav.destinationText
                ? `Endereço textual: ${nav.destinationText}. Use os botões abaixo para abrir a rota nos navegadores externos.`
                : 'O endereço de entrega não foi cadastrado com coordenadas. Utilize as instruções do pedido.'}
            </p>
          </div>
        </div>
      )}

      {/* Aviso obrigatório sobre celular em segundo plano */}
      <div className="p-2.5 rounded-xl bg-amber-50/90 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
        <Smartphone className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <span>
          <strong>Aviso:</strong> No celular, a transmissão de GPS pode parar quando o app fica em segundo plano ou a tela for bloqueada.
        </span>
      </div>

      {/* Botões de Ação para Navegação Externa (Google Maps e Waze) */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!nav.googleMaps}
          onClick={() => openExternal(nav.googleMaps)}
          className="text-xs py-2.5 font-medium border-gray-200 hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50/50 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          leftIcon={<Navigation className="w-3.5 h-3.5 text-blue-600" />}
        >
          <span>Google Maps</span>
          <ExternalLink className="w-3 h-3 text-gray-400" />
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!nav.waze}
          onClick={() => openExternal(nav.waze)}
          className="text-xs py-2.5 font-medium border-gray-200 hover:border-cyan-500 hover:text-cyan-700 hover:bg-cyan-50/50 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          leftIcon={<Compass className="w-3.5 h-3.5 text-cyan-500" />}
        >
          <span>Waze</span>
          <ExternalLink className="w-3 h-3 text-gray-400" />
        </Button>
      </div>

      {/* Alerta se o texto do destino estiver totalmente vazio */}
      {!nav.destinationText && !hasValidDest && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>O pedido não contém um endereço textual nem coordenadas de destino.</span>
        </div>
      )}
    </div>
  );
};

export default DriverDeliveryMap;
