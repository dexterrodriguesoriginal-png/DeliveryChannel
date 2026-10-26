import { DriverRideOffer } from '../../components/driver/DriverRideOffer';
import { driverOfferRepository, MyDriverOffer } from '../../repositories/driverOfferRepository';
import { dispatchErrorMessage } from '../../lib/orders/dispatchErrors';
import { playNewOrderSound, unlockAudio } from '../../utils/audio';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { paymentMethodLabel } from '../../lib/orders/labels';
import { formatBRL } from '../../lib/pricing/money';
import { useAuth } from '../../context/AuthContext';
import { orderRepository } from '../../repositories/orderRepository';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { MobileNavigation } from '../../components/layout/MobileNavigation';
import { Bike, Navigation, MapPin, Phone, CheckCircle2, AlertCircle, Clock, PackageCheck, RefreshCw, LogOut } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { Order } from '../../types';
import { computeDriverDailySummary } from '../../lib/driverSummary';
import { filterAssignedDriverOrders, driverOrderHistory } from '../../lib/driverOrders';
import { canFetchDriverOrders, driverAvailabilityLabel, DriverAvailability, availabilityToggleTarget } from '../../lib/membershipResolution';
import { driverInviteRepository } from '../../repositories/driverRepository';
import { DriverDeliveryMap } from '../../components/driver/DriverDeliveryMap';
import { useDriverLocationTracking } from '../../lib/useDriverLocationTracking';
import { DriverLocationConsentModal } from '../../components/driver/DriverLocationConsentModal';
import { HandoffCodeForm } from '../../components/driver/HandoffCodeForm';
import { DriverPickupCode } from '../../components/driver/DriverPickupCode';
import { OrderChat } from '../../components/chat/OrderChat';
import { pickDriverActiveOrder, driverEarning } from '../../lib/orders/handoff';

const AVAIL_DOT: Record<string, string> = {
  emerald: 'bg-emerald-500 animate-pulse', amber: 'bg-amber-500', gray: 'bg-gray-400', rose: 'bg-rose-500',
};

interface DriverAppProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

