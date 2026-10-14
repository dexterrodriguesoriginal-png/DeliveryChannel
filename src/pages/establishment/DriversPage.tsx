import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { driverRepository, driverInviteRepository, mapDriverRpcError, DriverInviteLink, DriverInviteLinkCreated } from '../../repositories/driverRepository';
import { teamRepository } from '../../repositories/teamRepository';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Driver, DriverStatus } from '../../types';
import { 
  Bike, 
  Phone, 
  Shield, 
  UserPlus, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Ban, 
  Navigation,
  Edit2
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { DriverApprovalBadge } from '../../components/establishment/statusBadges';
import { DriverInviteModal } from '../../components/establishment/DriverInviteModal';
import { PendingApplicationsSection, DriverLinkActions, InviteLinksSection } from '../../components/establishment/DriverOnboardingSections';
import { driverPagePermissions, pendingApplications, nonPendingDrivers, DriverLinkAction } from '../../lib/driverAdmin';

export const DriversPage: React.FC = () => {
  const { activeTenant, securityContext, activeRole } = useAuth();
  const { showToast } = useToast();
  const { canManageLinks, canReview } = driverPagePermissions(activeRole);

  // Convites por link/QR (0700). O token só existe em `createdInvite` enquanto o modal está aberto.
  const [inviteLinks, setInviteLinks] = useState<DriverInviteLink[]>([]);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<DriverInviteLinkCreated | null>(null);
  const [createdMaxUses, setCreatedMaxUses] = useState<number | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modal para convidar entregador
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

  const fetchDrivers = useCallback(async () => {
    // list_tenant_drivers (0700 v3.3) só autoriza OWNER/MANAGER; DELIVERY_MANAGER vê só os links.
    if (!activeTenant?.id || !canReview) return;
    setIsLoading(true);
    try {
      const data = await driverRepository.listDrivers(securityContext, activeTenant.id);
      setDrivers(data);
    } catch (err) {
      console.warn('[DriversPage] Erro ao carregar motoristas do Supabase:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, securityContext, canReview]);

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
  }, [fetchDrivers]);

  useEffect(() => {
    fetchInviteLinks();
  }, [fetchInviteLinks]);

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

  const pendingDrivers = pendingApplications(drivers);
  const listedDrivers = nonPendingDrivers(drivers);

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

  const getStatusBadge = (status: DriverStatus) => {
    switch (status) {
      case 'AVAILABLE':
        return <Badge variant="success" size="sm">DISPONÍVEL</Badge>;
      case 'ON_DELIVERY':
        return <Badge variant="warning" size="sm">EM ROTA</Badge>;
      case 'SUSPENDED':
        return <Badge variant="danger" size="sm">SUSPENSO</Badge>;
      case 'UNAVAILABLE':
      default:
        return <Badge variant="neutral" size="sm">INDISPONÍVEL</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Frota & Entregadores Próprios</h2>
          <p className="text-xs text-gray-500">
            Controle de motoboys vinculados, veículos, disponibilidade em tempo real e despacho seguro
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchDrivers()}
            className="p-2 text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors cursor-pointer"
            title="Atualizar dados"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-700' : ''}`} />
          </button>

          {canManageLinks && (
            <Button
              variant="outline"
              onClick={handleCreateLink}
              disabled={isCreatingLink}
              className="shadow-xs text-xs"
            >
              {isCreatingLink ? 'Gerando...' : 'Gerar link/QR'}
            </Button>
          )}

          <Button
            variant="primary"
            onClick={() => setIsInviteModalOpen(true)}
            leftIcon={<UserPlus className="w-4 h-4" />}
            className="shadow-xs text-xs"
          >
            + Convidar Entregador
          </Button>
        </div>
      </div>

      {canReview && (
        <PendingApplicationsSection
          drivers={pendingDrivers}
          busyId={busyId}
          onApprove={(d) => handleReview(d, 'APPROVE')}
          onReject={(d) => handleReview(d, 'REJECT')}
        />
      )}

      {/* Grid de Motoristas */}
      {listedDrivers.length === 0 ? (
        <Card className="p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <Bike className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-sm text-gray-900">Nenhum entregador cadastrado</h3>
          <p className="text-xs text-gray-500 max-w-sm mx-auto">
            Convide motoboys para a sua equipe. Assim que aceitarem o convite com a conta deles, você poderá atribuir pedidos diretamente no despacho.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsInviteModalOpen(true)}
            leftIcon={<UserPlus className="w-3.5 h-3.5" />}
          >
            Convidar Primeiro Entregador
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {listedDrivers.map((drv) => (
            <Card key={drv.id} className="p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200">
                      <Bike className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-gray-900">{drv.name}</h3>
                      <p className="text-xs text-gray-500 font-mono flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {drv.phone || 'Sem telefone'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    {getStatusBadge(drv.status || 'AVAILABLE')}
                    <DriverApprovalBadge status={drv.approvalStatus ?? 'UNKNOWN'} />
                  </div>
                </div>

                <div className="p-3 bg-gray-50 rounded-xl space-y-1.5 text-xs text-gray-700">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Veículo:</span>
                    <span className="font-medium text-gray-900">{drv.vehicle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Placa:</span>
                    <span className="font-mono text-gray-900 font-semibold">{drv.plate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Entregas hoje:</span>
                    <span className="font-bold text-emerald-800">{drv.completedDeliveriesToday} concluídas</span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenEdit(drv)}
                  leftIcon={<Edit2 className="w-3 h-3" />}
                  className="text-xs"
                >
                  Editar
                </Button>

                <DriverLinkActions driver={drv} canReview={canReview} onAction={handleLinkAction} />
              </div>
            </Card>
          ))}
        </div>
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

      <DriverInviteModal
        invite={createdInvite}
        storeName={activeTenant.name}
        maxUses={createdMaxUses}
        onClose={() => { setCreatedInvite(null); setCreatedMaxUses(null); }}
      />

      {/* Modal Convidar Entregador */}
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

          <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs space-y-1">
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
            <p className="text-[10px] text-gray-400 mt-1">Para suspender o entregador e desatribuir suas entregas, utilize o botão de suspensão na listagem.</p>
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
