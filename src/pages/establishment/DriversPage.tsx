import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
  driverRepository, 
  driverInviteRepository, 
  mapDriverRpcError, 
  DriverInviteLink, 
  DriverInviteLinkCreated 
} from '../../repositories/driverRepository';
import { orderRepository } from '../../repositories/orderRepository';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Driver, DriverStatus, Order } from '../../types';
import { 
  Bike, 
  Users, 
  UserPlus, 
  RefreshCw, 
  ChevronDown, 
  Mail, 
  Link, 
  QrCode, 
  MessageSquare, 
  List, 
  MapPin, 
  Clock, 
  Award, 
  Settings, 
  ExternalLink,
  ShieldCheck,
  Ban
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { DriverInviteModal } from '../../components/establishment/DriverInviteModal';
import { PendingApplicationsSection, DriverLinkActions, InviteLinksSection } from '../../components/establishment/DriverOnboardingSections';
import { driverPagePermissions, pendingApplications, nonPendingDrivers, DriverLinkAction } from '../../lib/driverAdmin';

// Subcomponents
import { DriverMetricsStrip } from '../../components/establishment/drivers/DriverMetricsStrip';
import { DriverTableSection } from '../../components/establishment/drivers/DriverTableSection';
import { DriverProfilePanel } from '../../components/establishment/drivers/DriverProfilePanel';
import { DriverBottomSummaryCards } from '../../components/establishment/drivers/DriverBottomSummaryCards';
import { DriverFleetMapTab } from '../../components/establishment/drivers/DriverFleetMapTab';
import { DriverHistoryTab } from '../../components/establishment/drivers/DriverHistoryTab';
import { DriverPerformanceTab } from '../../components/establishment/drivers/DriverPerformanceTab';
import { DriverSettingsTab } from '../../components/establishment/drivers/DriverSettingsTab';

interface DriversPageProps {
  onNavigate?: (tab: string) => void;
}

export const DriversPage: React.FC<DriversPageProps> = ({ onNavigate }) => {
  const { activeTenant, securityContext, activeRole } = useAuth();
  const { showToast } = useToast();
  const { canManageLinks, canReview } = driverPagePermissions(activeRole);

  // Active top-level tab
  const [activeTab, setActiveTab] = useState<
    'list' | 'map' | 'invites' | 'history' | 'performance' | 'settings'
  >('list');
  useEffect(() => {
    const focus = () => { if (activeTenant && sessionStorage.getItem(`dc:focus-driver:${activeTenant.id}`)) setActiveTab('invites'); };
    focus(); window.addEventListener('dc:focus-driver', focus); return () => window.removeEventListener('dc:focus-driver', focus);
  }, [activeTenant?.id]);

  // Convites por link/QR (0700). O token só existe em `createdInvite` enquanto o modal está aberto.
  const [inviteLinks, setInviteLinks] = useState<DriverInviteLink[]>([]);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<DriverInviteLinkCreated | null>(null);
  const [createdMaxUses, setCreatedMaxUses] = useState<number | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Drivers and Orders
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Dropdown menu "Convidar Entregador"
  const [isInviteMenuOpen, setIsInviteMenuOpen] = useState(false);

  // Modal para convidar entregador por e-mail
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);

  // Modal para editar dados operacionais do veículo
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleType, setVehicleType] = useState('MOTO');
  const [driverStatus, setDriverStatus] = useState<DriverStatus>('AVAILABLE');
  const [isSaving, setIsSaving] = useState(false);

  // Fetch drivers
  const fetchDrivers = useCallback(async () => {
    if (!activeTenant?.id || !canReview) return;
    setIsLoading(true);
    try {
      const data = await driverRepository.listDrivers(securityContext, activeTenant.id);
      setDrivers(data);
      const focusId = sessionStorage.getItem(`dc:focus-driver:${activeTenant.id}`);
      if (focusId) { setSelectedDriver(data.find(d => d.id === focusId) || null); setActiveTab('invites'); sessionStorage.removeItem(`dc:focus-driver:${activeTenant.id}`); }
      // Auto select first driver if none selected or selected was removed
      setSelectedDriver((prev) => {
        if (!prev) return data.length > 0 ? data[0] : null;
        const found = data.find((d) => d.id === prev.id);
        return found || (data.length > 0 ? data[0] : null);
      });
    } catch (err) {
      console.warn('[DriversPage] Erro ao carregar motoristas do Supabase:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, securityContext, canReview]);

  // Fetch orders
  const fetchOrders = useCallback(async () => {
    if (!activeTenant?.id) return;
    try {
      const data = await orderRepository.getOrders(securityContext, activeTenant.id);
      setOrders(data);
    } catch (err) {
      console.warn('[DriversPage] Erro ao carregar pedidos para histórico de entregas:', err);
    }
  }, [activeTenant?.id, securityContext]);

  // Fetch invite links
  const fetchInviteLinks = useCallback(async () => {
    if (!activeTenant?.id || !canManageLinks) return;
    try {
      setInviteLinks(await driverInviteRepository.listInviteLinks(activeTenant.id));
      setLinksError(null);
    } catch (err: any) {
      setInviteLinks([]);
      setLinksError(err?.message || 'Recurso ainda não disponível.');
    }
  }, [activeTenant?.id, canManageLinks]);

  useEffect(() => {
    fetchDrivers();
    fetchOrders();
  }, [fetchDrivers, fetchOrders]);

  useEffect(() => {
    fetchInviteLinks();
  }, [fetchInviteLinks]);

  // Close invite menu on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#invite-driver-menu-container')) {
        setIsInviteMenuOpen(false);
      }
    };
    if (isInviteMenuOpen) {
      document.addEventListener('click', handleOutsideClick);
      return () => document.removeEventListener('click', handleOutsideClick);
    }
  }, [isInviteMenuOpen]);

  if (!activeTenant) return null;

  const handleOpenEdit = (drv: Driver) => {
    setEditingDriver(drv);
    setVehicleModel(drv.vehicleModel || drv.vehicle || '');
    setVehiclePlate(drv.plate || '');
    setVehicleType(drv.vehicleType || 'MOTO');
    setDriverStatus(drv.status === 'SUSPENDED' ? 'UNAVAILABLE' : (drv.status || 'AVAILABLE'));
  };

  const handleSaveDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDriver) return;

    setIsSaving(true);
    try {
      await driverRepository.updateDriverProfile(securityContext, activeTenant.id, editingDriver.id, {
        vehicleModel,
        plate: vehiclePlate,
        vehicleType,
        status: driverStatus,
      });

      showToast({
        type: 'success',
        title: 'Dados Atualizados',
        message: `Cadastro de ${editingDriver.name} atualizado com sucesso.`,
      });

      setEditingDriver(null);
      await fetchDrivers();
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Salvar',
        message: err.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleDriverStatus = async (drv: Driver, newStatus: DriverStatus) => {
    try {
      await driverRepository.updateDriverProfile(securityContext, activeTenant.id, drv.id, {
        status: newStatus,
      });
      showToast({
        type: 'success',
        title: 'Status Alterado',
        message: `${drv.name} agora está ${newStatus === 'AVAILABLE' ? 'Disponível' : 'Indisponível'}.`,
      });
      await fetchDrivers();
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao alterar status',
        message: err.message,
      });
    }
  };

  const showRpcError = (title: string, err: any) => {
    showToast({ type: 'error', title, message: err?.message || mapDriverRpcError(err) });
  };

  const handleReview = async (drv: Driver, decision: 'APPROVE' | 'REJECT') => {
    let reason: string | undefined;
    if (decision === 'REJECT') {
      const r = window.prompt(`Rejeitar o cadastro de ${drv.name}? Motivo (opcional):`, '');
      if (r === null) return;
      reason = r.trim() || undefined;
    }
    setBusyId(drv.id);
    try {
      await driverInviteRepository.reviewApplication(drv.id, decision, reason);
      showToast({
        type: decision === 'APPROVE' ? 'success' : 'warning',
        title: decision === 'APPROVE' ? 'Entregador aprovado' : 'Cadastro rejeitado',
        message: decision === 'APPROVE' ? `${drv.name} já pode receber pedidos.` : `${drv.name} não foi aprovado.`,
      });
      await fetchDrivers();
    } catch (err: any) {
      showRpcError(decision === 'APPROVE' ? 'Erro ao aprovar' : 'Erro ao rejeitar', err);
    } finally {
      setBusyId(null);
    }
  };

  const handleLinkAction = async (drv: Driver, action: DriverLinkAction) => {
    const confirmText = action === 'SUSPEND'
      ? `Deseja suspender as atividades operacionais de ${drv.name}? Ele não poderá receber pedidos.`
      : action === 'REMOVE'
        ? `Remover ${drv.name} da equipe? Para readmitir será preciso um novo convite por e-mail.`
        : null;
    if (confirmText && !window.confirm(confirmText)) return;

    try {
      await driverInviteRepository.setLinkStatus(drv.id, action);
      const titles = { SUSPEND: 'Motorista Suspenso', REACTIVATE: 'Motorista Reativado', REMOVE: 'Vínculo Encerrado' } as const;
      showToast({ type: action === 'REACTIVATE' ? 'success' : 'warning', title: titles[action], message: drv.name });
      await fetchDrivers();
    } catch (err: any) {
      showRpcError('Erro ao atualizar vínculo', err);
    }
  };

  const handleCreateLink = async () => {
    setIsCreatingLink(true);
    try {
      const created = await driverInviteRepository.createInviteLink(activeTenant.id, null, 7, null);
      setCreatedMaxUses(null);
      setCreatedInvite(created);
      await fetchInviteLinks();
    } catch (err: any) {
      showRpcError('Erro ao gerar link', err);
    } finally {
      setIsCreatingLink(false);
    }
  };

  const handleRenewLink = async (link: DriverInviteLink) => {
    setBusyId(link.id);
    try {
      const created = await driverInviteRepository.renewInviteLink(link.id);
      setCreatedMaxUses(link.maxUses);
      setCreatedInvite(created);
      await fetchInviteLinks();
    } catch (err: any) {
      showRpcError('Erro ao renovar link', err);
    } finally {
      setBusyId(null);
    }
  };

  const handleRevokeLink = async (link: DriverInviteLink) => {
    if (!window.confirm('Revogar este link? Quem ainda não se cadastrou não poderá mais usá-lo.')) return;
    setBusyId(link.id);
    try {
      await driverInviteRepository.revokeInviteLink(link.id);
      await fetchInviteLinks();
    } catch (err: any) {
      showRpcError('Erro ao revogar link', err);
    } finally {
      setBusyId(null);
    }
  };

  const handleInviteDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;

    setIsInviting(true);
    try {
      await driverRepository.inviteDriver(
        securityContext,
        activeTenant.id,
        inviteEmail.trim()
      );

      showToast({
        type: 'success',
        title: 'Convite Enviado',
        message: `Convite de entregador enviado para ${inviteEmail}.`,
      });

      setIsInviteModalOpen(false);
      setInviteEmail('');
      await fetchDrivers();
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Enviar Convite',
        message: err.message,
      });
    } finally {
      setIsInviting(false);
    }
  };

  const pendingDrivers = pendingApplications(drivers);
  const pendingCount = pendingDrivers.length;

  return (
    <div className="space-y-6">
      {/* ======================================================== */}
      {/* CABEÇALHO DA PÁGINA COM AÇÕES E MENU CONVIDAR            */}
      {/* ======================================================== */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">Entregadores</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Gerencie sua equipe de entregas, acompanhe status em tempo real e convide novos entregadores
          </p>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => {
              fetchDrivers();
              fetchOrders();
            }}
            className="p-2.5 text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors cursor-pointer border border-gray-200 bg-white shadow-2xs"
            title="Atualizar dados"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-700' : ''}`} />
          </button>

          {/* Botão Verde "Convidar Entregador" com Menu Dropdown */}
          <div className="relative" id="invite-driver-menu-container">
            <button
              type="button"
              onClick={() => setIsInviteMenuOpen(!isInviteMenuOpen)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-2 transition-all cursor-pointer active:scale-98"
            >
              <UserPlus className="w-4 h-4" />
              <span>Convidar Entregador</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isInviteMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {isInviteMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-2xl shadow-xl z-50 py-1.5 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                <button
                  type="button"
                  onClick={() => {
                    setIsInviteMenuOpen(false);
                    setIsInviteModalOpen(true);
                  }}
                  className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-emerald-50 hover:text-emerald-800 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Mail className="w-4 h-4 text-emerald-600" />
                  <span>Convidar por E-mail</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsInviteMenuOpen(false);
                    handleCreateLink();
                  }}
                  className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-emerald-50 hover:text-emerald-800 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Link className="w-4 h-4 text-emerald-600" />
                  <span>Gerar Link de Convite</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsInviteMenuOpen(false);
                    handleCreateLink();
                  }}
                  className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-emerald-50 hover:text-emerald-800 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <QrCode className="w-4 h-4 text-emerald-600" />
                  <span>Gerar QR Code</span>
                </button>

                <div className="border-t border-gray-100 my-1" />

                <button
                  type="button"
                  onClick={() => {
                    setIsInviteMenuOpen(false);
                    handleCreateLink();
                  }}
                  className="w-full px-4 py-2.5 text-left text-xs font-medium text-gray-700 hover:bg-emerald-50 hover:text-emerald-800 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4 text-emerald-600" />
                  <span>Enviar via WhatsApp</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 5 CARTÕES DE INDICADORES (KPIs REAIS)                     */}
      {/* ======================================================== */}
      <DriverMetricsStrip drivers={drivers} />

      {/* ======================================================== */}
      {/* ABAS DE NAVEGAÇÃO                                         */}
      {/* ======================================================== */}
      <div className="flex border-b border-gray-200 overflow-x-auto gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('list')}
          className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'list'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/30'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <List className="w-4 h-4" />
          <span>Lista de Entregadores</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('map')}
          className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'map'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/30'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span>Mapa de Entregas</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('invites')}
          className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'invites'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/30'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <UserPlus className="w-4 h-4" />
          <span>Convites Pendentes</span>
          {pendingCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
              {pendingCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'history'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/30'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Histórico de Entregas</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('performance')}
          className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'performance'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/30'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Award className="w-4 h-4" />
          <span>Desempenho</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'settings'
              ? 'border-emerald-600 text-emerald-800 bg-emerald-50/30'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Configurações</span>
        </button>
      </div>

      {/* ======================================================== */}
      {/* CONTEÚDO DAS ABAS                                         */}
      {/* ======================================================== */}

      {/* 1. ABA LISTA DE ENTREGADORES (Imagem 2_lista) */}
      {activeTab === 'list' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Tabela à esquerda */}
            <div className="lg:col-span-8">
              <DriverTableSection
                drivers={drivers}
                selectedDriver={selectedDriver}
                onSelectDriver={setSelectedDriver}
                onOpenEdit={handleOpenEdit}
                deliveryFee={activeTenant.settings?.deliveryFee ?? 6.5}
              />
            </div>

            {/* Painel de perfil à direita */}
            <div className="lg:col-span-4 sticky top-6">
              <DriverProfilePanel
                driver={selectedDriver}
                onOpenEdit={handleOpenEdit}
                onToggleStatus={handleToggleDriverStatus}
                onReview={handleReview}
                onLinkAction={handleLinkAction}
                orders={orders}
                canReview={canReview}
              />
            </div>
          </div>

          {/* Linha inferior de 4 cartões */}
          <DriverBottomSummaryCards
            drivers={drivers}
            orders={orders}
            onOpenInviteModal={() => setIsInviteModalOpen(true)}
            onGenerateLink={handleCreateLink}
            onGenerateQr={handleCreateLink}
            onShareWhatsapp={handleCreateLink}
            onNavigateTab={(tab) => setActiveTab(tab as any)}
          />
        </div>
      )}

      {/* 2. ABA MAPA DE ENTREGAS (Imagem 1_mapa) */}
      {activeTab === 'map' && (
        <DriverFleetMapTab
          tenant={activeTenant}
          drivers={drivers}
          orders={orders}
          onOpenOrderKanban={onNavigate ? () => onNavigate('est-orders') : undefined}
          onOpenEditDriver={handleOpenEdit}
        />
      )}

      {/* 3. ABA CONVITES PENDENTES */}
      {activeTab === 'invites' && (
        <div className="space-y-6">
          {canReview && (
            <PendingApplicationsSection
              drivers={pendingDrivers}
              busyId={busyId}
              onApprove={(d) => handleReview(d, 'APPROVE')}
              onReject={(d) => handleReview(d, 'REJECT')}
            />
          )}

          {canManageLinks && (
            <InviteLinksSection
              links={inviteLinks}
              error={linksError}
              busyId={busyId}
              onRenew={handleRenewLink}
              onRevoke={handleRevokeLink}
            />
          )}
        </div>
      )}

      {/* 4. ABA HISTÓRICO DE ENTREGAS */}
      {activeTab === 'history' && (
        <DriverHistoryTab orders={orders} drivers={drivers} />
      )}

      {/* 5. ABA DESEMPENHO */}
      {activeTab === 'performance' && (
        <DriverPerformanceTab drivers={drivers} orders={orders} />
      )}

      {/* 6. ABA CONFIGURAÇÕES */}
      {activeTab === 'settings' && (
        <DriverSettingsTab tenant={activeTenant} />
      )}

      {/* ======================================================== */}
      {/* MODAIS REUTILIZADOS & PRESERVADOS                        */}
      {/* ======================================================== */}

      {/* Modal Convite por Link / QR Code */}
      <DriverInviteModal
        invite={createdInvite}
        storeName={activeTenant.name}
        maxUses={createdMaxUses}
        onClose={() => { setCreatedInvite(null); setCreatedMaxUses(null); }}
      />

      {/* Modal Convidar Entregador por E-mail */}
      <Modal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        title="Convidar Entregador para a Frota"
        description="O motorista receberá um convite formal com o papel DRIVER. Ele deverá criar ou acessar a conta dele com este e-mail para receber as ordens de entrega."
        size="md"
      >
        <form onSubmit={handleInviteDriver} className="space-y-4 text-xs">
          <Input
            label="E-mail do Entregador *"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="motoboy@email.com"
            required
          />

          <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs space-y-1 border border-emerald-100">
            <strong>Arquitetura de Segurança:</strong>
            <p className="text-[11px] text-emerald-700">
              O motorista é autenticado com a própria conta e vinculado com papel DRIVER. Somente os pedidos atribuídos a ele pelo despacho da loja serão visíveis no painel dele.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsInviteModalOpen(false)}
              disabled={isInviting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isInviting}
            >
              {isInviting ? 'Enviando...' : 'Enviar Convite'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal Editar Motorista */}
      <Modal
        isOpen={Boolean(editingDriver)}
        onClose={() => setEditingDriver(null)}
        title={`Editar Operação: ${editingDriver?.name || ''}`}
        description="Atualize as informações do veículo e a disponibilidade de despacho."
        size="md"
      >
        <form onSubmit={handleSaveDriver} className="space-y-4 text-xs">
          <div>
            <label className="font-semibold text-gray-700 block mb-1">Tipo de Veículo *</label>
            <select
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-emerald-600"
            >
              <option value="MOTO">Moto / Motocicleta</option>
              <option value="BIKE">Bicicleta / Bike Elétrica</option>
              <option value="CARRO">Carro</option>
              <option value="VAN">Van / Utilitário</option>
              <option value="OUTRO">Outro</option>
            </select>
          </div>

          <Input
            label="Modelo do Veículo"
            value={vehicleModel}
            onChange={(e) => setVehicleModel(e.target.value)}
            placeholder="Ex: Honda CG 160 Fan"
          />

          <Input
            label="Placa do Veículo"
            value={vehiclePlate}
            onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
            placeholder="Ex: ABC-1234 ou BRA2E19"
          />

          <div>
            <label className="font-semibold text-gray-700 block mb-1">Status Operacional *</label>
            <select
              value={driverStatus}
              onChange={(e) => setDriverStatus(e.target.value as DriverStatus)}
              className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-emerald-600"
            >
              <option value="AVAILABLE">DISPONÍVEL (Pronto para receber pedidos)</option>
              <option value="UNAVAILABLE">INDISPONÍVEL (Fora de turno)</option>
            </select>
            <p className="text-[10px] text-gray-400 mt-1">
              Para suspender o entregador e desatribuir suas entregas, utilize a opção de suspensão no perfil do entregador.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingDriver(null)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSaving}
            >
              {isSaving ? 'Salvando...' : 'Salvar Alterações'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