export const DriverApp: React.FC<DriverAppProps> = ({ activeTab: requestedTab, onTabChange }) => {
  const { activeTenant, securityContext, currentUser, signOut, driverApprovalStatus } = useAuth();
  // F5 (defesa): entregador não aprovado não busca nem assina pedidos.
  const ordersAllowed = canFetchDriverOrders(driverApprovalStatus);
  const { showToast } = useToast();
  const [internalNavTab, setInternalNavTab] = useState('active-delivery');
  const navTab = requestedTab === undefined
    ? internalNavTab
    : ['active-delivery', 'history', 'driver-profile'].includes(requestedTab)
      ? requestedTab
      : 'active-delivery';
  const changeNavTab = (tab: string) => {
    setInternalNavTab(tab);
    onTabChange?.(tab);
  };
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Fix R3: presença (app aberto) ≠ disponibilidade operacional (drivers.status no servidor).
  const [availability, setAvailability] = useState<DriverAvailability>('UNKNOWN');
  const [availSaving, setAvailSaving] = useState(false);

  const isFetchingRef = useRef(false);
  const hasQueuedFetchRef = useRef(false);
  const securityContextRef = useRef(securityContext);
  securityContextRef.current = securityContext;

  const fetchDriverOrders = useCallback(
    async (silent = false) => {
      if (!activeTenant?.id || !ordersAllowed) return;
      // Se já houver busca em andamento, agenda nova execução imediata ao terminar
      if (isFetchingRef.current) {
        hasQueuedFetchRef.current = true;
        return;
      }
      isFetchingRef.current = true;
      if (!silent) setIsLoading(true);
      try {
        do {
          hasQueuedFetchRef.current = false;
          // Disponibilidade independe da lista de pedidos (uma falha não pode esconder a outra).
          const [data, av] = await Promise.allSettled([
            orderRepository.getOrders(securityContextRef.current, activeTenant.id),
            driverInviteRepository.getOwnAvailability(activeTenant.id),
          ]);
          if (av.status === 'fulfilled') setAvailability(av.value);
          if (data.status === 'rejected') throw data.reason;
          setOrders(data.value);
        } while (hasQueuedFetchRef.current);
      } catch (err) {
        console.warn('[DriverApp] Erro ao carregar pedidos do Supabase:', err);
      } finally {
        isFetchingRef.current = false;
        if (!silent) setIsLoading(false);
      }
    },
    [activeTenant?.id, ordersAllowed]
  );

  // Sincronização automática contínua: Carga inicial + Realtime + Polling resiliente de 15s
  useEffect(() => {
    if (!activeTenant?.id || !ordersAllowed) return;

    let isMounted = true;

    // 1. Carga inicial
    fetchDriverOrders(false);

    // 2. Assinatura Realtime comprovada para detecção em tempo real
    const unsub = orderRepository.subscribeToOrders(activeTenant.id, () => {
      if (isMounted) {
        fetchDriverOrders(true);
      }
    });

    // 3. Polling de 15 segundos para detecção garantida mesmo com desconexão de WebSocket/segundo plano
    const pollTimer = setInterval(() => {
      if (isMounted) {
        fetchDriverOrders(true);
      }
    }, 15000);

    return () => {
      isMounted = false;
      clearInterval(pollTimer);
      unsub();
    };
  }, [fetchDriverOrders, activeTenant?.id, ordersAllowed]);

  const [rideOffers, setRideOffers] = useState<MyDriverOffer[]>([]);
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerSoundEnabled, setOfferSoundEnabled] = useState(false);
  const offerRefreshRef = useRef<() => Promise<void>>(async () => {});
  const offerUserId = currentUser?.id || securityContext.userId;
  useEffect(() => {
    setRideOffers([]);
    if (!activeTenant?.id || !offerUserId || !ordersAllowed) return;
    let alive = true, running = false, queued = false;
    const seen = new Set<string>();
    const refresh = async () => {
      if (running) { queued = true; return; }
      running = true;
      try {
        do {
          queued = false;
          const offers = (await driverOfferRepository.mine()).filter(o => o.tenant_id === activeTenant.id);
          if (!alive) return;
          for (const offer of offers) if (!seen.has(offer.id)) {
            seen.add(offer.id); playNewOrderSound();
            try { navigator.vibrate?.([200, 100, 200]); } catch { /* navegador sem vibração */ }
          }
          setRideOffers(offers);
        } while (queued && alive);
      } catch { /* fallback de polling retoma após reconexão */ }
      finally { running = false; }
    };
    offerRefreshRef.current = refresh;
    void refresh();
    const unsub = driverOfferRepository.subscribeDriver(offerUserId, () => { void refresh(); void fetchDriverOrders(true); });
    const timer = window.setInterval(() => { void refresh(); }, 10000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { alive = false; offerRefreshRef.current = async () => {}; unsub(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [activeTenant?.id, offerUserId, ordersAllowed, fetchDriverOrders]);
  const respondToOffer = async (accept: boolean) => {
    const offer = rideOffers[0]; if (!offer || offerBusy) return;
    setOfferBusy(true);
    try {
      await driverOfferRepository.respond(offer.id, accept);
      setRideOffers(prev => prev.filter(o => o.id !== offer.id));
      showToast({ type: 'success', title: accept ? 'Corrida aceita' : 'Chamada recusada', message: accept ? 'Mostre seu código de retirada na loja.' : 'Você pode receber novas chamadas.' });
      await fetchDriverOrders(true);
    } catch (e) {
      showToast({ type: 'error', title: 'Não foi possível responder', message: dispatchErrorMessage(e) });
    } finally { await offerRefreshRef.current(); setOfferBusy(false); }
  };

  // Carrega a disponibilidade logo ao abrir o app (sem depender de abrir "Meu Perfil").
  useEffect(() => {
    if (!activeTenant?.id) return;
    let alive = true;
    driverInviteRepository.getOwnAvailability(activeTenant.id)
      .then(av => { if (alive) setAvailability(av); })
      .catch(err => console.warn('[DriverApp] disponibilidade:', err));
    return () => { alive = false; };
  }, [activeTenant?.id]);

  if (!activeTenant) return null;

  const availabilityView = driverAvailabilityLabel(availability);

  // Filtra ordens atribuídas a este motorista
  const driverUserId = currentUser?.id || securityContext.userId;
  const assignedOrders = filterAssignedDriverOrders(orders, driverUserId);

  const dailySummary = computeDriverDailySummary(orders, driverUserId);
  const historyOrders = driverOrderHistory(orders, driverUserId);

  const handleSignOut = async () => {
    try {
      if (typeof window !== 'undefined') {
        const toRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && (k.startsWith('adegafood_') || k.startsWith('deliverychannel_') || k.startsWith('sb-'))) {
            toRemove.push(k);
          }
        }
        toRemove.forEach(k => window.localStorage.removeItem(k));
        window.sessionStorage.clear();
      }
    } catch {
      // ignore
    }
    await signOut();
    window.location.replace('/');
  };

  // Pedido em rota ou aguardando retirada da loja correspondente (isolamento estrito por tenant)
  const activeOrder = pickDriverActiveOrder(
    assignedOrders.filter((o) => !o.tenantId || o.tenantId === activeTenant.id),
    driverUserId
  );
  // Atualizações a cada 15s SOMENTE quando houver pedido efetivamente OUT_FOR_DELIVERY da loja correspondente
  const hasActiveOutForDelivery = Boolean(
    assignedOrders.some(
      (o) => o.status === 'OUT_FOR_DELIVERY' && (!o.tenantId || o.tenantId === activeTenant.id)
    )
  );

  // Rastreamento com consentimento explícito LGPD
  const {
    consent,
    isPaused,
    currentCoords,
    handleAcceptConsent,
    handleRejectConsent,
    handleTogglePause,
  } = useDriverLocationTracking(availability, hasActiveOutForDelivery);

  const [showConsentModal, setShowConsentModal] = useState(false);

  useEffect(() => {
    if (consent === 'PROMPT') {
      setShowConsentModal(true);
    }
  }, [consent]);

  const availabilityControl = (() => {
    const next = availabilityToggleTarget(availability);
    if (!next) {
      return (
        <p className="text-gray-500" data-testid="availability-toggle-hint">
          {availability === 'ON_DELIVERY'
            ? 'Conclua a entrega em andamento para alterar sua disponibilidade.'
            : 'Disponibilidade indisponível para alteração no momento.'}
        </p>
      );
    }
    return (
      <Button
        data-testid="availability-toggle"
        size="sm"
        variant={next === 'AVAILABLE' ? 'primary' : 'outline'}
        disabled={availSaving}
        className="w-full text-xs"
        onClick={async () => {
          setAvailSaving(true);
          try {
            const av = await driverInviteRepository.setMyAvailability(activeTenant.id, next);
            setAvailability(av);
            showToast({ type: 'success', title: av === 'AVAILABLE' ? 'Você está disponível' : 'Você está indisponível', message: 'Disponibilidade atualizada.' });
          } catch (err: any) {
            showToast({ type: 'error', title: 'Não foi possível alterar', message: err?.message || 'Tente novamente.' });
            setAvailability(await driverInviteRepository.getOwnAvailability(activeTenant.id));
          } finally {
            setAvailSaving(false);
          }
        }}
      >
        {availSaving ? 'Salvando...' : next === 'AVAILABLE' ? 'Ficar disponível' : 'Ficar indisponível'}
      </Button>
    );
  })();

  return (
    <div className="min-h-screen bg-gray-50 pb-24 text-gray-900 font-sans" onPointerDownCapture={unlockAudio}>
      {rideOffers[0] && <DriverRideOffer offer={rideOffers[0]} busy={offerBusy} onRespond={respondToOffer} />}
      {!offerSoundEnabled && <button type="button" className="w-full bg-amber-100 p-2 text-sm" onClick={() => { unlockAudio(); setOfferSoundEnabled(true); }}>Ativar som das chamadas</button>}
      {/* Top Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-500 text-black flex items-center justify-center font-bold">
            <Bike className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-tight">Delivery Channel Entregador</h1>
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span
                data-testid="driver-availability-dot"
                className={`w-2 h-2 rounded-full ${AVAIL_DOT[availabilityView.tone]}`}
              />
              <span data-testid="driver-availability">
                Conectado • {availabilityView.label} • {currentUser?.name || 'Entregador'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="warning" size="sm">
            MOTOPACK
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSignOut}
            leftIcon={<LogOut className="w-3.5 h-3.5" />}
            className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
          >
            Sair
          </Button>
        </div>
      </div>

      {/* Faixa de Localização / Consentimento LGPD */}
      <div className="bg-white border-b border-gray-200/80 px-4 py-2 flex items-center justify-between text-xs max-w-lg mx-auto">
        <div className="flex items-center gap-2">
          {consent === 'ACCEPTED' ? (
            !isPaused ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Localização compartilhada
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Compartilhamento pausado
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              Localização desativada
            </span>
          )}
        </div>

        <div>
          {consent === 'ACCEPTED' ? (
            <button
              type="button"
              onClick={handleTogglePause}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border ${
                !isPaused
                  ? 'bg-white hover:bg-gray-50 text-gray-700 border-gray-300'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white border-transparent shadow-2xs'
              }`}
            >
              {!isPaused ? 'Pausar' : 'Retomar'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowConsentModal(true)}
              className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
            >
              Ativar GPS (LGPD)
            </button>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {navTab === 'history' && (
          <Card className="p-4 space-y-3" data-testid="driver-history">
            <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Histórico de Entregas</h4>
            {historyOrders.length === 0 ? (
              <p className="text-xs text-gray-500">Nenhuma entrega concluída ainda.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {historyOrders.map(o => (
                  <li key={o.id} className="py-2 flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-gray-700">#{o.orderNumber}</span>
                    <span className="text-gray-500">{new Date(o.updatedAt || o.createdAt).toLocaleString('pt-BR')}</span>
                    <Badge variant={o.status === 'DELIVERED' ? 'success' : 'warning'} size="sm">
                      {o.status === 'DELIVERED' ? 'Entregue' : 'Cancelado'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {navTab === 'driver-profile' && (
          <Card className="p-4 space-y-2 text-xs" data-testid="driver-profile">
            <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Meu Perfil</h4>
            <div><span className="text-gray-400">Nome: </span><span className="font-bold">{currentUser?.name || 'Entregador'}</span></div>
            <div><span className="text-gray-400">Loja: </span><span className="font-bold">{activeTenant.name}</span></div>
            <div><span className="text-gray-400">Disponibilidade: </span><span className="font-bold">{availabilityView.label}</span></div>
            {availabilityControl}
          </Card>
        )}

        {navTab === 'active-delivery' && (<>
        <Card className="p-3 flex items-center justify-between gap-3" data-testid="availability-main">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${AVAIL_DOT[availabilityView.tone]}`} />
            <span className="text-sm font-bold text-gray-900 truncate">{availabilityView.label}</span>
          </div>
          <div className="w-44 shrink-0 text-xs">{availabilityControl}</div>
        </Card>
        {activeOrder ? (
          <div className="space-y-4">
            {/* Active Delivery Card */}
            <Card className="p-5 space-y-4 border-amber-300 bg-linear-to-b from-white to-amber-50/20">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <Badge variant={activeOrder.status === 'OUT_FOR_DELIVERY' ? 'brand' : 'warning'} size="sm">
                    {activeOrder.status === 'OUT_FOR_DELIVERY' ? 'EM ROTA DE ENTREGA' : 'VÁ ATÉ A LOJA • RETIRADA'}
                  </Badge>
                  <span className="font-mono text-xs font-bold text-gray-700">#{activeOrder.orderNumber}</span>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-800">
                  Você ganha {formatBRL(driverEarning(activeOrder))}
                </span>
              </div>

              {/* Real Delivery Map and Navigation */}
              <DriverDeliveryMap
                tenant={activeTenant}
                order={activeOrder}
                driverCoords={currentCoords}
              />

              {/* Destination Address */}
              <div className="space-y-2 text-xs">
                <div className="p-3 bg-gray-50 rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Endereço de Entrega</span>
                  <div className="flex items-start gap-1.5 font-bold text-gray-900">
                    <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <span>{activeOrder.deliveryAddress}</span>
                  </div>
                </div>

                <div className="p-3 bg-gray-50 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase">Cliente</div>
                    <div className="font-bold text-gray-900">{activeOrder.customerName}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(`tel:${activeOrder.customerPhone}`)}
                    leftIcon={<Phone className="w-3.5 h-3.5 text-emerald-600" />}
                    className="text-xs"
                  >
                    Ligar
                  </Button>
                </div>

                {/* Pagamento: o entregador precisa saber se cobra na entrega (dinheiro) e o troco */}
                <div className="p-3 bg-gray-50 rounded-xl space-y-1" data-testid="driver-payment">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Pagamento</span>
                  <div className="font-bold text-gray-900">
                    {paymentMethodLabel(activeOrder.paymentMethod)}
                    {activeOrder.paymentStatus === 'PAID'
                      ? ' • já pago'
                      : activeOrder.paymentMethod === 'CASH'
                        ? ` • receber ${formatBRL(activeOrder.totalAmount)} na entrega`
                        : ' • na entrega'}
                  </div>
                  {activeOrder.notes && (
                    <div className="text-[11px] text-gray-600 whitespace-pre-line">{activeOrder.notes}</div>
                  )}
                </div>

                {/* Items to Deliver */}
                <div className="p-3 bg-gray-50 rounded-xl space-y-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">Volumes / Pacote</span>
                  <div className="space-y-0.5 text-xs text-gray-700">
                    {activeOrder.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span>{it.quantity}x {it.productName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                {activeOrder.status !== 'OUT_FOR_DELIVERY' ? <DriverPickupCode key={activeOrder.id} orderId={activeOrder.id} /> : <HandoffCodeForm
                  key={`${activeOrder.id}-${activeOrder.status}`}
                  orderId={activeOrder.id}
                  kind={activeOrder.status === 'OUT_FOR_DELIVERY' ? 'delivery' : 'pickup'}
                  onDone={() => fetchDriverOrders()}
                />}
                <OrderChat audience="driver" key={activeOrder.id} tenantId={activeTenant.id} orderId={activeOrder.id} storePhone={activeTenant.settings?.phoneWhatsApp || activeTenant.phone} />
              </div>
            </Card>
          </div>
        ) : (
          <>
          <Card className="p-8 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto text-gray-400">
              <PackageCheck className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="font-bold text-base text-gray-900">Nenhuma entrega pendente</h3>
            <p className="text-xs text-gray-500 max-w-xs mx-auto">
              Você está livre no momento. As corridas atribuídas pela loja aparecem aqui.
            </p>
          </Card>
          </>
        )}

        {/* Daily Summary */}
        <Card className="p-4 space-y-3">
          <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
            Meu Resumo de Hoje
          </h4>
          <div className="grid grid-cols-2 gap-3 text-center text-xs">
            <div className="p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-400 text-[10px]">Entregas Feitas</span>
              <div className="text-lg font-black text-gray-900 mt-0.5">{dailySummary.deliveredCount}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-400 text-[10px]">Ganhos em Taxas</span>
              <div className="text-lg font-black text-emerald-800 mt-0.5">R$ {dailySummary.feesTotal.toFixed(2).replace('.', ',')}</div>
            </div>
          </div>
        </Card>
        </>)}
      </div>

      <DriverLocationConsentModal
        isOpen={showConsentModal}
        onAccept={() => {
          handleAcceptConsent();
          setShowConsentModal(false);
        }}
        onReject={() => {
          handleRejectConsent();
          setShowConsentModal(false);
        }}
      />

      <MobileNavigation
        type="driver"
        activeTab={navTab}
        onTabChange={changeNavTab}
      />
    </div>
  );
};
