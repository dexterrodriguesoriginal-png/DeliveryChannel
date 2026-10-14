import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const maybeSingle = vi.fn();
const fromTables: string[] = [];
vi.mock('../../lib/supabase', () => {
  const chain: any = { select: () => chain, eq: () => chain, gte: async () => ({ data: [{ driver_id: 'u-1' }, { driver_id: 'u-1' }], error: null }), maybeSingle: () => maybeSingle() };
  return { supabase: { rpc: (...a: any[]) => rpc(...a), from: (t: string) => { fromTables.push(t); return chain; } }, isSupabaseConfigured: true, ensureValidSession: async () => true };
});
import { driverInviteRepository as repo, mapDriverRpcError, mapRowToDriver, driverRepository } from '../driverRepository';

const TOKEN = 'tok_SECRETO_abc';
beforeEach(() => { rpc.mockReset(); maybeSingle.mockReset(); fromTables.length = 0; });

describe('F-D: RPCs da 0700 (mock do supabase)', () => {
  it('createInviteLink → create_driver_invite_link', async () => {
    rpc.mockResolvedValue({ data: { id: 'l1', token: TOKEN, url: `/entregador/convite/${TOKEN}`, expires_at: '2026-10-21T00:00:00Z' }, error: null });
    const r = await repo.createInviteLink('t1', 'Motoboys', 7, 5);
    expect(rpc).toHaveBeenCalledWith('create_driver_invite_link', { p_tenant_id: 't1', p_label: 'Motoboys', p_expires_days: 7, p_max_uses: 5 });
    expect(r).toEqual({ id: 'l1', token: TOKEN, url: `/entregador/convite/${TOKEN}`, expiresAt: '2026-10-21T00:00:00Z' });
  });
  it('createInviteLink usa padrões (7 dias, sem limite)', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await repo.createInviteLink('t1');
    expect(rpc).toHaveBeenCalledWith('create_driver_invite_link', { p_tenant_id: 't1', p_label: null, p_expires_days: 7, p_max_uses: null });
  });
  it('listInviteLinks mapeia state ACTIVE/EXPIRED/REVOKED', async () => {
    rpc.mockResolvedValue({ data: [
      { id: 'a', label: null, max_uses: null, uses: 0, expires_at: 'x', state: 'ACTIVE', created_at: 'c' },
      { id: 'b', label: 'L', max_uses: 3, uses: 3, expires_at: 'x', state: 'EXPIRED', created_at: 'c' },
      { id: 'c', label: null, max_uses: null, uses: 1, expires_at: 'x', state: 'REVOKED', created_at: 'c' },
    ], error: null });
    const r = await repo.listInviteLinks('t1');
    expect(rpc).toHaveBeenCalledWith('list_driver_invite_links', { p_tenant_id: 't1' });
    expect(r.map(l => l.state)).toEqual(['ACTIVE', 'EXPIRED', 'REVOKED']);
    expect(r[1].maxUses).toBe(3);
  });
  it('renew/revoke', async () => {
    rpc.mockResolvedValue({ data: { id: 'n', token: TOKEN, url: `/entregador/convite/${TOKEN}`, expires_at: 'e' }, error: null });
    await repo.renewInviteLink('l1');
    expect(rpc).toHaveBeenLastCalledWith('renew_driver_invite_link', { p_id: 'l1' });
    await repo.revokeInviteLink('l1');
    expect(rpc).toHaveBeenLastCalledWith('revoke_driver_invite_link', { p_id: 'l1' });
  });
  it('reviewApplication e setLinkStatus', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await repo.reviewApplication('d1', 'REJECT', 'doc ilegível');
    expect(rpc).toHaveBeenLastCalledWith('review_driver_application', { p_driver_id: 'd1', p_decision: 'REJECT', p_reason: 'doc ilegível' });
    await repo.reviewApplication('d1', 'APPROVE');
    expect(rpc).toHaveBeenLastCalledWith('review_driver_application', { p_driver_id: 'd1', p_decision: 'APPROVE', p_reason: null });
    for (const a of ['SUSPEND', 'REACTIVATE', 'REMOVE'] as const) {
      await repo.setLinkStatus('d1', a);
      expect(rpc).toHaveBeenLastCalledWith('set_driver_link_status', { p_driver_id: 'd1', p_action: a, p_reason: null });
    }
  });
  it('previewInvite válido e inválido', async () => {
    rpc.mockResolvedValue({ data: { valid: true, store_name: 'Loja A', store_logo: null, expires_at: 'e' }, error: null });
    expect(await repo.previewInvite(TOKEN)).toEqual({ valid: true, storeName: 'Loja A', storeLogo: null, expiresAt: 'e' });
    expect(rpc).toHaveBeenLastCalledWith('preview_driver_invite', { p_token: TOKEN });
    rpc.mockResolvedValue({ data: { valid: false }, error: null });
    expect(await repo.previewInvite(TOKEN)).toEqual({ valid: false });
  });
  it('redeemInvite repassa status/consumed', async () => {
    rpc.mockResolvedValue({ data: { status: 'PENDING', consumed: true, tenantId: 't1' }, error: null });
    expect(await repo.redeemInvite(TOKEN)).toEqual({ status: 'PENDING', consumed: true, tenantId: 't1' });
    expect(rpc).toHaveBeenLastCalledWith('redeem_driver_invite', { p_token: TOKEN });
    rpc.mockResolvedValue({ data: { status: 'REJECTED', consumed: false }, error: null });
    expect((await repo.redeemInvite(TOKEN)).consumed).toBe(false);
  });
  it('erros viram mensagens amigáveis e nunca contêm o token', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0429', message: `rate ${TOKEN}` } });
    await expect(repo.redeemInvite(TOKEN)).rejects.toThrow('Muitas tentativas. Aguarde e tente novamente.');
    await repo.redeemInvite(TOKEN).catch((e) => expect(String(e.message)).not.toContain(TOKEN));
  });
  describe('getOwnApprovalStatus via RPC get_my_driver_approval (sem fallback para APPROVED)', () => {
    const T = '00000000-0000-4000-8000-000000000001';
    it('chama só a RPC com p_tenant_id (sem user_id) e devolve o status confirmado', async () => {
      rpc.mockResolvedValue({ data: { approval_status: 'PENDING' }, error: null });
      expect(await repo.getOwnApprovalStatus(T)).toBe('PENDING');
      expect(rpc).toHaveBeenCalledWith('get_my_driver_approval', { p_tenant_id: T });
      rpc.mockResolvedValue({ data: { approval_status: 'APPROVED' }, error: null });
      expect(await repo.getOwnApprovalStatus(T)).toBe('APPROVED');
    });
    it('NONE confirmado pelo servidor', async () => {
      rpc.mockResolvedValue({ data: { approval_status: 'NONE' }, error: null });
      expect(await repo.getOwnApprovalStatus(T)).toBe('NONE');
    });
    it('erro de RPC (inclui RPC ausente antes da 0700) → UNAVAILABLE', async () => {
      rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
      expect(await repo.getOwnApprovalStatus(T)).toBe('UNAVAILABLE');
      rpc.mockRejectedValue(new Error('network'));
      expect(await repo.getOwnApprovalStatus(T)).toBe('UNAVAILABLE');
    });
    it('coluna/campo ausente → UNAVAILABLE', async () => {
      rpc.mockResolvedValue({ data: {}, error: null });
      expect(await repo.getOwnApprovalStatus(T)).toBe('UNAVAILABLE');
    });
    it('null → UNAVAILABLE', async () => {
      rpc.mockResolvedValue({ data: null, error: null });
      expect(await repo.getOwnApprovalStatus(T)).toBe('UNAVAILABLE');
      rpc.mockResolvedValue({ data: { approval_status: null }, error: null });
      expect(await repo.getOwnApprovalStatus(T)).toBe('UNAVAILABLE');
    });
    it('resposta inválida → UNAVAILABLE', async () => {
      for (const d of [{ approval_status: 'approved' }, { approval_status: 'X' }, 'APPROVED', [{ approval_status: 'APPROVED' }], 42]) {
        rpc.mockResolvedValue({ data: d, error: null });
        expect(await repo.getOwnApprovalStatus(T)).toBe('UNAVAILABLE');
      }
    });
    it('tenant inválido → UNAVAILABLE sem chamar a RPC', async () => {
      expect(await repo.getOwnApprovalStatus('x')).toBe('UNAVAILABLE');
      expect(rpc).not.toHaveBeenCalled();
    });
    it('nunca consulta a tabela drivers diretamente', async () => {
      rpc.mockResolvedValue({ data: { approval_status: 'APPROVED' }, error: null });
      await repo.getOwnApprovalStatus(T);
      expect(maybeSingle).not.toHaveBeenCalled();
    });
  });
  it('assignOrder mapeia P0414', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0414', message: 'x' } });
    await expect(driverRepository.assignOrder({} as any, 't', 'o', 'u')).rejects.toThrow('Entregador não aprovado.');
  });
});

