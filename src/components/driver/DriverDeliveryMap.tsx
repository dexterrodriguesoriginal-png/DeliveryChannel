import React, { useState } from 'react';
import { ExternalLink, Navigation, Compass, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Tenant, Order } from '../../types';
import { buildDriverNavigation } from '../../lib/driverNavigation';

interface DriverDeliveryMapProps {
  tenant: Tenant;
  order: Order;
  apiKey?: string;
  className?: string;
}

export const DriverDeliveryMap: React.FC<DriverDeliveryMapProps> = ({
  tenant,
  order,
  apiKey: propApiKey,
  className = '',
}) => {
  const [mapError, setMapError] = useState(false);
  const envApiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const apiKey = propApiKey !== undefined ? propApiKey : envApiKey;

  const nav = buildDriverNavigation(tenant, order, apiKey);

  const openExternal = (url: string) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Embedded Map Area or Alternative Route Panel */}
      <div className="relative min-h-[11rem] w-full rounded-2xl overflow-hidden bg-slate-900 border border-gray-200 shadow-inner">
        {nav.embedMapUrl && !mapError ? (
          <>
            <iframe
              title="Mapa da Entrega"
              src={nav.embedMapUrl}
              className="w-full h-48 sm:h-52 border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              onError={() => setMapError(true)}
              allowFullScreen
            />
            {/* Coleta / Origem Tag Badge overlay */}
            {nav.originText && (
              <div className="absolute top-2 left-2 z-10 max-w-[80%] bg-black/75 backdrop-blur-md px-2.5 py-1 rounded-lg text-[10px] text-white flex items-center gap-1.5 shadow-md">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <span className="truncate">
                  <strong className="text-amber-300">Coleta:</strong> {tenant.name}
                </span>
              </div>
            )}
            {/* Real coordinates indicator */}
            {nav.hasCoordinates && nav.coordinates && (
              <div className="absolute top-2 right-2 z-10 bg-emerald-950/80 backdrop-blur-md px-2 py-1 rounded-lg text-[10px] text-emerald-300 font-mono flex items-center gap-1 shadow-md">
                <span>GPS: {nav.coordinates.lat.toFixed(4)}, {nav.coordinates.lng.toFixed(4)}</span>
              </div>
            )}
          </>
        ) : (
          <div className="w-full p-4 flex flex-col justify-between bg-slate-900 text-slate-300">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Compass className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-100">Painel de Rota</p>
                  <p className="text-[10px] text-slate-400">Coleta e entrega do pedido</p>
                </div>
              </div>
              {nav.hasCoordinates && nav.coordinates && (
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded">
                  GPS: {nav.coordinates.lat.toFixed(4)}, {nav.coordinates.lng.toFixed(4)}
                </span>
              )}
            </div>

            <div className="space-y-2.5 my-3">
              {/* Coleta */}
              <div className="flex items-start gap-2.5">
                <div className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0 ring-4 ring-amber-400/20" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-amber-300">Coleta (Estabelecimento)</p>
                  <p className="text-xs text-slate-200 font-medium truncate">{tenant.name}</p>
                  {nav.originText && (
                    <p className="text-[11px] text-slate-400 truncate">{nav.originText}</p>
                  )}
                </div>
              </div>

              {/* Entrega */}
              <div className="flex items-start gap-2.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0 ring-4 ring-emerald-400/20" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-300">Entrega (Destino)</p>
                  <p className="text-xs text-slate-200 font-medium">{nav.destinationText || 'Endereço não informado'}</p>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-slate-400 border-t border-slate-800 pt-2">
              Abra a rota em tempo real no Google Maps ou Waze pelos botões abaixo:
            </p>
          </div>
        )}
      </div>

      {/* Navigation App Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!nav.googleMaps}
          onClick={() => openExternal(nav.googleMaps)}
          className="text-xs py-2.5 font-medium border-gray-200 hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50/50 flex items-center justify-center gap-1.5 transition-colors"
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
          className="text-xs py-2.5 font-medium border-gray-200 hover:border-cyan-500 hover:text-cyan-700 hover:bg-cyan-50/50 flex items-center justify-center gap-1.5 transition-colors"
          leftIcon={<Compass className="w-3.5 h-3.5 text-cyan-500" />}
        >
          <span>Waze</span>
          <ExternalLink className="w-3 h-3 text-gray-400" />
        </Button>
      </div>

      {/* Notice if destination text is empty */}
      {!nav.destinationText && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>O pedido não contém um endereço textual nem coordenadas de destino.</span>
        </div>
      )}
    </div>
  );
};
