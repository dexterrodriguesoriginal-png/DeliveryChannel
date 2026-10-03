import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { orderRepository } from '../../repositories/orderRepository';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { MobileNavigation } from '../../components/layout/MobileNavigation';
import { Bike, Navigation, MapPin, Phone, CheckCircle2, AlertCircle, Clock, PackageCheck, RefreshCw } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { Order } from '../../types';

export const DriverApp: React.FC = () => {
  const { activeTenant, securityContext, currentUser } = useAuth();
  const { showToast } = useToast();
  const [navTab, setNavTab] = useState('active-delivery');
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchDriverOrders = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    try {
      const data = await orderRepository.getOrders(securityContext, activeTenant.id);
      setOrders(data);
    } catch (err) {
      console.warn('[DriverApp] Erro ao carregar pedidos do Supabase:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, securityContext]);

  useEffect(() => {
    fetchDriverOrders();
    if (!activeTenant?.id) return;
    const unsub = orderRepository.subscribeToOrders(activeTenant.id, () => {
      fetchDriverOrders();
    });
    return unsub;
  }, [fetchDriverOrders, activeTenant?.id]);

  if (!activeTenant) return null;

  // Filtra ordens atribuídas a este motorista
  const driverUserId = currentUser?.id || securityContext.userId;
  const assignedOrders = orders.filter(o => 
    o.driverId === driverUserId || 
    o.driverId === currentUser?.id || 
    o.status === 'OUT_FOR_DELIVERY' || 
    o.status === 'PREPARING'
  );

  // Pedido em rota ou aguardando retirada
  const activeOrder = assignedOrders.find(o => o.status === 'OUT_FOR_DELIVERY') || assignedOrders.find(o => o.status === 'PREPARING');

  const handleAdvanceStatus = async (orderId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'PREPARING' ? 'OUT_FOR_DELIVERY' : 'DELIVERED';
    try {
      await orderRepository.updateStatus(securityContext, activeTenant.id, orderId, nextStatus as any);
      showToast({
        type: 'success',
        title: nextStatus === 'DELIVERED' ? 'Entrega Concluída!' : 'Saiu para Entrega',
        message: nextStatus === 'DELIVERED' ? 'Parabéns! Corrida finalizada com sucesso.' : 'Notificação enviada ao cliente com rastreio em tempo real.',
      });
      await fetchDriverOrders();
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao atualizar corrida',
        message: err.message,
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24 text-gray-900 font-sans">
      {/* Top Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-500 text-black flex items-center justify-center font-bold">
            <Bike className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-tight">AdegaFood Entregador</h1>
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Status: Online • {currentUser?.name || 'Entregador'}</span>
            </div>
          </div>
        </div>

        <Badge variant="warning" size="sm">
          MOTOPACK
        </Badge>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">
        {activeOrder ? (
          <div className="space-y-4">
            {/* Active Delivery Card */}
            <Card className="p-5 space-y-4 border-amber-300 bg-linear-to-b from-white to-amber-50/20">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <Badge variant={activeOrder.status === 'OUT_FOR_DELIVERY' ? 'brand' : 'warning'} size="sm">
                    {activeOrder.status === 'OUT_FOR_DELIVERY' ? 'EM ROTA DE ENTREGA' : 'AGUARDANDO RETIRADA'}
                  </Badge>
                  <span className="font-mono text-xs font-bold text-gray-700">#{activeOrder.orderNumber}</span>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-800">
                  Taxa: R$ {activeOrder.deliveryFee.toFixed(2)}
                </span>
              </div>

              {/* Simulated Map View */}
              <div className="relative h-44 rounded-2xl overflow-hidden bg-emerald-950/90 border border-gray-200 flex items-center justify-center">
                {/* Vector Simulated Map roads and route */}
                <svg className="absolute inset-0 w-full h-full opacity-40" viewBox="0 0 300 150">
                  <path d="M 10 30 Q 80 50 150 30 T 290 80" stroke="#10b981" strokeWidth="4" fill="none" strokeDasharray="6 4" />
                  <path d="M 50 100 Q 150 120 250 110" stroke="#6ee7b7" strokeWidth="2" fill="none" />
                  <circle cx="80" cy="45" r="7" fill="#f59e0b" />
                  <circle cx="230" cy="65" r="8" fill="#10b981" />
                </svg>

                <div className="relative z-10 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl text-white text-xs flex items-center gap-2">
                  <Navigation className="w-4 h-4 text-emerald-400 animate-spin" />
                  <span>Trajeto GPS: 2.4 km • ~8 minutos</span>
                </div>
              </div>

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
                {activeOrder.status === 'PREPARING' ? (
                  <Button
                    variant="primary"
                    className="w-full text-sm py-3"
                    onClick={() => handleAdvanceStatus(activeOrder.id, activeOrder.status)}
                    leftIcon={<Bike className="w-4 h-4" />}
                  >
                    Confirmar Retirada & Iniciar Rota
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    className="w-full text-sm py-3 bg-emerald-700 hover:bg-emerald-800"
                    onClick={() => handleAdvanceStatus(activeOrder.id, activeOrder.status)}
                    leftIcon={<CheckCircle2 className="w-4 h-4" />}
                  >
                    Confirmar Entrega ao Cliente
                  </Button>
                )}
              </div>
            </Card>
          </div>
        ) : (
          <Card className="p-8 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto text-gray-400">
              <PackageCheck className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="font-bold text-base text-gray-900">Nenhuma entrega pendente</h3>
            <p className="text-xs text-gray-500 max-w-xs mx-auto">
              Você está livre no momento. Novos pedidos despachados pelo estabelecimento aparecerão instantaneamente aqui.
            </p>
          </Card>
        )}

        {/* Daily Summary */}
        <Card className="p-4 space-y-3">
          <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
            Meu Resumo de Hoje
          </h4>
          <div className="grid grid-cols-2 gap-3 text-center text-xs">
            <div className="p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-400 text-[10px]">Entregas Feitas</span>
              <div className="text-lg font-black text-gray-900 mt-0.5">8</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-400 text-[10px]">Ganhos em Taxas</span>
              <div className="text-lg font-black text-emerald-800 mt-0.5">R$ 56,00</div>
            </div>
          </div>
        </Card>
      </div>

      <MobileNavigation
        type="driver"
        activeTab={navTab}
        onTabChange={setNavTab}
      />
    </div>
  );
};
