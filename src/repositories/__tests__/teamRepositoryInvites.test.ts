import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const fromTables: string[] = [];
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...a: any[]) => rpc(...a), from: (t: string) => { fromTables.push(t); throw new Error('acesso direto a tabela'); } },
  isSupabaseConfigured: true,
  ensureValidSession: async () => true,
}));
import { teamRepository, mapInviteRpcRow, mapReceivedInviteRpcRow } from '../teamRepository';

const T = '20000000-0000-4000-8000-00000000000a';
const ROW = { id: 'i1', tenant_id: T, email: 'novo@example.com', role_id: 'CASHIER', invited_by: 'u1', invited_by_name: 'Dono A',
  status: 'PENDING', expires_at: '2026-10-20T00:00:00Z', created_at: '2026-10-14T00:00:00Z' };
beforeEach(() => { rpc.mockReset(); fromTables.length = 0; });

describe('0900: convites de equipe por RPC', () => {
  it('mapInviteRpcRow mapeia todos os campos e o nome de quem convidou', () => {
    expect(mapInviteRpcRow(ROW)).toEqual({ id: 'i1', tenantId: T, email: 'novo@example.com', roleId: 'CASHIER', invitedBy: 'u1',
      invitedByName: 'Dono A', status: 'PENDING', expiresAt: '2026-10-20T00:00:00Z', createdAt: '2026-10-14T00:00:00Z',
      acceptedAt: undefined, acceptedBy: undefined });
  });
  it('mapInviteRpcRow sem invited_by_name → undefined', () => {
    expect(mapInviteRpcRow({ ...ROW, invited_by_name: null }).invitedByName).toBeUndefined();
  });
  it('mapReceivedInviteRpcRow usa tenant_name e não expõe e-mail', () => {
    const r = mapReceivedInviteRpcRow({ id: 'i2', tenant_id: T, tenant_name: 'STG A', role_id: 'OPERATOR', invited_by_name: 'Dono A',
      status: 'PENDING', expires_at: 'e', created_at: 'c' });
    expect(r.tenantName).toBe('STG A'); expect(r.email).toBe(''); expect(r.invitedByName).toBe('Dono A'); expect(r.roleId).toBe('OPERATOR');
    expect(mapReceivedInviteRpcRow({ id: 'x' }).tenantName).toBe('Estabelecimento Parceiro');
  });
  it('listPendingInvites chama list_team_invites e não lê a tabela', async () => {
    rpc.mockResolvedValue({ data: [ROW], error: null });
    const r = await teamRepository.listPendingInvites({} as any, T);
    expect(rpc).toHaveBeenCalledWith('list_team_invites', { p_tenant_id: T });
    expect(r).toHaveLength(1); expect(r[0].invitedByName).toBe('Dono A'); expect(fromTables).toEqual([]);
  });
  it('listPendingInvites: erro (42501) → lista vazia; tenant inválido não chama RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Sem permissão' } });
    expect(await teamRepository.listPendingInvites({} as any, T)).toEqual([]);
    rpc.mockReset();
    expect(await teamRepository.listPendingInvites({} as any, 'nao-uuid')).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('listMyReceivedInvites chama list_my_team_invites sem parâmetros', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'i2', tenant_id: T, tenant_name: 'STG A', role_id: 'OPERATOR', status: 'PENDING' }], error: null });
    const r = await teamRepository.listMyReceivedInvites();
    expect(rpc).toHaveBeenCalledWith('list_my_team_invites');
    expect(r[0].tenantName).toBe('STG A'); expect(fromTables).toEqual([]);
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    expect(await teamRepository.listMyReceivedInvites()).toEqual([]);
  });
});
