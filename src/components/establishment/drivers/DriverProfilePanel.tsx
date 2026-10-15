import React, { useState } from 'react';
import { 
  Bike, 
  Phone, 
  MessageSquare, 
  Car, 
  Truck, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  ShieldCheck, 
  Award, 
  TrendingUp, 
  FileText, 
  Calendar, 
  Edit2, 
  Ban, 
  ExternalLink,
  Power,
  MoreVertical,
  User
} from 'lucide-react';
import { Driver, DriverStatus, Order } from '../../../types';
import { Button } from '../../ui/Button';
import { DriverApprovalBadge } from '../statusBadges';
import { DriverLinkAction } from '../../../lib/driverAdmin';

interface DriverProfilePanelProps {
  driver: Driver | null;
  onOpenEdit: (driver: Driver) => void;
  onToggleStatus: (driver: Driver, newStatus: DriverStatus) => void;
  onReview?: (driver: Driver, decision: 'APPROVE' | 'REJECT') => void;
  onLinkAction?: (driver: Driver, action: DriverLinkAction) => void;
  orders?: Order[];
  canReview?: boolean;
}

export const DriverProfilePanel: React.FC<DriverProfilePanelProps> = ({
  driver,
  onOpenEdit,
  onToggleStatus,
  onReview,
  onLinkAction,
  orders = [],
  canReview = true,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'history' | 'performance' | 'documents'>('overview');

  // Subtabs list
  const subTabs = [
    { id: 'overview', label: 'Visão Geral' },
    { id: 'history', label: 'Histórico' },
    { id: 'performance', label: 'Desempenho' },
    { id: 'documents', label: 'Documentos' },
  ] as const;

  // ========================================================
  // ESTADO SEM SELEÇÃO (Conforme Item C.3)
  // Avatar placeholder, nome em cinza, botões Editar/⋮ desabilitados,
  // abas Visão Geral/Histórico/Desempenho/Documentos,
  // bloco "Receber novas entregas" desabilitado,
  // 4 mini-cartões com "—", seção Informações com "—".
  // ========================================================
  if (!driver) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden flex flex-col">
        {/* Driver Header Sem Seleção */}
        <div className="p-5 border-b border-gray-100 bg-linear-to-b from-gray-50/80 to-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gray-100 border border-gray-200 text-gray-300 flex items-center justify-center font-bold text-lg shadow-2xs shrink-0">
                <User className="w-7 h-7 text-gray-300" />
              </div>
              <div>
                <h3 className="font-bold text-base text-gray-400">Nenhum entregador selecionado</h3>
                <p className="text-xs text-gray-300 font-mono mt-0.5">—</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md">
                    —
                  </span>
                  <span className="text-[11px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200">
                    —
                  </span>
                </div>
              </div>
            </div>

            {/* Botões Editar / ⋮ Desabilitados */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled
                className="p-1.5 text-gray-300 rounded-lg cursor-not-allowed"
                title="Editar entregador"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled
                className="p-1.5 text-gray-300 rounded-lg cursor-not-allowed"
                title="Mais opções"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Bloco "Receber novas entregas" Desabilitado */}
          <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/70 p-3 rounded-xl opacity-60">
            <div>
              <span className="text-xs font-semibold text-gray-400 block">Receber novas entregas</span>
              <span className="text-[10px] text-gray-400">
                Selecione um entregador para gerenciar
              </span>
            </div>

            <label className="relative inline-flex items-center cursor-not-allowed">
              <input
                type="checkbox"
                checked={false}
                disabled
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 rounded-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5"></div>
            </label>
          </div>
        </div>

        {/* Abas Visão Geral / Histórico / Desempenho / Documentos */}
        <div className="flex border-b border-gray-100 bg-gray-50/50 px-2">
          {subTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                activeSubTab === tab.id
                  ? 'border-emerald-600 text-emerald-800 bg-white'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Corpo do Painel Sem Seleção */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {activeSubTab === 'overview' && (
            <div className="space-y-4 text-xs">
              {/* 4 Mini-Cartões com "—" */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-gray-400 block text-[10px]">Entregas hoje</span>
                  <span className="font-bold text-sm text-gray-400">—</span>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-gray-400 block text-[10px]">Entregas no mês</span>
                  <span className="font-bold text-sm text-gray-400">—</span>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-gray-400 block text-[10px]">Ganhos hoje</span>
                  <span className="font-bold text-sm text-gray-400">—</span>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <span className="text-gray-400 block text-[10px]">Ganhos no mês</span>
                  <span className="font-bold text-sm text-gray-400">—</span>
                </div>
              </div>

              {/* Seção Informações com "—" */}
              <div className="bg-gray-50/80 rounded-xl p-3.5 border border-gray-100 space-y-2.5">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                  Informações
                </span>

                <div className="grid grid-cols-2 gap-2 text-gray-400 text-xs">
                  <div>
                    <span className="text-gray-400 block text-[10px]">Tipo de Veículo</span>
                    <span className="font-medium text-gray-400">—</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[10px]">Placa</span>
                    <span className="font-medium text-gray-400 font-mono">—</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[10px]">Telefone</span>
                    <span className="font-medium text-gray-400 font-mono">—</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[10px]">Status de Aprovação</span>
                    <span className="font-medium text-gray-400">—</span>
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled
                    className="flex-1 py-1.5 px-3 bg-white border border-gray-200 rounded-lg text-center font-medium text-gray-300 flex items-center justify-center gap-1.5 cursor-not-allowed"
                  >
                    <Phone className="w-3.5 h-3.5 text-gray-300" />
                    Ligar
                  </button>
                  <button
                    type="button"
                    disabled
                    className="flex-1 py-1.5 px-3 bg-white border border-gray-200 rounded-lg text-center font-medium text-gray-300 flex items-center justify-center gap-1.5 cursor-not-allowed"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-gray-300" />
                    WhatsApp
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSubTab === 'history' && (
            <div className="p-8 text-center text-gray-400 space-y-2">
              <Clock className="w-8 h-8 mx-auto text-gray-300" />
              <p className="text-xs">Selecione um entregador para ver o histórico de entregas.</p>
            </div>
          )}

          {activeSubTab === 'performance' && (
            <div className="p-8 text-center text-gray-400 space-y-2">
              <Award className="w-8 h-8 mx-auto text-gray-300" />
              <p className="text-xs">Selecione um entregador para acompanhar métricas de pontualidade e satisfação.</p>
            </div>
          )}

          {activeSubTab === 'documents' && (
            <div className="p-8 text-center text-gray-400 space-y-2">
              <FileText className="w-8 h-8 mx-auto text-gray-300" />
              <p className="text-xs">Selecione um entregador para consultar CNH e documentos cadastrados.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ========================================================
  // ESTADO COM ENTREGADOR SELECIONADO
  // ========================================================
  const isReceivingOrders = driver.status === 'AVAILABLE' || driver.status === 'ON_DELIVERY';
  const isSuspended = driver.status === 'SUSPENDED' || driver.approvalStatus === 'SUSPENDED';
  const isPending = driver.approvalStatus === 'PENDING';

  // Driver orders history
  const driverOrders = orders
    .filter((o) => o.driverId === driver.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Initials
  const initials = driver.name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'E';

  // Format phone for whatsapp
  const cleanPhone = (driver.phone || '').replace(/\D/g, '');
  const whatsappUrl = cleanPhone ? `https://wa.me/55${cleanPhone}` : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden flex flex-col">
      {/* Driver Header */}
      <div className="p-5 border-b border-gray-100 bg-linear-to-b from-gray-50/80 to-white">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-700 text-white flex items-center justify-center font-bold text-lg shadow-sm shrink-0">
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-gray-900">{driver.name}</h3>
                {isReceivingOrders && (
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-100" title="Disponível" />
                )}
              </div>
              <p className="text-xs text-gray-500 font-mono mt-0.5">{driver.phone || 'Sem telefone'}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[11px] font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-md">
                  {driver.vehicle}
                </span>
                <span className="text-[11px] font-mono text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200">
                  {driver.plate || 'SEM PLACA'}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenEdit(driver)}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
            title="Editar cadastro"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        </div>

        {/* Toggle: Receber novas entregas */}
        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/70 p-3 rounded-xl">
          <div>
            <span className="text-xs font-semibold text-gray-800 block">Receber novas entregas</span>
            <span className="text-[10px] text-gray-500">
              {isReceivingOrders ? 'Pronto para receber ordens do despacho' : 'Pausado / Fora de turno'}
            </span>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isReceivingOrders && !isSuspended}
              disabled={isSuspended}
              onChange={() => {
                const nextStatus: DriverStatus = isReceivingOrders ? 'UNAVAILABLE' : 'AVAILABLE';
                onToggleStatus(driver, nextStatus);
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>
      </div>

      {/* Internal Tabs */}
      <div className="flex border-b border-gray-100 bg-gray-50/50 px-2">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveSubTab(tab.id)}
            className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              activeSubTab === tab.id
                ? 'border-emerald-600 text-emerald-800 bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-Tab Content */}
      <div className="p-5 flex-1 overflow-y-auto space-y-4">
        {/* VISÃO GERAL */}
        {activeSubTab === 'overview' && (
          <div className="space-y-4 text-xs">
            {/* Pending approval banner */}
            {isPending && canReview && onReview && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-amber-800 font-semibold">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <span>Aguardando Aprovação da Loja</span>
                </div>
                <p className="text-[11px] text-amber-700">
                  Este entregador solicitou vínculo com o estabelecimento e precisa de aprovação para receber despachos.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onReview(driver, 'APPROVE')}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-xs shadow-2xs"
                  >
                    Aprovar Cadastro
                  </button>
                  <button
                    type="button"
                    onClick={() => onReview(driver, 'REJECT')}
                    className="px-3 py-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-lg font-medium text-xs"
                  >
                    Rejeitar
                  </button>
                </div>
              </div>
            )}

            {/* 4 Mini-Cartões com dados reais */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-gray-400 block text-[10px]">Entregas hoje</span>
                <span className="font-bold text-sm text-gray-900">
                  {driver.completedDeliveriesToday ?? 0}
                </span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-gray-400 block text-[10px]">Entregas no mês</span>
                <span className="font-bold text-sm text-gray-900">
                  {driverOrders.length > 0 ? driverOrders.length : '—'}
                </span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-gray-400 block text-[10px]">Ganhos hoje</span>
                <span className="font-bold text-sm text-gray-900">—</span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-gray-400 block text-[10px]">Ganhos no mês</span>
                <span className="font-bold text-sm text-gray-900">—</span>
              </div>
            </div>

            {/* Seção Informações */}
            <div className="bg-gray-50/80 rounded-xl p-3.5 border border-gray-100 space-y-2.5">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                Informações
              </span>

              <div className="grid grid-cols-2 gap-2 text-gray-700">
                <div>
                  <span className="text-gray-400 block text-[10px]">Tipo de Veículo</span>
                  <span className="font-semibold text-gray-900">{driver.vehicleType || 'MOTO'}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px]">Placa</span>
                  <span className="font-mono font-semibold text-gray-900">{driver.plate || 'N/D'}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px]">Telefone</span>
                  <span className="font-mono font-medium text-gray-900">{driver.phone || 'Sem telefone'}</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px]">Status de Aprovação</span>
                  <DriverApprovalBadge status={driver.approvalStatus ?? 'UNKNOWN'} />
                </div>
              </div>

              {/* Direct Communication Buttons */}
              <div className="pt-2 flex items-center gap-2">
                {driver.phone && (
                  <a
                    href={`tel:${driver.phone}`}
                    className="flex-1 py-1.5 px-3 bg-white border border-gray-200 rounded-lg text-center font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5 text-gray-500" />
                    Ligar
                  </a>
                )}
                {whatsappUrl && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-1.5 px-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-center font-medium hover:bg-emerald-100 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-700" />
                    WhatsApp
                  </a>
                )}
              </div>
            </div>

            {/* Ações Administrativas de Vínculo */}
            {canReview && onLinkAction && (
              <div className="pt-2 border-t border-gray-100 space-y-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                  Ações Administrativas
                </span>
                <div className="flex items-center gap-2">
                  {driver.approvalStatus === 'APPROVED' && (
                    <button
                      type="button"
                      onClick={() => onLinkAction(driver, 'SUSPEND')}
                      className="px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 rounded-lg text-xs font-medium transition-colors"
                    >
                      Suspender Entregador
                    </button>
                  )}
                  {driver.approvalStatus === 'SUSPENDED' && (
                    <button
                      type="button"
                      onClick={() => onLinkAction(driver, 'REACTIVATE')}
                      className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-xs font-medium transition-colors"
                    >
                      Reativar Entregador
                    </button>
                  )}
                  {driver.approvalStatus !== 'REMOVED' && (
                    <button
                      type="button"
                      onClick={() => onLinkAction(driver, 'REMOVE')}
                      className="px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg text-xs font-medium transition-colors"
                    >
                      Remover Vínculo
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* HISTÓRICO */}
        {activeSubTab === 'history' && (
          <div className="space-y-3 text-xs">
            {driverOrders.length === 0 ? (
              <div className="p-8 text-center text-gray-400 space-y-1">
                <Clock className="w-8 h-8 mx-auto text-gray-300 mb-1" />
                <p className="text-xs">Nenhuma entrega registrada para este motorista.</p>
              </div>
            ) : (
              driverOrders.map((ord) => (
                <div
                  key={ord.id}
                  className="p-3 bg-gray-50/70 border border-gray-100 rounded-xl flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900">Pedido #{ord.orderNumber}</span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(ord.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 truncate max-w-[200px] mt-0.5">
                      {ord.customerName}
                    </p>
                  </div>
                  <span className="font-semibold text-emerald-700">
                    {ord.totalAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* DESEMPENHO */}
        {activeSubTab === 'performance' && (
          <div className="space-y-3 text-xs">
            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Métricas Operacionais
              </span>
              <div className="grid grid-cols-2 gap-2 text-gray-700">
                <div>
                  <span className="text-gray-400 block text-[10px]">Pontualidade</span>
                  <span className="font-bold text-gray-900">—</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px]">Tempo Médio de Rota</span>
                  <span className="font-bold text-gray-900">—</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px]">Taxa de Conclusão</span>
                  <span className="font-bold text-gray-900">—</span>
                </div>
                <div>
                  <span className="text-gray-400 block text-[10px]">Avaliação Geral</span>
                  <span className="font-bold text-gray-900">—</span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 text-center">
              As métricas avançadas serão calculadas automaticamente conforme o histórico de entregas for registrado.
            </p>
          </div>
        )}

        {/* DOCUMENTOS */}
        {activeSubTab === 'documents' && (
          <div className="space-y-3 text-xs">
            <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Documentação Cadastrada
              </span>
              <div className="space-y-2 text-gray-700">
                <div className="flex items-center justify-between py-1 border-b border-gray-200/60">
                  <span className="text-gray-500">Documento / CPF</span>
                  <span className="font-mono font-medium text-gray-900">
                    {driver.document || 'Não informado'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-gray-200/60">
                  <span className="text-gray-500">Placa do Veículo</span>
                  <span className="font-mono font-medium text-gray-900">
                    {driver.plate || 'Não informada'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-gray-500">Vínculo na Loja</span>
                  <DriverApprovalBadge status={driver.approvalStatus ?? 'UNKNOWN'} />
                </div>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 text-center">
              O upload e validação de CNH/CRLV digital estarão disponíveis nas próximas atualizações do cadastro.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