describe('F-D: mapDriverRpcError', () => {
  it.each([
    ['P0410', 'Conflito de papel'], ['P0412', 'já faz parte'], ['P0413', 'convite pendente'], ['P0414', 'não aprovado'],
    ['P0416', 'inconsistente'], ['P0417', 'Transição inválida'], ['P0418', 'pedido em rota'], ['P0429', 'Muitas tentativas'],
  ])('%s', (code, txt) => expect(mapDriverRpcError({ code })).toContain(txt));
  it('função inexistente → Recurso ainda não disponível', () => {
    expect(mapDriverRpcError({ code: 'PGRST202', message: 'Could not find the function' })).toBe('Recurso ainda não disponível.');
    expect(mapDriverRpcError({ code: '42883' })).toBe('Recurso ainda não disponível.');
  });
});

describe('F-D: approval_status no Driver', () => {
  it('lê approval_status; coluna ausente, null ou inválido → UNKNOWN (nunca APPROVED)', () => {
    expect(mapRowToDriver({ id: 'd', status: 'UNAVAILABLE', approval_status: 'PENDING' }).approvalStatus).toBe('PENDING');
    expect(mapRowToDriver({ id: 'd', status: 'AVAILABLE' }).approvalStatus).toBe('UNKNOWN');
    expect(mapRowToDriver({ id: 'd', status: 'AVAILABLE', approval_status: null }).approvalStatus).toBe('UNKNOWN');
    expect(mapRowToDriver({ id: 'd', status: 'AVAILABLE', approval_status: 'OK' }).approvalStatus).toBe('UNKNOWN');
  });
});

