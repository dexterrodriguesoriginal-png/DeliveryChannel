import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { teamRepository } from '../../repositories/teamRepository';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { TeamMember, TeamInvite, RoleId } from '../../types';
import { Users, UserPlus, Trash2, Mail, Phone, Clock, RefreshCw, XCircle, Send, Pencil, KeyRound, Power, AtSign } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { TeamMemberStatusBadge } from '../../components/establishment/statusBadges';
import { TeamRoleAccessBlock } from '../../components/establishment/TeamRoleAccessBlock';
import { storeTeamRepository, type StoreRolePermission } from '../../repositories/storeTeamRepository';
import { TEAM_ROLE_LABELS, STORE_PERMISSION_LABELS, visibleTeamRoles, canCustomizeRolePermission, maskTeamInviteEmail, type StoreTools } from '../../lib/teamAccess';
import { WaiterAccessBlock } from '../../components/establishment/WaiterAccessBlock';
import { CreateWaiterModal, EditWaiterModal, ResetWaiterPasswordModal } from '../../components/establishment/waiter/WaiterTeamModals';
import { waiterV2Repository, type DirectoryMember } from '../../repositories/waiterV2Repository';
import { initials } from '../../lib/waiter/waiterRouting';
import { isWaiterSyntheticEmail } from '../../lib/waiter/waiterIdentity';
import { TableMoveApprovalSetting } from '../../components/establishment/waiter/TableMoveApprovalSetting';

const TAB_LABELS: Partial<Record<RoleId, string>> = { ...TEAM_ROLE_LABELS, OPERATOR: 'Estoque', DELIVERY_MANAGER: 'Coordenador' };

export const TeamPage: React.FC = () => {
  const { activeTenant } = useAuth();
  return activeTenant ? <TeamPageForTenant key={activeTenant.id} /> : null;
};

