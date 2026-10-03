import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { teamRepository } from '../../repositories/teamRepository';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { TeamMember, TeamInvite, RoleId } from '../../types';
import { Users, UserPlus, Trash2, Mail, Phone, Clock, RefreshCw, XCircle, Send } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export const TeamPage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  const { showToast } = useToast();

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<TeamInvite[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    role: 'OPERATOR' as RoleId,
  });

  const fetchTeamData = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    try {
      const [members, invites] = await Promise.all([
        teamRepository.listTeamMembers(securityContext, activeTenant.id),
        teamRepository.listPendingInvites(securityContext, activeTenant.id),
      ]);
      setTeam(members);
      setPendingInvites(invites);
    } catch (err) {
      console.warn('[TeamPage] Erro ao carregar equipe do Supabase:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, securityContext]);

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  if (!activeTenant) return null;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email) {
      showToast({
        type: 'error',
        title: 'Preencha os campos',
        message: 'O e-mail é obrigatório para o convite formal.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await teamRepository.createInvite(
        securityContext,
        activeTenant.id,
        formData.email.trim(),
        formData.role
      );

      showToast({
        type: 'success',
        title: 'Convite Enviado com Sucesso',
        message: `Convite enviado para ${formData.email} com papel de ${formData.role}.`,
      });

      setIsModalOpen(false);
      setFormData({ email: '', role: 'OPERATOR' });
      await fetchTeamData();
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Convidar',
        message: err.message || 'Falha ao processar convite.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevokeInvite = async (invite: TeamInvite) => {
    try {
      await teamRepository.revokeInvite(securityContext, activeTenant.id, invite.id);
      showToast({
        type: 'success',
        title: 'Convite Revogado',
        message: `O convite para ${invite.email} foi cancelado.`,
      });
      await fetchTeamData();
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Revogar',
        message: err.message,
      });
    }
  };

  const handleRemove = async (member: TeamMember) => {
    if (member.role === 'OWNER') {
      showToast({
        type: 'error',
        title: 'Ação Não Permitida',
        message: 'O proprietário da loja não pode ser removido da equipe.',
      });
      return;
    }

    if (!window.confirm(`Tem certeza que deseja remover ${member.name} da equipe?`)) return;

    try {
      await teamRepository.removeTeamMember(securityContext, activeTenant.id, member.id);
      showToast({
        type: 'warning',
        title: 'Colaborador Removido',
        message: `${member.name} teve o acesso revogado no estabelecimento.`,
      });
      await fetchTeamData();
    } catch (err: any) {
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
            Gerencie gerentes, caixas, operadores, motoboys e níveis de acesso (RBAC) com vínculo seguro
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
            onClick={() => setIsModalOpen(true)}
            leftIcon={<UserPlus className="w-4 h-4" />}
            className="shadow-xs text-xs"
          >
            + Convidar Colaborador
          </Button>
        </div>
      </div>

      {/* Membros Ativos */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
          <Users className="w-4 h-4 text-emerald-700" />
          Colaboradores Ativos ({team.length})
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {team.map((member) => (
            <Card key={member.id} className="p-4 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold text-sm border border-emerald-200">
                      {member.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-gray-900 leading-snug">{member.name}</h4>
                      <Badge variant={member.role === 'OWNER' ? 'brand' : 'neutral'} size="sm">
                        {member.role}
                      </Badge>
                    </div>
                  </div>

                  {member.role !== 'OWNER' && (
                    <button
                      type="button"
                      onClick={() => handleRemove(member)}
                      className="text-gray-400 hover:text-rose-600 p-1 rounded-lg cursor-pointer transition-colors"
                      title="Remover Acesso"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="space-y-1 text-xs text-gray-600 pt-1 border-t border-gray-100">
                  <div className="flex items-center gap-1.5 truncate">
                    <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="truncate">{member.email || 'Sem e-mail'}</span>
                  </div>
                  {member.phone && (
                    <div className="flex items-center gap-1.5 font-mono text-[11px]">
                      <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span>{member.phone}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
                <span>Status: <strong className="text-emerald-700">{member.status}</strong></span>
                <span className="font-mono">Desde {member.createdAt ? member.createdAt.split('T')[0] : 'N/A'}</span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Convites Pendentes */}
      {pendingInvites.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-gray-200">
          <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            Convites Pendentes ({pendingInvites.length})
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pendingInvites.map((invite) => (
              <Card key={invite.id} className="p-4 border-amber-200 bg-amber-50/20 flex flex-col justify-between space-y-3">
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[11px] font-mono text-gray-500">Convite para:</span>
                      <h4 className="font-bold text-xs text-gray-900 truncate">{invite.email}</h4>
                      <Badge variant="warning" size="sm" className="mt-1">
                        Cargo: {invite.roleId}
                      </Badge>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRevokeInvite(invite)}
                      className="text-gray-400 hover:text-rose-600 p-1 rounded-lg cursor-pointer transition-colors"
                      title="Cancelar Convite"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="text-[11px] text-gray-500 pt-1 border-t border-amber-100">
                    Expira em: <strong className="font-mono">{new Date(invite.expiresAt).toLocaleDateString('pt-BR')}</strong>
                  </div>
                </div>

                <div className="pt-2 border-t border-amber-100 text-[10px] text-gray-400">
                  Aguardando o usuário criar conta ou autenticar com este e-mail.
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Modal Convidar */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Convidar Colaborador para a Equipe"
        description="O colaborador receberá um convite formal. Quando ele criar a conta com este e-mail, o vínculo com a loja será ativado com o papel escolhido."
        size="md"
      >
        <form onSubmit={handleInvite} className="space-y-4 text-xs">
          <Input
            label="E-mail do Colaborador *"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="colaborador@adega.com"
            required
          />

          <div>
            <label className="font-semibold text-gray-700 block mb-1">Papel & Nível de Permissão (RBAC) *</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as RoleId })}
              className="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs outline-none focus:border-emerald-600"
              required
            >
              <option value="MANAGER">Gerente Operacional (Operações, cardápio, relatórios)</option>
              <option value="CASHIER">Operador de Caixa (Frente de caixa e pedidos)</option>
              <option value="OPERATOR">Operador de Loja (Separação e estoque)</option>
              <option value="DELIVERY_MANAGER">Coordenador de Entregas (Despacho de motoboys)</option>
              <option value="DRIVER">Entregador / Motorista (Acesso a entregas atribuídas)</option>
            </select>
            <p className="text-[10px] text-gray-400 mt-1">
              * Conforme a arquitetura de segurança, convites para OWNER, CEO e SUPER_ADMIN são bloqueados pelo banco.
            </p>
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
              {isSubmitting ? 'Emitindo Convite...' : 'Enviar Convite'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
