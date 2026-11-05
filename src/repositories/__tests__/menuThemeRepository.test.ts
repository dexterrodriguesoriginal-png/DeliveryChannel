import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), backend: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../../lib/backend', () => ({ requireBackend: mocks.backend }));
import { canManageMenuTheme, menuThemeRepository } from '../menuThemeRepository';
import { DEFAULT_MENU_THEME } from '../../lib/theme/menuTheme';
import type { SecurityContext } from '../../services/securityEngine';
const owner = { userId: 'owner', userName: 'Dono', tenantId: 'store-a', userRole: 'OWNER' } as SecurityContext;
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: DEFAULT_MENU_THEME, error: null }); });
describe('menuThemeRepository', () => {
  it.each(['OWNER', 'MANAGER'] as const)('lê e salva pelo RPC como %s sem alterar o tema do app', async userRole => {
    const context = { ...owner, userRole };
    expect(await menuThemeRepository.load(context, 'store-a')).toEqual(DEFAULT_MENU_THEME);
    expect(await menuThemeRepository.save(context, 'store-a', { ...DEFAULT_MENU_THEME })).toEqual(DEFAULT_MENU_THEME);
    expect(mocks.rpc.mock.calls).toEqual([['get_menu_theme', { p_tenant: 'store-a' }], ['set_menu_theme', { p_tenant: 'store-a', p_theme: DEFAULT_MENU_THEME }]]);
  });
  it.each(['WAITER', 'CUSTOMER', 'CEO', 'SUPER_ADMIN'] as const)('recusa %s antes da rede', async userRole => {
    const context = { ...owner, userRole };
    expect(canManageMenuTheme(context, 'store-a')).toBe(false);
    await expect(menuThemeRepository.load(context, 'store-a')).rejects.toThrow('dono ou gerente');
    await expect(menuThemeRepository.save(context, 'store-a', { ...DEFAULT_MENU_THEME })).rejects.toThrow('dono ou gerente');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('recusa outra loja e sessão ausente', async () => {
    for (const context of [owner, { ...owner, userId: '' }]) {
      await expect(menuThemeRepository.save(context, 'store-b', { ...DEFAULT_MENU_THEME })).rejects.toThrow('dono ou gerente');
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('não usa fallback local quando o servidor falha', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'SQL interno' }, data: null });
    await expect(menuThemeRepository.load(owner, 'store-a')).rejects.toThrow('Não foi possível carregar');
    await expect(menuThemeRepository.save(owner, 'store-a', { ...DEFAULT_MENU_THEME })).rejects.toThrow('Não foi possível salvar');
  });
  it('recusa payload e confirmação de escrita inválidos', async () => {
    await expect(menuThemeRepository.save(owner, 'store-a', { ...DEFAULT_MENU_THEME, accent: 'url(secret)' })).rejects.toThrow('Confira as cores');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(menuThemeRepository.save(owner, 'store-a', { ...DEFAULT_MENU_THEME })).rejects.toThrow('servidor não confirmou');
  });
});
