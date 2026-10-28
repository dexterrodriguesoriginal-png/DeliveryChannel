import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
const invokeMock = vi.fn();
const setSessionMock = vi.fn();
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a), functions: { invoke: (...a: unknown[]) => invokeMock(...a) }, auth: { setSession: (...a: unknown[]) => setSessionMock(...a) } },
  isSupabaseConfigured: true,
}));

import { WaiterAdminError, mapReportRow, mapRosterRow, waiterRpcMessage, waiterV2Repository } from '../waiterV2Repository';

beforeEach(() => { rpcMock.mockReset(); invokeMock.mockReset(); setSessionMock.mockReset(); });

describe('waiterV2Repository', () => {
  it('available() é falso quando a migration não existe (nunca lança)', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(waiterV2Repository.available()).resolves.toBe(false);
    rpcMock.mockRejectedValueOnce(new Error('rede'));
    await expect(waiterV2Repository.available()).resolves.toBe(false);
    rpcMock.mockResolvedValueOnce({ data: { version: 1 }, error: null });
    await expect(waiterV2Repository.available()).resolves.toBe(true);
  });

  it('login por usuário chama a Edge Function e instala a sessão (sem expor a senha em outro lugar)', async () => {
    invokeMock.mockResolvedValueOnce({ data: { ok: true, session: { access_token: 'a', refresh_token: 'r' } }, error: null });
    setSessionMock.mockResolvedValueOnce({ error: null });
    await waiterV2Repository.loginWithUsername('adega-a', 'joao', 'segredo1');
    expect(invokeMock).toHaveBeenCalledWith('waiter-login', { body: { slug: 'adega-a', username: 'joao', password: 'segredo1' } });
    expect(setSessionMock).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
  });

  it('login recusado lança mensagem do servidor (429 também)', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ code: 'RATE_LIMITED', message: 'Muitas tentativas.' }) } } });
    await expect(waiterV2Repository.loginWithUsername('a', 'joao', '123456')).rejects.toMatchObject({ code: 'RATE_LIMITED', message: 'Muitas tentativas.' });
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('usuário desativado vem com canReactivate para oferecer "Reativar"', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ ok: false, code: 'USERNAME_INACTIVE', message: 'já existe, desativado', canReactivate: true, userId: 'u1' }) } } });
    const err = await waiterV2Repository.createWaiter({ tenantId: 't', name: 'João', phone: '11999990000', username: 'joao', password: '123456' }).catch(e => e);
    expect(err).toBeInstanceOf(WaiterAdminError);
    expect(err).toMatchObject({ code: 'USERNAME_INACTIVE', canReactivate: true, userId: 'u1' });
  });

  it('ações de admin enviam tenant, usuário e ação — a senha só vai no corpo da chamada', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    await waiterV2Repository.resetPassword('t1', 'u1', 'novasenha');
    expect(invokeMock).toHaveBeenCalledWith('waiter-admin', { body: { action: 'reset_password', tenantId: 't1', userId: 'u1', password: 'novasenha' } });
    await waiterV2Repository.setActive('t1', 'u1', false);
    expect(invokeMock).toHaveBeenLastCalledWith('waiter-admin', { body: { action: 'set_active', tenantId: 't1', userId: 'u1', active: false } });
    await waiterV2Repository.deleteWaiter('t1', 'u1');
    expect(invokeMock).toHaveBeenLastCalledWith('waiter-admin', { body: { action: 'delete', tenantId: 't1', userId: 'u1' } });
  });

  it('diretório devolve nome/telefone e null quando a migration não existe', async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ id: '1', user_id: 'u', role_id: 'WAITER', status: 'ACTIVE', created_at: 'x', name: 'João', email: '', phone: '11999990000', username: 'joao', photo_url: null, waiter_active: true }], error: null });
    const list = await waiterV2Repository.directory('t');
    expect(list?.[0]).toMatchObject({ name: 'João', phone: '11999990000', username: 'joao', email: '' });
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: '42883', message: 'function does not exist' } });
    await expect(waiterV2Repository.directory('t')).resolves.toBeNull();
  });

  it('"Vou atender" repassa erro de chamado já assumido com texto claro', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: 'P0409', message: 'WAITER_CALL_TAKEN: outro garçom já assumiu este chamado.' } });
    await expect(waiterV2Repository.acceptCall('c1')).rejects.toThrow('outro garçom já assumiu este chamado.');
    expect(rpcMock).toHaveBeenCalledWith('accept_waiter_call', { p_call_id: 'c1' });
  });

  it('chamadas de modo/mesas/central usam os parâmetros do banco', async () => {
    rpcMock.mockResolvedValue({ data: 2, error: null });
    await waiterV2Repository.assignTables('t', 'w1', ['m1', 'm2']);
    expect(rpcMock).toHaveBeenLastCalledWith('assign_waiter_tables', { p_tenant: 't', p_waiter: 'w1', p_table_ids: ['m1', 'm2'] });
    await waiterV2Repository.dispatchCall('c', 'w2');
    expect(rpcMock).toHaveBeenLastCalledWith('dispatch_waiter_call', { p_call_id: 'c', p_waiter: 'w2' });
    await waiterV2Repository.passTables('t', 'a', 'b', null);
    expect(rpcMock).toHaveBeenLastCalledWith('pass_waiter_tables', { p_tenant: 't', p_from: 'a', p_to: 'b', p_table_ids: null });
    await waiterV2Repository.saveSettings('t', { mode: 'FIXED', hybridHelp: true, acceptTimeoutSeconds: 45, dispatchTimeoutSeconds: 30 });
    expect(rpcMock).toHaveBeenLastCalledWith('set_waiter_service_settings', { p_tenant: 't', p_mode: 'FIXED', p_hybrid_help: true, p_accept_seconds: 45, p_dispatch_seconds: 30 });
  });

  it('cliente só recebe nome e foto', async () => {
    rpcMock.mockResolvedValueOnce({ data: { name: 'João Silva', photo_url: null, phone: '999' }, error: null });
    await expect(waiterV2Repository.myTableWaiter('s')).resolves.toEqual({ name: 'João Silva', photoUrl: null });
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await expect(waiterV2Repository.myTableWaiter('s')).resolves.toBeNull();
  });

  it('mapeia relatório e roster', () => {
    expect(mapReportRow({ waiter_id: 'w', name: 'A', tabs_attended: '3', orders_count: 4, total_sold: '150.5', calls_handled: 2, avg_response_seconds: '12.3', service_fee_total: '15' }))
      .toEqual({ waiterId: 'w', name: 'A', tabsAttended: 3, ordersCount: 4, totalSold: 150.5, callsHandled: 2, avgResponseSeconds: 12.3, serviceFeeTotal: 15 });
    expect(mapReportRow({ waiter_id: 'w', name: 'A', avg_response_seconds: null }).avgResponseSeconds).toBeNull();
    expect(mapRosterRow({ user_id: 'u', name: 'B', online: true, busy: false, table_count: 2, open_calls: 1 })).toMatchObject({ userId: 'u', online: true, tableCount: 2 });
    expect(waiterRpcMessage({ code: '42501', message: 'x' })).toBe('Sem permissão para esta ação.');
  });
});
