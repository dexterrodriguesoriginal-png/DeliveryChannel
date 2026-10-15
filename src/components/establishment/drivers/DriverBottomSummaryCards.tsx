import React from 'react';
import { 
  Mail, 
  Link, 
  QrCode, 
  MessageSquare, 
  ChevronRight, 
  Clock, 
  Navigation, 
  MapPin, 
  CheckCircle2 
} from 'lucide-react';
import { Driver, Order } from '../../../types';

interface DriverBottomSummaryCardsProps {
  drivers: Driver[];
  orders: Order[];
  onOpenInviteModal: () => void;
  onGenerateLink: () => void;
  onGenerateQr: () => void;
  onShareWhatsapp: () => void;
  onNavigateTab: (tabId: string) => void;
}

export const DriverBottomSummaryCards: React.FC<DriverBottomSummaryCardsProps> = ({
  drivers,
  orders,
  onOpenInviteModal,
  onGenerateLink,
  onGenerateQr,
  onShareWhatsapp,
  onNavigateTab,
}) => {
  const pendingDrivers = drivers.filter(
    (d) => d.approvalStatus === 'PENDING'
  );
  const activeDeliveries = orders
    .filter((o) => o.status === 'OUT_FOR_DELIVERY' || o.status === 'WAITING_FOR_DRIVER')
    .slice(0, 4);

  const recentCompleted = orders
    .filter((o) => o.status === 'DELIVERED')
    .slice(0, 4);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* ======================================================== */}
      {/* CARD 1: Convidar Novo Entregador                         */}
      {/* Subtítulo + 4 linhas (E-mail, Link, QR, WhatsApp)        */}
      {/* ======================================================== */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200 shadow-xs flex flex-col justify-between">
        <div>
          <h4 className="font-bold text-sm text-gray-900">Convidar Novo Entregador</h4>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
            Escolha a forma de convite que melhor se adapta.
          </p>

          <div className="space-y-1.5">
            {/* Linha 1: Convidar por E-mail */}
            <button
              type="button"
              onClick={onOpenInviteModal}
              className="w-full p-2 rounded-xl border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/50 flex items-center justify-between text-left transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                  <Mail className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-900 leading-tight">Convidar por E-mail</p>
                  <p className="text-[10px] text-gray-400 truncate">Envie convite direto para o e-mail</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-600 shrink-0 ml-1 transition-colors" />
            </button>

            {/* Linha 2: Gerar Link de Convite */}
            <button
              type="button"
              onClick={onGenerateLink}
              className="w-full p-2 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50/50 flex items-center justify-between text-left transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  <Link className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-900 leading-tight">Gerar Link de Convite</p>
                  <p className="text-[10px] text-gray-400 truncate">Crie link exclusivo para compartilhar</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-600 shrink-0 ml-1 transition-colors" />
            </button>

            {/* Linha 3: Gerar QR Code */}
            <button
              type="button"
              onClick={onGenerateQr}
              className="w-full p-2 rounded-xl border border-gray-100 hover:border-purple-200 hover:bg-purple-50/50 flex items-center justify-between text-left transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center shrink-0 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                  <QrCode className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-900 leading-tight">Gerar QR Code</p>
                  <p className="text-[10px] text-gray-400 truncate">Escaneamento rápido na loja</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-purple-600 shrink-0 ml-1 transition-colors" />
            </button>

            {/* Linha 4: Compartilhar no WhatsApp */}
            <button
              type="button"
              onClick={onShareWhatsapp}
              className="w-full p-2 rounded-xl border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/50 flex items-center justify-between text-left transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                  <MessageSquare className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-900 leading-tight">Compartilhar no WhatsApp</p>
                  <p className="text-[10px] text-gray-400 truncate">Envie convite direto pelo WhatsApp</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-600 shrink-0 ml-1 transition-colors" />
            </button>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* CARD 2: Convites Pendentes (N)                           */}
      {/* ======================================================== */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-sm text-gray-900">
              Convites Pendentes ({pendingDrivers.length})
            </h4>
            <button
              type="button"
              onClick={() => onNavigateTab('invites')}
              className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 transition-colors cursor-pointer"
            >
              Ver todas
            </button>
          </div>

          {pendingDrivers.length === 0 ? (
            <div className="py-8 text-center text-gray-400 space-y-1">
              <Clock className="w-6 h-6 mx-auto text-gray-300 mb-1" />
              <p className="text-xs">Nenhum convite pendente</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingDrivers.slice(0, 3).map((drv) => (
                <div
                  key={drv.id}
                  className="p-2.5 rounded-xl bg-gray-50/80 border border-gray-100 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-900 truncate">
                      {(drv as any).email || drv.name}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {drv.createdAt ? new Date(drv.createdAt).toLocaleDateString('pt-BR') : 'Hoje'}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                    Pendente
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ======================================================== */}
      {/* CARD 3: Entregas Ativas (N)                              */}
      {/* ======================================================== */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-sm text-gray-900">
              Entregas Ativas ({activeDeliveries.length})
            </h4>
            <button
              type="button"
              onClick={() => onNavigateTab('map')}
              className="text-[11px] font-semibold text-blue-700 hover:text-blue-800 transition-colors cursor-pointer"
            >
              Ver todas
            </button>
          </div>

          {activeDeliveries.length === 0 ? (
            <div className="py-8 text-center text-gray-400 space-y-1">
              <Navigation className="w-6 h-6 mx-auto text-gray-300 mb-1" />
              <p className="text-xs">Nenhuma entrega em rota</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeDeliveries.map((order) => (
                <div
                  key={order.id}
                  className="p-2.5 rounded-xl bg-gray-50/80 border border-gray-100 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-gray-900">#{order.orderNumber}</span>
                      <span className="text-xs font-medium text-gray-700 truncate">{order.customerName}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 truncate mt-0.5">
                      {order.deliveryAddress}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      Em rota
                    </span>
                    <button
                      type="button"
                      onClick={() => onNavigateTab('map')}
                      className="p-1 text-gray-400 hover:text-blue-600 rounded-md transition-colors cursor-pointer"
                      title="Ver rota no mapa"
                    >
                      <MapPin className="w-3.5 h-3.5 text-rose-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ======================================================== */}
      {/* CARD 4: Últimas Entregas                                 */}
      {/* ======================================================== */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200 shadow-xs flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-sm text-gray-900">
              Últimas Entregas
            </h4>
            <button
              type="button"
              onClick={() => onNavigateTab('history')}
              className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 transition-colors cursor-pointer"
            >
              Ver todas
            </button>
          </div>

          {recentCompleted.length === 0 ? (
            <div className="py-8 text-center text-gray-400 space-y-1">
              <CheckCircle2 className="w-6 h-6 mx-auto text-gray-300 mb-1" />
              <p className="text-xs">Nenhuma entrega concluída hoje</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentCompleted.map((order) => {
                const time = order.updatedAt
                  ? new Date(order.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                  : order.createdAt
                    ? new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                    : '—';

                return (
                  <div
                    key={order.id}
                    className="p-2.5 rounded-xl bg-gray-50/80 border border-gray-100 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-900">#{order.orderNumber}</span>
                        <span className="text-[10px] text-gray-400">{time}</span>
                      </div>
                      <p className="text-[11px] font-semibold text-emerald-700 mt-0.5">
                        {order.totalAmount.toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        })}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                      Concluída
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
