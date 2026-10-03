import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { TeamMember, TeamInvite, RoleId } from '../types';
import { SecurityContext } from '../services/securityEngine';
import { isValidUuid } from '../lib/uuid';

function mapRowToTeamMember(row: any): TeamMember {
  const userObj = row.users || {};
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    name: userObj.name || 'Colaborador',
    email: userObj.email || '',
    phone: userObj.phone || undefined,
    role: row.role_id as RoleId,
    status: (row.status === 'ACTIVE' ? 'ACTIVE' : row.status === 'INVITED' ? 'INVITED' : 'INACTIVE'),
    createdAt: row.created_at || new Date().toISOString(),
  };
}

function mapRowToTeamInvite(row: any): TeamInvite {
  const inviter = row.inviter || {};
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    roleId: row.role_id as RoleId,
    invitedBy: row.invited_by,
    invitedByName: inviter.name || undefined,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at || undefined,
    acceptedBy: row.accepted_by || undefined,
  };
}

export const teamRepository = {
  /**
   * Lista todos os membros com vínculo ao tenant (public.tenant_users)
   */
  async listTeamMembers(context: SecurityContext, tenantId: string): Promise<TeamMember[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('tenant_users')
          .select('id, tenant_id, user_id, role_id, status, created_at, users:user_id(name, email, phone)')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: true });

        if (error) {
          console.warn('[teamRepository] Erro ao listar membros no Supabase:', error);
          return [];
        }

        if (data) {
          return data.map(mapRowToTeamMember);
        }
      } catch (err) {
        console.warn('[teamRepository] Falha ao consultar membros no Supabase:', err);
      }
    }
    return [];
  },

  /**
   * Lista os convites pendentes do tenant (public.team_invites)
   */
  async listPendingInvites(context: SecurityContext, tenantId: string): Promise<TeamInvite[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('team_invites')
          .select('*, inviter:invited_by(name)')
          .eq('tenant_id', tenantId)
          .eq('status', 'PENDING')
          .order('created_at', { ascending: false });

        if (error) {
          console.warn('[teamRepository] Erro ao listar convites no Supabase:', error);
          return [];
        }

        if (data) {
          return data.map(mapRowToTeamInvite);
        }
      } catch (err) {
        console.warn('[teamRepository] Falha ao consultar convites no Supabase:', err);
      }
    }
    return [];
  },

  /**
   * Cria um convite formal de equipe via RPC create_team_invite
   */
  async createInvite(
    context: SecurityContext, 
    tenantId: string, 
    email: string, 
    roleId: RoleId
  ): Promise<TeamInvite> {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.rpc('create_team_invite', {
        p_tenant_id: tenantId,
        p_email: email,
        p_role_id: roleId,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data && data.inviteId) {
        return {
          id: data.inviteId,
          tenantId,
          email: data.email,
          roleId: data.roleId as RoleId,
          invitedBy: context.userId,
          status: 'PENDING',
          expiresAt: data.expiresAt,
          createdAt: new Date().toISOString(),
        };
      }
    }
    throw new Error('Supabase não configurado para criar convites.');
  },

  /**
   * Revoga um convite pendente via RPC revoke_team_invite
   */
  async revokeInvite(context: SecurityContext, tenantId: string, inviteId: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('revoke_team_invite', {
        p_invite_id: inviteId,
      });

      if (error) {
        throw new Error(error.message);
      }
      return;
    }
    throw new Error('Supabase não configurado para revogar convites.');
  },

  /**
   * Remove ou inativa o vínculo de um membro da equipe via RPC remove_team_member
   */
  async removeTeamMember(context: SecurityContext, tenantId: string, memberId: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('remove_team_member', {
        p_tenant_user_id: memberId,
      });

      if (error) {
        throw new Error(error.message);
      }
      return;
    }
    throw new Error('Supabase não configurado para remover membros.');
  },

  /**
   * Aceita um convite de equipe via RPC accept_team_invite
   */
  async acceptInvite(inviteId: string): Promise<{ success: boolean; tenantId: string; roleId: string }> {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.rpc('accept_team_invite', {
        p_invite_id: inviteId,
      });

      if (error) {
        throw new Error(error.message);
      }
      return data;
    }
    throw new Error('Supabase não configurado para aceitar convite.');
  },

  /**
   * Lista convites pendentes recebidos pelo usuário autenticado (via e-mail da sessão)
   */
  async listMyReceivedInvites(): Promise<Array<TeamInvite & { tenantName?: string }>> {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('team_invites')
        .select('*, tenant:tenant_id(name, slug), inviter:invited_by(name)')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[teamRepository] Erro ao buscar convites recebidos:', error);
        return [];
      }

      if (data) {
        return data.map((row: any) => ({
          ...mapRowToTeamInvite(row),
          tenantName: row.tenant?.name || 'Estabelecimento Parceiro',
        }));
      }
    }
    return [];
  }
};