const TeamPageForTenant: React.FC = () => {
  const { activeTenant, securityContext, activeRole, refreshStoreAccess } = useAuth();
  const { showToast } = useToast();

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<TeamInvite[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [tools, setTools] = useState<StoreTools>({ waiter: false, kitchen: false });
  const [permissions, setPermissions] = useState<StoreRolePermission[]>([]);
  const [settingsError, setSettingsError] = useState('');
  const [savingPermission, setSavingPermission] = useState<string | null>(null);
  const [waiterMode, setWaiterMode] = useState<'login' | 'invite'>('login');
  const currentTenant = useRef(activeTenant?.id);
  currentTenant.current = activeTenant?.id;
  useEffect(() => {
    currentTenant.current = activeTenant?.id;
    return () => { currentTenant.current = undefined; };
  }, [activeTenant?.id]);
  const [loadedTenant, setLoadedTenant] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteShare, setInviteShare] = useState<{ role: RoleId; email: string } | null>(null);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleId | 'ALL'>('ALL');
  // Garçom v2 (login por usuário e senha): só aparece com a migration 20261027004900 aplicada.
  const [directory, setDirectory] = useState<Map<string, DirectoryMember> | null>(null);
  const [createWaiterOpen, setCreateWaiterOpen] = useState(false);
  const [editWaiter, setEditWaiter] = useState<DirectoryMember | null>(null);
  const [resetWaiter, setResetWaiter] = useState<DirectoryMember | null>(null);
  const [storeAccess, setStoreAccess] = useState<{ username?: string } | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    role: 'OPERATOR' as RoleId,
  });

  const fetchTeamData = useCallback(async () => {
    if (!activeTenant?.id || currentTenant.current !== activeTenant.id) return;
    setIsLoading(true);
    try {
      const [members, invites, dir, toolResult, permissionResult] = await Promise.all([
        teamRepository.listTeamMembers(securityContext, activeTenant.id).catch(() => []),
        teamRepository.listPendingInvites(securityContext, activeTenant.id),
        waiterV2Repository.directory(activeTenant.id),
        storeTeamRepository.listTools(activeTenant.id).then(data => ({ data, failed: false })).catch(() => ({ data: { waiter: false, kitchen: false }, failed: true })),
        storeTeamRepository.listPermissions(activeTenant.id).catch(() => []),
      ]);
      if (currentTenant.current !== activeTenant.id) return;
      // O RPC autorizado é a fonte de vínculos e perfis. Enriquecer apenas as linhas
      // da consulta direta descartava convidados aceitos presentes só no diretório.
      const byUser = dir ? new Map(dir.map(d => [d.userId, d])) : null;
      setDirectory(byUser);
      setTools(toolResult.data);
      setSettingsError(toolResult.failed ? 'Não foi possível carregar as ferramentas. Atualize os dados antes de adicionar Garçom ou Cozinha.' : '');
      setPermissions(permissionResult);
      setTeam(dir !== null ? dir.map(d => ({
        id: d.id, tenantId: activeTenant.id, userId: d.userId,
        name: d.name || 'Colaborador', email: isWaiterSyntheticEmail(d.email) ? '' : d.email,
        phone: d.phone || undefined, role: d.roleId as RoleId,
        status: d.status as TeamMember['status'], createdAt: d.createdAt,
      })) : members);
      setPendingInvites(invites);
      setLoadedTenant(activeTenant.id);
    } catch (err) {
      if (currentTenant.current !== activeTenant.id) return;
      setTeam([]); setPendingInvites([]); setDirectory(null); setLoadedTenant(null);
      setSettingsError('Não foi possível carregar o diretório da equipe. Atualize os dados e tente novamente.');
      showToast({ type: 'error', title: 'Não foi possível carregar a equipe', message: 'Atualize os dados e tente novamente.' });
    } finally {
      if (currentTenant.current === activeTenant.id) setIsLoading(false);
    }
  }, [activeTenant?.id, securityContext]);

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  useEffect(() => {
    setIsModalOpen(false); setCreateWaiterOpen(false); setEditWaiter(null); setResetWaiter(null);
    setStoreAccess(null); setInviteShare(null); setResendingInvite(null); setRoleFilter('ALL'); setSavingPermission(null); setIsSubmitting(false); setSettingsError('');
    setFormData({ email: '', role: 'OPERATOR' });
  }, [activeTenant?.id]);

  if (!activeTenant) return null;
  const roleList = visibleTeamRoles(loadedTenant === activeTenant.id ? tools : { waiter: false, kitchen: false });
  const visibleTeam = loadedTenant === activeTenant.id ? team.filter(member => member.status === 'ACTIVE' && roleList.includes(member.role)) : [];
  const visibleInvites = loadedTenant === activeTenant.id ? pendingInvites.filter(invite => invite.status === 'PENDING' && roleList.includes(invite.roleId)) : [];
  const selectedRole = roleFilter === 'ALL' || roleList.includes(roleFilter) ? roleFilter : 'ALL';
  const tabs = ['ALL' as const, ...roleList.filter(role => role !== 'OWNER')];
  const displayedRoles = selectedRole === 'ALL' ? roleList : roleList.filter(role => role === selectedRole);
  const canManage = activeRole === 'OWNER' || activeRole === 'MANAGER';
  const canEditPermissions = activeRole === 'OWNER';
  const togglePermission = async (row: StoreRolePermission) => {
    if (!canEditPermissions || !canCustomizeRolePermission(row.role, row.permission) || savingPermission) return;
    const tenantId = activeTenant.id;
    const key = `${row.role}:${row.permission}`;
    setSavingPermission(key);
    try {
      await storeTeamRepository.setPermission(tenantId, row.role, row.permission, !row.enabled);
      if (currentTenant.current !== tenantId) return;
      window.dispatchEvent(new Event('dc:store-access-changed'));
      await refreshStoreAccess?.();
      if (currentTenant.current !== tenantId) return;
      setPermissions(rows => rows.map(item => item.role === row.role && item.permission === row.permission ? { ...item, enabled: !row.enabled } : item));
      showToast({ type: 'success', title: 'Permissão atualizada', message: 'O acesso do papel foi atualizado.' });
    } catch (err) {
      if (currentTenant.current === tenantId) showToast({ type: 'error', title: 'Não foi possível alterar a permissão', message: err instanceof Error ? err.message : 'Tente novamente.' });
    } finally { if (currentTenant.current === tenantId) setSavingPermission(null); }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !roleList.includes(formData.role) || formData.role === 'OWNER') return;
    if (!formData.email) {
      showToast({
        type: 'error',
        title: 'Preencha os campos',
        message: 'O e-mail é obrigatório para o convite formal.',
      });
      return;
    }

    const tenantId = activeTenant.id;
    setIsSubmitting(true);
    try {
      await teamRepository.createInvite(
        securityContext,
        activeTenant.id,
        formData.email.trim(),
        formData.role
      );
      if (currentTenant.current !== tenantId) return;

      showToast({
        type: 'success',
        title: 'Convite criado',
        message: `Convite criado para ${maskTeamInviteEmail(formData.email)}. Compartilhe o QR ou o link de acesso com o colaborador.`,
      });
      setInviteShare({ role: formData.role, email: maskTeamInviteEmail(formData.email) });

      setIsModalOpen(false);
      setFormData({ email: '', role: 'OPERATOR' });
      await fetchTeamData();
    } catch (err: any) {
      if (currentTenant.current !== tenantId) return;
      showToast({
        type: 'error',
        title: 'Erro ao Convidar',
        message: err.message || 'Falha ao processar convite.',
      });
    } finally {
      if (currentTenant.current === tenantId) setIsSubmitting(false);
    }
  };

  const handleResendInvite = async (invite: TeamInvite) => {
    if (!canManage || resendingInvite) return;
    const tenantId = activeTenant.id;
    setResendingInvite(invite.id);
    try {
      await teamRepository.resendInvite(securityContext, tenantId, invite.id);
      if (currentTenant.current !== tenantId) return;
      setInviteShare({ role: invite.roleId, email: maskTeamInviteEmail(invite.email) });
      showToast({ type: 'success', title: 'Convite renovado', message: 'Validade renovada. Compartilhe o QR ou o link com o colaborador.' });
      await fetchTeamData();
    } catch (err) {
      if (currentTenant.current === tenantId) showToast({ type: 'error', title: 'Não foi possível renovar o convite', message: err instanceof Error ? err.message : 'Tente novamente.' });
    } finally {
      if (currentTenant.current === tenantId) setResendingInvite(null);
    }
  };

  const handleRevokeInvite = async (invite: TeamInvite) => {
    if (!canManage) return;
    const tenantId = activeTenant.id;
    try {
      await teamRepository.revokeInvite(securityContext, activeTenant.id, invite.id);
      if (currentTenant.current !== tenantId) return;
      showToast({
        type: 'success',
        title: 'Convite Revogado',
        message: `O convite para ${maskTeamInviteEmail(invite.email)} foi cancelado.`,
      });
      await fetchTeamData();
    } catch (err: any) {
      if (currentTenant.current !== tenantId) return;
      showToast({
        type: 'error',
        title: 'Erro ao Revogar',
        message: err.message,
      });
    }
  };

  const waiterAction = async (member: TeamMember, run: () => Promise<unknown>, done: { title: string; message: string }) => {
    if (!canManage) return;
    const tenantId = activeTenant.id;
    try {
      await run();
      if (currentTenant.current !== tenantId) return;
      showToast({ type: 'success', ...done });
      await fetchTeamData();
    } catch (err: any) {
      if (currentTenant.current !== tenantId) return;
      showToast({ type: 'error', title: 'Não foi possível concluir', message: err.message || 'Tente novamente.' });
    }
  };

  const handleRemove = async (member: TeamMember) => {
    if (!canManage) return;
    if (member.role === 'OWNER') {
      showToast({
        type: 'error',
        title: 'Ação Não Permitida',
        message: 'O proprietário da loja não pode ser removido da equipe.',
      });
      return;
    }

    const isWaiter = member.role === 'WAITER';
    if (!window.confirm(isWaiter
      ? `Remover o garçom ${member.name} desta loja? Ele perderá o acesso ao salão. O histórico de pedidos será mantido.`
      : `Tem certeza que deseja remover ${member.name} da equipe?`)) return;

    const tenantId = activeTenant.id;
    try {
      if (isWaiter) await waiterV2Repository.deleteWaiter(activeTenant.id, member.userId);
      else await teamRepository.removeTeamMember(securityContext, activeTenant.id, member.id);
      if (currentTenant.current !== tenantId) return;
      setTeam(prev => prev.filter(m => m.id !== member.id)); // some da lista na hora
      showToast({
        type: 'warning',
        title: isWaiter ? 'Garçom Removido' : 'Colaborador Removido',
        message: isWaiter ? `O garçom ${member.name} foi removido da equipe.` : `${member.name} teve o acesso revogado no estabelecimento.`,
      });
      await fetchTeamData();
    } catch (err: any) {
      if (currentTenant.current !== tenantId) return;
      showToast({
        type: 'error',
        title: 'Erro ao Remover',
        message: err.message,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Equipe & Permissões da Loja</h2>
          <p className="text-xs text-gray-500">
            Organize a equipe por papel e escolha o acesso de cada área.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchTeamData()}
            className="p-2 text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors cursor-pointer"
            title="Atualizar dados"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-700' : ''}`} />
          </button>


          <Button
            variant="primary"
            onClick={() => { setFormData({ email: '', role: 'OPERATOR' as RoleId }); setWaiterMode('login'); setIsModalOpen(true); }}
            disabled={!canManage || loadedTenant !== activeTenant.id}
            leftIcon={<UserPlus className="w-4 h-4" />}
            className="shadow-xs text-xs"
            data-testid="add-team-member-btn"
          >
            Adicionar membro da equipe
          </Button>
        </div>
      </div>

      {settingsError && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{settingsError}</p>}
      <p className="text-xs text-gray-500">Garçom e Cozinha aparecem quando a ferramenta está ativa. O Dono pode ativá-las em Ferramentas.</p>
      <div role="tablist" aria-label="Funções da equipe" className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map(tab => {
          const count = tab === 'ALL' ? visibleTeam.length + visibleInvites.length
            : visibleTeam.filter(member => member.role === tab).length + visibleInvites.filter(invite => invite.roleId === tab).length;
          return <button key={tab} id={`team-tab-${tab}`} type="button" role="tab" aria-selected={selectedRole === tab}
            aria-controls="team-members-panel" tabIndex={selectedRole === tab ? 0 : -1}
            onClick={() => setRoleFilter(tab)}
            onKeyDown={event => {
              const index = tabs.indexOf(tab);
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
              if (next === null) return;
              event.preventDefault(); setRoleFilter(tabs[next]);
              document.getElementById(`team-tab-${tabs[next]}`)?.focus();
            }}
            className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold ${selectedRole === tab ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
            {tab === 'ALL' ? 'Todos' : TAB_LABELS[tab]} ({count})
          </button>;
        })}
      </div>
      <div id="team-members-panel" role="tabpanel" aria-labelledby={`team-tab-${selectedRole}`} className="space-y-4">
      {displayedRoles.map(role => {
        const roleMembers = visibleTeam.filter(member => member.role === role);
        const roleInvites = visibleInvites.filter(invite => invite.roleId === role);
        const rolePermissions = loadedTenant === activeTenant.id ? permissions.filter(permission => permission.role === role) : [];
        return <section key={role} className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50/40 p-4" data-testid={`team-role-${role}`}>
          <h3 className="text-sm font-bold text-gray-900">{TEAM_ROLE_LABELS[role]} ({roleMembers.length + roleInvites.length})</h3>
          <p className="text-xs text-gray-500">{roleMembers.length} membros · {roleInvites.length} convites pendentes</p>
          {activeTenant.slug && <details className="text-xs"><summary className="cursor-pointer font-semibold text-emerald-800">QR e link de acesso: {TEAM_ROLE_LABELS[role]}</summary><div className="mt-2"><TeamRoleAccessBlock slug={activeTenant.slug} role={role} /></div></details>}
          {rolePermissions.length > 0 && <details className="text-xs"><summary className="cursor-pointer font-semibold text-gray-700">Permissões de {TEAM_ROLE_LABELS[role]}</summary>
            {role === 'OWNER' && <p className="mt-2 text-gray-500">O Dono mantém acesso completo.</p>}
            {!canEditPermissions && <p className="mt-2 text-gray-500">Somente o Dono pode alterar permissões.</p>}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">{rolePermissions.map(permission => <label key={permission.permission} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-2">
              <span>{STORE_PERMISSION_LABELS[permission.permission] || permission.permission}</span>
              <input type="checkbox" role="switch" aria-label={`${STORE_PERMISSION_LABELS[permission.permission] || permission.permission}: ${TEAM_ROLE_LABELS[role]}`} checked={permission.enabled} disabled={!canEditPermissions || !canCustomizeRolePermission(role, permission.permission) || !!savingPermission} onChange={() => void togglePermission(permission)} />
            </label>)}</div>
          </details>}
          {role === 'WAITER' && <TableMoveApprovalSetting tenantId={activeTenant.id} userId={securityContext.userId} isOwner={canEditPermissions} />}


      {/* Membros Ativos */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
          <Users className="w-4 h-4 text-emerald-700" />
          Membros ativos ({roleMembers.length})
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roleMembers.map((member) => (
            <Card key={member.id} className="p-4 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    {directory?.get(member.userId)?.photoUrl
                      ? <img src={directory.get(member.userId)!.photoUrl!} alt={`Foto de ${member.name}`} className="w-10 h-10 rounded-xl object-cover" />
                      : <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold text-sm border border-emerald-200">
                          {directory?.get(member.userId)?.username ? initials(member.name) : member.name.substring(0, 2).toUpperCase()}
                        </div>}
                    <div>
                      <h4 className="font-bold text-xs text-gray-900 leading-snug">{member.name}</h4>
                      <Badge variant={member.role === 'OWNER' ? 'brand' : 'neutral'} size="sm">
                        {TEAM_ROLE_LABELS[member.role] || member.role}
                      </Badge>
                    </div>
                  </div>

                  {canManage && member.role !== 'OWNER' && (
                    <button
                      type="button"
                      onClick={() => handleRemove(member)}
                      className="text-gray-400 hover:text-rose-600 p-1 rounded-lg cursor-pointer transition-colors"
                      title="Remover Acesso"
                      aria-label={`Remover ${member.name} da equipe`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="space-y-1 text-xs text-gray-600 pt-1 border-t border-gray-100">
                  {directory?.get(member.userId)?.username
                    ? (
                      <div className="flex items-center gap-1.5 truncate" data-testid="waiter-username">
                        <AtSign className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="truncate font-mono">{directory.get(member.userId)!.username}</span>
                      </div>
                    )
                    : (
                      <div className="flex items-center gap-1.5 truncate">
                        <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="truncate">{member.email || 'Sem e-mail'}</span>
                      </div>
                    )}
                  {directory?.get(member.userId)?.username && member.email && (
                    <div className="flex items-center gap-1.5 truncate"><Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="truncate">{member.email}</span></div>
                  )}
                  {member.phone && (
                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                      <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span>{member.phone}</span>
                    </div>
                  )}
                </div>
              </div>

              {canManage && directory?.get(member.userId)?.username && (
                <div className="flex flex-wrap gap-1.5" data-testid="waiter-actions">
                  {(() => {
                    const d = directory.get(member.userId)!;
                    const btn = 'inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-bold text-gray-700 hover:bg-gray-50';
                    return (
                      <>
                        <button type="button" className={btn} onClick={() => setEditWaiter(d)}><Pencil className="h-3 w-3" />Editar</button>
                        <button type="button" className={btn} onClick={() => setResetWaiter(d)}><KeyRound className="h-3 w-3" />Redefinir senha</button>
                        {d.waiterActive === false
                          ? <button type="button" className={btn} onClick={() => waiterAction(member, () => waiterV2Repository.setActive(activeTenant.id, d.userId, true), { title: 'Garçom reativado', message: `${d.name} já pode entrar de novo.` })}><Power className="h-3 w-3" />Reativar</button>
                          : <button type="button" className={btn} onClick={() => waiterAction(member, () => waiterV2Repository.setActive(activeTenant.id, d.userId, false), { title: 'Garçom desativado', message: `${d.name} não consegue mais entrar e as mesas dele foram liberadas.` })}><Power className="h-3 w-3" />Desativar</button>}
                      </>
                    );
                  })()}
                </div>
              )}

              <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
                <span className="flex items-center gap-1.5">
                  <TeamMemberStatusBadge status={member.status} />
                  {directory?.get(member.userId)?.waiterActive === false && <Badge variant="warning" size="sm">Desativado</Badge>}
                  {member.role === 'DRIVER' && member.status === 'PENDING' && <span>Aprovar em Entregadores</span>}
                </span>
                <span className="font-mono">Desde {member.createdAt ? member.createdAt.split('T')[0] : 'N/A'}</span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Convites Pendentes */}
      {roleInvites.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-gray-200">
          <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            Convites pendentes ({roleInvites.length})
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roleInvites.map((invite) => (
              <Card key={invite.id} className="p-4 border-amber-200 bg-amber-50/20 flex flex-col justify-between space-y-3">
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[11px] font-mono text-gray-500">Convite para:</span>
                      <h4 className="font-bold text-xs text-gray-900 truncate">{maskTeamInviteEmail(invite.email)}</h4>
                      <Badge variant="warning" size="sm" className="mt-1">
                        Convite pendente
                      </Badge>
                    </div>
                  </div>

                  <div className="text-[11px] text-gray-500 pt-1 border-t border-amber-100">
                    Expira em: <strong className="font-mono">{new Date(invite.expiresAt).toLocaleDateString('pt-BR')}</strong>
                  </div>
                </div>

                <div className="pt-2 border-t border-amber-100 text-[10px] text-gray-400">
                  Aguardando o usuário criar conta ou autenticar com este e-mail.
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void handleResendInvite(invite)} disabled={!canManage || !!resendingInvite}
                    title="Renovar convite e compartilhar o link" className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-800 disabled:opacity-50">
                    <Send className="w-3.5 h-3.5" />{resendingInvite === invite.id ? 'Renovando…' : 'Reenviar'}
                  </button>
                  <button type="button" onClick={() => void handleRevokeInvite(invite)} disabled={!canManage || !!resendingInvite}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50">
                    <XCircle className="w-3.5 h-3.5" />Cancelar
                  </button>
                </div>
                {activeTenant.slug && <details><summary className="cursor-pointer text-xs font-semibold text-emerald-800">QR e link do convite</summary><div className="mt-2"><TeamRoleAccessBlock slug={activeTenant.slug} role={invite.roleId} /></div></details>}
              </Card>
            ))}
          </div>
        </div>
      )}

        </section>;
      })}
      </div>

      {/* Modal Convidar */}
      <Modal
        isOpen={isModalOpen && loadedTenant === activeTenant.id}
        onClose={() => setIsModalOpen(false)}
        title="Adicionar membro da equipe"
        description="Escolha o papel e convide pelo e-mail. Garçons também podem ser cadastrados com usuário e senha."
        size="md"
      >
        <form
          onSubmit={(e) => {
            if (loadedTenant !== activeTenant.id || !canManage) { e.preventDefault(); return; }
            if (formData.role === 'WAITER' && waiterMode === 'login' && tools.waiter) {
              e.preventDefault();
              setIsModalOpen(false);
              setCreateWaiterOpen(true);
              return;
            }
            void handleInvite(e);
          }}
          className="space-y-4 text-xs"
        >
          {(formData.role !== 'WAITER' || waiterMode === 'invite') && (
            <Input
              label="E-mail do Colaborador *"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="colaborador@adega.com"
              required
            />
          )}

          <div>
            <label htmlFor="team-role" className="font-semibold text-gray-700 block mb-1">Tipo de membro *</label>
            <select
              id="team-role"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as RoleId })}
              className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-emerald-600"
              required
              data-testid="team-role-select"
            >
              {roleList.filter(role => role !== 'OWNER').map(role => <option key={role} value={role}>{TEAM_ROLE_LABELS[role]}{role === 'WAITER' ? ' (atendimento do salão)' : ''}</option>)}
            </select>
            {formData.role === 'WAITER' && <div className="mt-3"><label className="block font-semibold text-gray-700" htmlFor="waiter-member-mode">Forma de acesso</label><select id="waiter-member-mode" value={waiterMode} onChange={event => setWaiterMode(event.target.value as 'login' | 'invite')} className="mt-1 w-full rounded-xl border p-2.5"><option value="login">Cadastrar com usuário e senha</option><option value="invite">Convidar por e-mail</option></select></div>}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting}
              leftIcon={<Send className="w-3.5 h-3.5" />}
            >
              {isSubmitting ? 'Emitindo Convite...' : (formData.role === 'WAITER' && waiterMode === 'login' ? 'Continuar' : 'Enviar Convite')}
            </Button>
          </div>
        </form>
      </Modal>

      <CreateWaiterModal
        isOpen={createWaiterOpen && loadedTenant === activeTenant.id}
        onClose={() => setCreateWaiterOpen(false)}
        tenantId={activeTenant.id}
        storeSlug={activeTenant.slug}
        onDone={({ username }) => {
          if (currentTenant.current !== activeTenant.id) return;
          setCreateWaiterOpen(false);
          setStoreAccess({ username });
          showToast({ type: 'success', title: 'Garçom cadastrado', message: `Usuário "${username}" criado. Mostre o QR da loja ou envie o link.` });
          void fetchTeamData();
        }}
      />
      <EditWaiterModal member={loadedTenant === activeTenant.id ? editWaiter : null} onClose={() => setEditWaiter(null)} tenantId={activeTenant.id} onDone={() => { if (currentTenant.current !== activeTenant.id) return; setEditWaiter(null); showToast({ type: 'success', title: 'Garçom atualizado', message: 'Dados salvos.' }); void fetchTeamData(); }} />
      <ResetWaiterPasswordModal member={loadedTenant === activeTenant.id ? resetWaiter : null} onClose={() => setResetWaiter(null)} tenantId={activeTenant.id} onDone={() => { if (currentTenant.current !== activeTenant.id) return; setResetWaiter(null); showToast({ type: 'success', title: 'Senha redefinida', message: 'Passe a nova senha ao garçom pessoalmente.' }); }} />
      <Modal isOpen={!!storeAccess && loadedTenant === activeTenant.id} onClose={() => setStoreAccess(null)} title="Acesso único do garçom" description="Um QR fixo da loja: o garçom entra com usuário e senha." size="lg">
        {storeAccess && <WaiterAccessBlock storeName={activeTenant?.name} slug={activeTenant.slug} username={storeAccess.username} />}
      </Modal>

      <Modal isOpen={!!inviteShare && loadedTenant === activeTenant.id} onClose={() => setInviteShare(null)} title="Compartilhar convite" description="Nenhum e-mail é enviado automaticamente. Mostre o QR ou envie o link ao colaborador." size="lg">
        {inviteShare && <p className="mb-3 text-xs text-gray-600">Convite para {inviteShare.email}</p>}
        {inviteShare && activeTenant.slug && <TeamRoleAccessBlock slug={activeTenant.slug} role={inviteShare.role} />}
      </Modal>
    </div>
  );
};