describe('v3.3: listDrivers via RPC list_tenant_drivers (sem SELECT em drivers)', () => {
  const T = '00000000-0000-4000-8000-000000000001';
  it('chama a RPC com p_tenant_id, mapeia e nunca lê a tabela drivers', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'd1', user_id: 'u-1', full_name: 'Zé', phone: '11', vehicle_type: 'MOTO', vehicle_model: 'CG', vehicle_plate: 'ABC', status: 'AVAILABLE', approval_status: 'APPROVED', created_at: 'c', updated_at: 'u' }], error: null });
    const list = await driverRepository.listDrivers({} as any, T);
    expect(rpc).toHaveBeenCalledWith('list_tenant_drivers', { p_tenant_id: T });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'd1', userId: 'u-1', tenantId: T, name: 'Zé', approvalStatus: 'APPROVED', completedDeliveriesToday: 2 });
    expect(fromTables).not.toContain('drivers');
  });
  it('approval_status ausente/inválido na resposta → UNKNOWN (sem fallback)', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'd1', user_id: 'u', full_name: 'Zé', status: 'AVAILABLE' }, { id: 'd2', user_id: 'v', full_name: 'Y', status: 'AVAILABLE', approval_status: 'ok' }], error: null });
    const list = await driverRepository.listDrivers({} as any, T);
    expect(list.map(d => d.approvalStatus)).toEqual(['UNKNOWN', 'UNKNOWN']);
  });
  it('negado (42501) ou RPC ausente → erro amigável, sem dados locais/falsos', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Permissão negada.' } });
    await expect(driverRepository.listDrivers({} as any, T)).rejects.toThrow('Sem permissão para esta ação.');
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(driverRepository.listDrivers({} as any, T)).rejects.toThrow('Recurso ainda não disponível.');
  });
  it('resposta null → lista vazia', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await driverRepository.listDrivers({} as any, T)).toEqual([]);
  });
});

describe('0700 v3.4: listAssignableDrivers via list_assignable_drivers', () => {
  const T = '00000000-0000-4000-8000-000000000001';
  it('chama só a RPC (sem SELECT em tabelas) e mapeia id = driver_user_id', async () => {
    rpc.mockResolvedValue({ data: [{ driver_user_id: 'u-9', display_name: 'Ana', availability: 'AVAILABLE', approval_status: 'APPROVED' }], error: null });
    const r = await repo.listAssignableDrivers(T);
    expect(rpc).toHaveBeenCalledWith('list_assignable_drivers', { p_tenant_id: T });
    expect(fromTables).toEqual([]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'u-9', userId: 'u-9', name: 'Ana', status: 'AVAILABLE', approvalStatus: 'APPROVED', isOnline: true });
  });
  it('não chama list_tenant_drivers', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await repo.listAssignableDrivers(T);
    expect(rpc).not.toHaveBeenCalledWith('list_tenant_drivers', expect.anything());
  });
  it('42501 propaga como "Sem permissão" (sem fallback)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Permissão negada.' } });
    await expect(repo.listAssignableDrivers(T)).rejects.toThrow();
  });
  it('tenant inválido não chama RPC', async () => {
    expect(await repo.listAssignableDrivers('x')).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('approval ausente vira UNKNOWN (não atribuível)', async () => {
    rpc.mockResolvedValue({ data: [{ driver_user_id: 'u-1', display_name: 'B', availability: 'AVAILABLE' }], error: null });
    expect((await repo.listAssignableDrivers(T))[0].approvalStatus).toBe('UNKNOWN');
  });
});
