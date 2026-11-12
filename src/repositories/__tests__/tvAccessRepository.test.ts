// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), adminRpc: vi.fn(), anonRpc: vi.fn(), staffRpc: vi.fn(), login: vi.fn(), logout: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.adminRpc }, supabaseUrl: 'https://test.supabase.co' }));
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); localStorage.clear();
  mocks.createClient.mockReturnValueOnce({ rpc: mocks.anonRpc }).mockReturnValue({ rpc: mocks.staffRpc, auth: { signInWithPassword: mocks.login, signOut: mocks.logout } });
  mocks.login.mockResolvedValue({ error: null }); mocks.logout.mockResolvedValue({ error: null });
});
it('separa a sessão temporária da conta do cliente que lê os dados da TV', async () => {
  const { tvAccessRepository: repository } = await import('../tvAccessRepository');
  mocks.staffRpc.mockResolvedValue({ data: { ok: true, token: 'tv-token' }, error: null });
  expect(await repository.activateAsStaff('loja', 'TV', 'dono@loja.com', 'senha')).toBe('tv-token');
  expect(mocks.logout).toHaveBeenCalledWith({ scope: 'local' });
  expect(localStorage.getItem('dc.tv.device.v1')).toBe('tv-token');
  expect(localStorage.length).toBe(1);
  mocks.anonRpc.mockResolvedValue({ data: { ok: true, entries: [] }, error: null });
  await repository.read('tv-token');
  expect(mocks.anonRpc).toHaveBeenCalledWith('tv_read', { p_token: 'tv-token' });
  expect(mocks.staffRpc).toHaveBeenCalledTimes(1);
  for (const call of mocks.createClient.mock.calls) expect(call[2].auth).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
});
it('encerra a sessão temporária mesmo se o backend recusar o perfil', async () => {
  const { tvAccessRepository: repository } = await import('../tvAccessRepository');
  mocks.staffRpc.mockResolvedValue({ error: { message: 'FORBIDDEN' } });
  await expect(repository.activateAsStaff('outra', 'TV', 'dono@loja.com', 'senha')).rejects.toThrow('Somente o dono ou gerente');
  expect(mocks.logout).toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});
it('pareia e guarda só o token de dispositivo no navegador', async () => {
  const { tvAccessRepository: repository } = await import('../tvAccessRepository');
  mocks.anonRpc.mockResolvedValue({ data: { ok: true, token: 'token-tv' }, error: null });
  await repository.pair('123456');
  expect(repository.readToken()).toBe('token-tv');
  expect(localStorage.length).toBe(1);
  expect(mocks.anonRpc).toHaveBeenCalledWith('tv_pair', { p_code: '123456' });
  repository.clearToken(); expect(repository.readToken()).toBeNull();
});
it('distingue bloqueio de pareamento e falha de rede sem armazenar credenciais', async () => {
  const { tvAccessRepository: repository } = await import('../tvAccessRepository');
  mocks.anonRpc.mockResolvedValueOnce({ data: { ok: false, reason: 'RATE_LIMITED' } });
  await expect(repository.pair('123456')).rejects.toThrow('5 tentativas');
  mocks.anonRpc.mockResolvedValueOnce({ error: { message: 'offline' } });
  await expect(repository.read('token')).rejects.toThrow('Sem conexão');
  expect(localStorage.length).toBe(0);
});
