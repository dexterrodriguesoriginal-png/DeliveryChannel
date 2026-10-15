import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { 
  Bike, 
  Search, 
  MapPin, 
  Navigation, 
  Phone, 
  MessageSquare, 
  Clock, 
  ExternalLink, 
  Compass, 
  Store, 
  CheckCircle2, 
  AlertCircle, 
  Truck, 
  Car, 
  ChevronRight, 
  ArrowRight, 
  RefreshCw, 
  Layers, 
  Map as MapIcon, 
  User, 
  Activity,
  AlertTriangle
} from 'lucide-react';
import { Driver, Order, Tenant } from '../../../types';
import { buildDriverNavigation, extractDestinationCoordinates } from '../../../lib/driverNavigation';
import { driverLocationRepository, TenantDriverLocation } from '../../../repositories/driverLocationRepository';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface DriverFleetMapTabProps {
  tenant: Tenant;
  drivers: Driver[];
  orders: Order[];
  onOpenOrderKanban?: () => void;
  onOpenEditDriver?: (driver: Driver) => void;
}

// Helper para criar ícone customizado do motorista no Leaflet
function createDriverMarkerIcon(status: string, isStale: boolean, isSelected: boolean) {
  const isDelivery = status === 'ON_DELIVERY';
  const isAvail = status === 'AVAILABLE';
  const bgColor = isDelivery ? '#2563eb' : isAvail ? '#059669' : '#6b7280';
  const ringColor = isSelected ? '#f59e0b' : '#ffffff';
  
  const pingHtml = isDelivery && !isStale
    ? '<span class="absolute -inset-1 rounded-full bg-blue-500 animate-ping opacity-40"></span>'
    : '';

  const staleHtml = isStale
    ? '<span class="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-500 border-2 border-white shadow-xs" title="Localização desatualizada"></span>'
    : '';

  return L.divIcon({
    className: 'custom-driver-marker',
    html: `
      <div class="relative flex items-center justify-center cursor-pointer">
        ${pingHtml}
        <div style="background-color: ${bgColor}; border: 2.5px solid ${ringColor}; box-shadow: 0 4px 10px rgba(0,0,0,0.3);" class="w-8 h-8 rounded-full flex items-center justify-center text-white transition-transform hover:scale-110">
          <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
            <path d="M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm14-8.5c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm-8.8-9.4l1.8 1.9h4.8v-2h-3.6l-1.4-1.4c-.4-.4-.9-.6-1.5-.6s-1.1.2-1.5.6l-3.8 3.8v4.6h2v-3.6l2.4-2.4.8 3.1-3.6 7.2 1.8.9 3.4-6.8 2.4 2.4v5.3h2v-6.3l-2.6-2.6.4-1.6c.7 1 1.8 1.6 3.1 1.6v-2c-1 0-1.9-.5-2.4-1.2z"/>
          </svg>
        </div>
        ${staleHtml}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  });
}

// Ícone do destino da entrega
const destinationMarkerIcon = L.divIcon({
  className: 'custom-destination-marker',
  html: `
    <div class="relative flex items-center justify-center">
      <div class="w-8 h-8 rounded-full bg-rose-600 border-2 border-white shadow-lg flex items-center justify-center text-white">
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

// Componente para controle da câmera do mapa Leaflet
const MapViewController: React.FC<{
  selectedDriverLoc: TenantDriverLocation | null;
  allLocations: TenantDriverLocation[];
}> = ({ selectedDriverLoc, allLocations }) => {
  const map = useMap();
  const prevSelectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    map.invalidateSize();
  }, [map]);

  useEffect(() => {
    if (selectedDriverLoc && selectedDriverLoc.lat != null && selectedDriverLoc.lng != null) {
      if (prevSelectedIdRef.current !== selectedDriverLoc.driver_id) {
        map.setView([selectedDriverLoc.lat, selectedDriverLoc.lng], 15, { animate: true });
        prevSelectedIdRef.current = selectedDriverLoc.driver_id;
      }
      return;
    }

    const validLocs = allLocations.filter(
      (l) => l.location_visible && l.lat != null && l.lng != null
    );

    if (validLocs.length > 0 && !prevSelectedIdRef.current) {
      if (validLocs.length === 1) {
        map.setView([validLocs[0].lat!, validLocs[0].lng!], 14);
      } else {
        const bounds = L.latLngBounds(validLocs.map((l) => [l.lat!, l.lng!]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    }
  }, [selectedDriverLoc, allLocations, map]);

  return null;
};

export const DriverFleetMapTab: React.FC<DriverFleetMapTabProps> = ({
  tenant,
  drivers,
  orders,
  onOpenOrderKanban,
  onOpenEditDriver,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'AVAILABLE' | 'ON_DELIVERY' | 'SUSPENDED'>('ALL');
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(
    drivers.length > 0 ? drivers[0].id : null
  );
  const [lastUpdated, setLastUpdated] = useState(() => new Date().toLocaleTimeString('pt-BR'));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'CURRENT' | 'HISTORY' | 'PERFORMANCE'>('CURRENT');

  // Estado das localizações obtidas via polling da RPC list_tenant_driver_locations
  const [locations, setLocations] = useState<TenantDriverLocation[]>([]);

  // Polling a cada 15s de list_tenant_driver_locations
  const fetchLocations = useCallback(async () => {
    if (!tenant?.id) return;
    try {
      const data = await driverLocationRepository.listTenantDriverLocations(tenant.id);
      setLocations(data);
      setLastUpdated(new Date().toLocaleTimeString('pt-BR'));
    } catch (err) {
      console.warn('[DriverFleetMapTab] Erro ao buscar localizações:', err);
    }
  }, [tenant?.id]);

  useEffect(() => {
    fetchLocations();
    const interval = setInterval(fetchLocations, 15000);
    return () => clearInterval(interval);
  }, [fetchLocations]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await fetchLocations();
    setTimeout(() => setIsRefreshing(false), 400);
  };

  // Mapa de localização por ID do motorista
  const locationMap = useMemo(() => {
    const map = new Map<string, TenantDriverLocation>();
    for (const loc of locations) {
      map.set(loc.driver_id, loc);
    }
    return map;
  }, [locations]);

  // Counts for status metrics
  const availableCount = drivers.filter((d) => d.status === 'AVAILABLE').length;
  const onDeliveryCount = drivers.filter((d) => d.status === 'ON_DELIVERY').length;
  const suspendedCount = drivers.filter((d) => d.status === 'UNAVAILABLE' || d.status === 'SUSPENDED').length;

  // Filtro de entregadores da coluna da esquerda
  const filteredDrivers = useMemo(() => {
    return drivers.filter((drv) => {
      const term = search.toLowerCase().trim();
      const matchSearch =
        !term ||
        drv.name.toLowerCase().includes(term) ||
        (drv.phone && drv.phone.includes(term)) ||
        (drv.plate && drv.plate.toLowerCase().includes(term));

      if (!matchSearch) return false;

      if (filter === 'ALL') return true;
      if (filter === 'AVAILABLE') return drv.status === 'AVAILABLE';
      if (filter === 'ON_DELIVERY') return drv.status === 'ON_DELIVERY';
      if (filter === 'SUSPENDED') return drv.status === 'UNAVAILABLE' || drv.status === 'SUSPENDED';
      return true;
    });
  }, [drivers, search, filter]);

  // Motorista selecionado
  const selectedDriver = useMemo(() => {
    if (!selectedDriverId) return null;
    return drivers.find((d) => d.id === selectedDriverId) || null;
  }, [drivers, selectedDriverId]);

  const selectedDriverLoc = useMemo(() => {
    if (!selectedDriverId) return null;
    return locationMap.get(selectedDriverId) || null;
  }, [locationMap, selectedDriverId]);

  // Pedido ativo para o entregador selecionado
  const activeOrderForDriver = useMemo(() => {
    if (!selectedDriver) return null;
    // Tenta primeiro pelo active_order_id retornado na RPC
    if (selectedDriverLoc?.active_order_id) {
      const byRpc = orders.find((o) => o.id === selectedDriverLoc.active_order_id);
      if (byRpc) return byRpc;
    }
    return (
      orders.find(
        (o) =>
          o.driverId === selectedDriver.id &&
          (o.status === 'OUT_FOR_DELIVERY' || o.status === 'WAITING_FOR_DRIVER')
      ) || null
    );
  }, [selectedDriver, selectedDriverLoc, orders]);

  // Destino da entrega ativa
  const destCoordsForActiveOrder = useMemo(() => {
    if (!activeOrderForDriver) return null;
    return extractDestinationCoordinates(activeOrderForDriver);
  }, [activeOrderForDriver]);

  // Histórico de pedidos entregues pelo motorista selecionado
  const historyOrdersForDriver = useMemo(() => {
    if (!selectedDriver) return [];
    return orders
      .filter((o) => o.driverId === selectedDriver.id && o.status === 'DELIVERED')
      .slice(0, 5);
  }, [selectedDriver, orders]);

  // Navegação externa
  const navData = useMemo(() => {
    if (!activeOrderForDriver) return null;
    return buildDriverNavigation(tenant, activeOrderForDriver);
  }, [tenant, activeOrderForDriver]);

  const cleanPhone = (phone?: string) => (phone || '').replace(/\D/g, '');

  // Coordenadas centrais padrão (centro geográfico do Brasil ou primeiro motoboy ativo)
  const defaultCenter: [number, number] = useMemo(() => {
    const firstActive = locations.find(
      (l) => l.location_visible && l.lat != null && l.lng != null
    );
    if (firstActive && firstActive.lat != null && firstActive.lng != null) {
      return [firstActive.lat, firstActive.lng];
    }
    return [-14.235, -51.925]; // Centro geográfico do Brasil
  }, [locations]);

  return (
    /* Layout exato de 3 colunas: Esquerda ~22%, Centro ~55-58%, Direita ~22% */
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(240px,22%)_1fr_minmax(260px,22%)] gap-5 items-stretch min-h-[560px] h-[calc(100vh-270px)]">
      {/* ======================================================== */}
      {/* COLUNA 1 (ESQUERDA): Entregadores no Mapa (~22%)         */}
      {/* ======================================================== */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs flex flex-col h-full min-h-[560px] overflow-hidden">
        {/* Header da Coluna 1 */}
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-sm">
              Entregadores no Mapa ({filteredDrivers.length})
            </h3>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Tempo Real Ativo" />
          </div>

          {/* Campo de Busca */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, placa ou tel..."
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          {/* Filtros em Pílulas com Quebra de Linha */}
          <div className="flex flex-wrap gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                filter === 'ALL'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              Todos ({drivers.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('AVAILABLE')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                filter === 'AVAILABLE'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              Disponíveis ({availableCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('ON_DELIVERY')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                filter === 'ON_DELIVERY'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              Em entrega ({onDeliveryCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('SUSPENDED')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                filter === 'SUSPENDED'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              Suspensos ({suspendedCount})
            </button>
          </div>
        </div>

        {/* Lista Compacta de Entregadores */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {filteredDrivers.length === 0 ? (
            <div className="p-8 text-center text-gray-400 space-y-2">
              <Bike className="w-8 h-8 mx-auto text-gray-300" />
              <p className="text-xs font-medium">Nenhum entregador encontrado</p>
              <p className="text-[11px] text-gray-400">Verifique o filtro aplicado</p>
            </div>
          ) : (
            filteredDrivers.map((drv) => {
              const isSelected = selectedDriverId === drv.id;
              const loc = locationMap.get(drv.id);
              const hasVisibleLocation = Boolean(
                loc && loc.location_visible && loc.lat != null && loc.lng != null
              );
              const isStale = Boolean(loc?.is_stale);

              return (
                <div
                  key={drv.id}
                  onClick={() => setSelectedDriverId(drv.id)}
                  className={`p-3 transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                    isSelected ? 'bg-emerald-50/70 border-l-4 border-emerald-600' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-xs">
                        {drv.name
                          .split(' ')
                          .map((n) => n[0])
                          .filter(Boolean)
                          .slice(0, 2)
                          .join('')
                          .toUpperCase() || 'E'}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
                          drv.status === 'AVAILABLE'
                            ? 'bg-emerald-500'
                            : drv.status === 'ON_DELIVERY'
                              ? 'bg-blue-500'
                              : 'bg-gray-400'
                        }`}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{drv.name}</p>
                      
                      {/* Status de localização estritamente conforme o requisito:
                          - Se não houver posição visível: "Localização indisponível"
                          - Se houver posição visível e for recente: "GPS ativo"
                          - Se houver posição visível e tiver >2min: "Desatualizada (>2min)"
                      */}
                      <div className="mt-0.5">
                        {hasVisibleLocation ? (
                          isStale ? (
                            <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200 inline-block">
                              Desatualizada (&gt;2min)
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium text-emerald-700 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              GPS ativo
                            </span>
                          )
                        ) : (
                          <span className="text-[10px] text-gray-400 block truncate">
                            Localização indisponível
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {drv.status === 'ON_DELIVERY' && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700">
                        Em rota
                      </span>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ======================================================== */}
      {/* COLUNA 2 (CENTRAL): Leaflet + OpenStreetMap (~55-58%)    */}
      {/* ======================================================== */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs flex flex-col h-full min-h-[560px] relative overflow-hidden">
        {/* FAIXA SUPERIOR BRANCA: Atualização em Tempo Real & Seletor de Entregadores */}
        <div className="px-4 py-2.5 bg-white border-b border-gray-200 flex flex-wrap items-center justify-between gap-3 z-10">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-gray-900">
              Atualização em tempo real
            </span>
            <span className="text-xs text-gray-400">•</span>
            <span className="text-[11px] text-gray-500 font-mono">
              Última atualização {lastUpdated}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Seletor "Todos os entregadores" */}
            <select
              value={selectedDriverId || ''}
              onChange={(e) => setSelectedDriverId(e.target.value || null)}
              className="bg-gray-50 border border-gray-200 text-xs rounded-lg px-2.5 py-1 text-gray-700 font-medium focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="">Todos os entregadores</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.status === 'AVAILABLE' ? '(Disponível)' : d.status === 'ON_DELIVERY' ? '(Em entrega)' : ''}
                </option>
              ))}
            </select>

            {/* Botão Atualizar (polling imediato da RPC) */}
            <button
              type="button"
              onClick={handleManualRefresh}
              className="p-1.5 text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg border border-gray-200 transition-colors cursor-pointer"
              title="Atualizar posições agora"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-600' : ''}`} />
            </button>

          </div>
        </div>

        {/* ÁREA CENTRAL DO MAPA COM LEAFLET & OPENSTREETMAP */}
        <div className="flex-1 relative w-full h-full bg-slate-100 overflow-hidden">
          <MapContainer
            center={defaultCenter}
            zoom={13}
            scrollWheelZoom={true}
            className="w-full h-full absolute inset-0 z-0"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapViewController
              selectedDriverLoc={selectedDriverLoc}
              allLocations={locations}
            />

            {/* Marcadores dos entregadores com location_visible = true */}
            {locations
              .filter((loc) => loc.location_visible && loc.lat != null && loc.lng != null)
              .map((loc) => {
                const isSelected = selectedDriverId === loc.driver_id;
                const isStale = Boolean(loc.is_stale);
                const markerIcon = createDriverMarkerIcon(loc.status, isStale, isSelected);

                return (
                  <Marker
                    key={loc.driver_id}
                    position={[loc.lat!, loc.lng!]}
                    icon={markerIcon}
                    eventHandlers={{
                      click: () => setSelectedDriverId(loc.driver_id),
                    }}
                  >
                    <Popup>
                      <div className="text-xs space-y-1 p-0.5 min-w-[160px]">
                        <p className="font-bold text-gray-900">{loc.full_name}</p>
                        <p className="text-[11px] text-gray-600">
                          Status: <strong>{loc.status === 'ON_DELIVERY' ? 'Em Entrega' : 'Disponível'}</strong>
                        </p>
                        {loc.speed != null && loc.speed > 0 && (
                          <p className="text-[10px] text-gray-500 font-mono">
                            Velocidade: {Math.round(loc.speed * 3.6)} km/h
                          </p>
                        )}
                        {isStale && (
                          <div className="p-1.5 bg-amber-50 border border-amber-200 rounded text-amber-800 text-[10px] flex items-center gap-1 font-medium mt-1">
                            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>Localização desatualizada (&gt;2min)</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedDriverId(loc.driver_id)}
                          className="mt-1 w-full py-1 bg-emerald-600 text-white rounded text-[10px] font-semibold text-center cursor-pointer"
                        >
                          Ver Detalhes
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}

            {/* Marcador do destino caso o entregador selecionado tenha rota ativa com coordenadas */}
            {destCoordsForActiveOrder && (
              <Marker
                position={[destCoordsForActiveOrder.lat, destCoordsForActiveOrder.lng]}
                icon={destinationMarkerIcon}
              >
                <Popup>
                  <div className="text-xs p-0.5">
                    <strong className="text-rose-600">Destino da Entrega</strong>
                    <p className="text-[10px] text-gray-700 mt-0.5">
                      {activeOrderForDriver?.deliveryAddress}
                    </p>
                  </div>
                </Popup>
              </Marker>
            )}
          </MapContainer>

          {/* Aviso discreto caso o motoboy selecionado esteja desatualizado (>2min) */}
          {selectedDriverLoc?.location_visible && selectedDriverLoc?.is_stale && (
            <div className="absolute top-3 left-4 z-10 bg-amber-50/95 backdrop-blur-xs border border-amber-200 px-3 py-1.5 rounded-xl shadow-xs flex items-center gap-1.5 text-xs text-amber-800 font-medium">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>Localização desatualizada (&gt; 2 min)</span>
            </div>
          )}

          {/* FAIXA BRANCA INFERIOR COM LEGENDA (Disponível, Em entrega, A caminho da coleta, Inativo/Suspenso) */}
          <div className="absolute bottom-3 left-4 right-4 z-10 bg-white/95 backdrop-blur-xs border border-gray-200 rounded-xl px-4 py-2 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-gray-700 font-medium">Disponível</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-gray-700 font-medium">Em entrega</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-gray-700 font-medium">A caminho da coleta</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                <span className="text-gray-700 font-medium">Inativo/Suspenso</span>
              </div>
            </div>

            <div className="text-[10px] text-gray-500 font-medium">
              © OpenStreetMap contributors
            </div>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* COLUNA 3 (DIREITA): Detalhes do Entregador (~22%)        */}
      {/* ======================================================== */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs flex flex-col h-full min-h-[560px] overflow-hidden">
        {selectedDriver ? (
          <div className="flex flex-col h-full">
            {/* Header com dados do Entregador Selecionado */}
            <div className="p-4 border-b border-gray-100 bg-gray-50/70">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Entregador Selecionado
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  selectedDriver.status === 'AVAILABLE'
                    ? 'bg-emerald-100 text-emerald-800'
                    : selectedDriver.status === 'ON_DELIVERY'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-700'
                }`}>
                  {selectedDriver.status === 'AVAILABLE'
                    ? 'Disponível'
                    : selectedDriver.status === 'ON_DELIVERY'
                      ? 'Em Entrega'
                      : 'Inativo/Suspenso'}
                </span>
              </div>

              <div className="flex items-center gap-3 mt-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-700 text-white font-bold flex items-center justify-center text-base shadow-xs shrink-0">
                  {selectedDriver.name
                    .split(' ')
                    .map((n) => n[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join('')
                    .toUpperCase() || 'E'}
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-sm text-gray-900 truncate">{selectedDriver.name}</h4>
                  <p className="text-xs text-gray-500 font-mono">{selectedDriver.phone || 'Sem telefone'}</p>
                  <p className="text-[11px] text-gray-400 truncate mt-0.5">
                    {selectedDriver.vehicle} • {selectedDriver.plate || 'PLACA N/D'}
                  </p>
                </div>
              </div>

              {/* Botões de Ação Direta de Comunicação */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200/60">
                {selectedDriver.phone ? (
                  <>
                    <a
                      href={`tel:${selectedDriver.phone}`}
                      className="flex-1 py-1.5 px-2 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl text-center text-xs font-semibold text-gray-700 flex items-center justify-center gap-1 shadow-2xs transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5 text-gray-500" />
                      Ligar
                    </a>
                    <a
                      href={`https://wa.me/55${cleanPhone(selectedDriver.phone)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-1.5 px-2 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 rounded-xl text-center text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-700" />
                      WhatsApp
                    </a>
                  </>
                ) : (
                  <span className="text-xs text-gray-400 italic py-1">Sem telefone de contato</span>
                )}
              </div>
            </div>

            {/* Abas Entrega Atual / Histórico / Desempenho */}
            <div className="flex border-b border-gray-100 bg-gray-50/50 px-2">
              <button
                type="button"
                onClick={() => setRightPanelTab('CURRENT')}
                className={`flex-1 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  rightPanelTab === 'CURRENT'
                    ? 'border-emerald-600 text-emerald-800 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                Entrega Atual
              </button>
              <button
                type="button"
                onClick={() => setRightPanelTab('HISTORY')}
                className={`flex-1 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  rightPanelTab === 'HISTORY'
                    ? 'border-emerald-600 text-emerald-800 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                Histórico
              </button>
              <button
                type="button"
                onClick={() => setRightPanelTab('PERFORMANCE')}
                className={`flex-1 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  rightPanelTab === 'PERFORMANCE'
                    ? 'border-emerald-600 text-emerald-800 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                Desempenho
              </button>
            </div>

            {/* Conteúdo Central da Aba Selecionada */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {rightPanelTab === 'CURRENT' && (
                activeOrderForDriver ? (
                  <div className="space-y-3">
                    <div className="p-3.5 bg-blue-50/70 border border-blue-200/80 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-blue-950">
                          Pedido #{activeOrderForDriver.orderNumber}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                          Em Trânsito
                        </span>
                      </div>

                      <div className="space-y-1 text-xs text-gray-700">
                        <p className="font-semibold text-gray-900">{activeOrderForDriver.customerName}</p>
                        <p className="text-[11px] text-gray-500 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                          <span className="line-clamp-2">{activeOrderForDriver.deliveryAddress}</span>
                        </p>
                      </div>

                      {/* Selo Obrigatório: ETA indisponível (sem dados fictícios) */}
                      <div className="p-2 bg-white/80 rounded-xl border border-blue-200 flex items-center justify-between text-[11px]">
                        <span className="text-gray-500 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-amber-500" />
                          Previsão de Chegada:
                        </span>
                        <strong className="text-amber-700 font-semibold">ETA indisponível</strong>
                      </div>

                      <div className="pt-2 border-t border-blue-200/60 flex items-center justify-between text-xs font-semibold">
                        <span className="text-gray-500">Valor Total:</span>
                        <span className="text-gray-900">
                          {activeOrderForDriver.totalAmount.toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Botões de Navegação Externa */}
                    {navData && (
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                          Navegação do Entregador
                        </span>
                        <div className="grid grid-cols-2 gap-2">
                          <a
                            href={navData.googleMaps}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="py-2 px-3 bg-white border border-gray-200 hover:border-emerald-500 rounded-xl text-center text-xs font-semibold text-gray-700 flex items-center justify-center gap-1.5 shadow-2xs transition-colors"
                          >
                            <Navigation className="w-3.5 h-3.5 text-blue-600" />
                            Google Maps
                          </a>
                          <a
                            href={navData.waze}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="py-2 px-3 bg-white border border-gray-200 hover:border-cyan-500 rounded-xl text-center text-xs font-semibold text-gray-700 flex items-center justify-center gap-1.5 shadow-2xs transition-colors"
                          >
                            <Compass className="w-3.5 h-3.5 text-cyan-600" />
                            Waze
                          </a>
                        </div>
                      </div>
                    )}

                    {/* Itens do Pedido */}
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-1.5 text-xs">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        Itens para entrega ({activeOrderForDriver.items.length})
                      </span>
                      {activeOrderForDriver.items.slice(0, 3).map((item, i) => (
                        <div key={i} className="flex justify-between text-gray-700 text-[11px]">
                          <span>{item.quantity}x {item.productName}</span>
                          <span className="font-mono text-gray-500">
                            {(item.unitPrice * item.quantity).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        </div>
                      ))}
                      {activeOrderForDriver.items.length > 3 && (
                        <p className="text-[10px] text-gray-400 text-center pt-1">
                          + {activeOrderForDriver.items.length - 3} outros itens
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center space-y-3 bg-gray-50/70 rounded-2xl border border-gray-100">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="font-bold text-xs text-gray-900">Entregador Disponível</h5>
                      <p className="text-[11px] text-gray-500 mt-1">
                        Este motoboy está online e livre para receber pedidos do despacho.
                      </p>
                    </div>
                    {onOpenOrderKanban && (
                      <button
                        type="button"
                        onClick={onOpenOrderKanban}
                        className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        Despachar no Kanban
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )
              )}

              {rightPanelTab === 'HISTORY' && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                    Entregas Concluídas Recentemente
                  </span>
                  {historyOrdersForDriver.length === 0 ? (
                    <div className="p-6 text-center text-gray-400 space-y-1">
                      <Clock className="w-6 h-6 mx-auto text-gray-300 mb-1" />
                      <p className="text-xs">Nenhum histórico recente</p>
                    </div>
                  ) : (
                    historyOrdersForDriver.map((ord) => (
                      <div key={ord.id} className="p-2.5 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between text-xs">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900">Pedido #{ord.orderNumber}</p>
                          <p className="text-[10px] text-gray-400 truncate">{ord.customerName}</p>
                        </div>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                          Entregue
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {rightPanelTab === 'PERFORMANCE' && (
                <div className="space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">
                    Indicadores de Desempenho
                  </span>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <span className="text-gray-400 block text-[10px]">Entregas Hoje</span>
                      <span className="font-bold text-gray-900 text-sm">
                        {selectedDriver.completedDeliveriesToday ?? 0}
                      </span>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <span className="text-gray-400 block text-[10px]">Avaliação</span>
                      <span className="font-bold text-gray-900 text-sm">—</span>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <span className="text-gray-400 block text-[10px]">Ganhos Estimados</span>
                      <span className="font-bold text-gray-900 text-sm">—</span>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                      <span className="text-gray-400 block text-[10px]">Tempo Médio</span>
                      <span className="font-bold text-gray-900 text-sm">—</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Rodapé com Atalhos */}
            {onOpenOrderKanban && (
              <div className="p-4 border-t border-gray-100 bg-gray-50/50">
                <button
                  type="button"
                  onClick={onOpenOrderKanban}
                  className="w-full py-2 px-3 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
                  Central de Despacho
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ======================================================== */
          /* PAINEL DIREITO DO MAPA SEM SELEÇÃO                       */
          /* ======================================================== */
          <div className="flex flex-col h-full">
            {/* Header com avatar cinza placeholder e nome em cinza */}
            <div className="p-4 border-b border-gray-100 bg-gray-50/70">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Detalhes do Entregador
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-400">
                  Nenhum selecionado
                </span>
              </div>

              <div className="flex items-center gap-3 mt-3">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 border border-gray-200 text-gray-300 font-bold flex items-center justify-center text-base shadow-xs shrink-0">
                  <User className="w-6 h-6 text-gray-300" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-sm text-gray-400 truncate">
                    Nenhum entregador selecionado
                  </h4>
                  <p className="text-xs text-gray-300 font-mono mt-0.5">—</p>
                  <p className="text-[11px] text-gray-300 truncate mt-0.5">
                    Selecione para ver informações
                  </p>
                </div>
              </div>

              {/* Botões Desabilitados */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200/60">
                <button
                  type="button"
                  disabled
                  className="flex-1 py-1.5 px-2 bg-gray-50 border border-gray-200 rounded-xl text-center text-xs font-semibold text-gray-300 flex items-center justify-center gap-1 cursor-not-allowed"
                >
                  <Phone className="w-3.5 h-3.5 text-gray-300" />
                  Ligar
                </button>
                <button
                  type="button"
                  disabled
                  className="flex-1 py-1.5 px-2 bg-gray-50 border border-gray-200 rounded-xl text-center text-xs font-semibold text-gray-300 flex items-center justify-center gap-1 cursor-not-allowed"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-gray-300" />
                  WhatsApp
                </button>
              </div>
            </div>

            {/* Abas Entrega Atual / Histórico / Desempenho Desabilitadas */}
            <div className="flex border-b border-gray-100 bg-gray-50/50 px-2">
              <button
                type="button"
                disabled
                className="flex-1 py-2 text-xs font-semibold text-gray-300 border-b-2 border-transparent cursor-not-allowed"
              >
                Entrega Atual
              </button>
              <button
                type="button"
                disabled
                className="flex-1 py-2 text-xs font-semibold text-gray-300 border-b-2 border-transparent cursor-not-allowed"
              >
                Histórico
              </button>
              <button
                type="button"
                disabled
                className="flex-1 py-2 text-xs font-semibold text-gray-300 border-b-2 border-transparent cursor-not-allowed"
              >
                Desempenho
              </button>
            </div>

            {/* Corpo com Estado Vazio Discreto */}
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-200 text-gray-300 flex items-center justify-center mx-auto mb-3">
                <Bike className="w-6 h-6" />
              </div>
              <h5 className="font-semibold text-xs text-gray-600">Nenhum entregador selecionado</h5>
              <p className="text-[11px] text-gray-400 max-w-xs mt-1">
                Clique em um entregador na lista à esquerda ou no mapa para acompanhar sua entrega em andamento, histórico e rota em tempo real.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
