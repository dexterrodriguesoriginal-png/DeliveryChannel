import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ from: vi.fn(), upsert: vi.fn() }));
vi.mock('../../supabase', () => ({ supabase: { from: db.from }, isSupabaseConfigured: true }));
import { themeService } from '../../../services/themeService';
import { TEMPLATES } from '../templates';
import { tokensToTheme } from '../themeEngine';
import type { SecurityContext } from '../../../services/securityEngine';
const tenantId = '11111111-1111-4111-8111-111111111111';
const context: SecurityContext = { tenantId, userId: 'owner', userRole: 'OWNER', userName: 'Dono' };
beforeEach(() => {
  vi.clearAllMocks();
  themeService.clearCache();
  db.from.mockReturnValue({ upsert: db.upsert });
  db.upsert.mockResolvedValue({ error: null });
});
describe('persistência do modelo escolhido', () => {
  it('grava o modelo completo em tenant_themes.theme_tokens', async () => {
    const theme = tokensToTheme(TEMPLATES[37].tokens, {
      storeName: 'Minha loja',
      logoUrl: '/logo.png',
    });
    await themeService.updateTheme(context, tenantId, theme);
    expect(db.from).toHaveBeenCalledWith('tenant_themes');
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: tenantId,
        store_name: 'Minha loja',
        logo_url: '/logo.png',
        theme_tokens: TEMPLATES[37].tokens,
      }),
      { onConflict: 'tenant_id' }
    );
    expect(themeService.getTheme(context, tenantId)?.tokens?.meta?.templateId).toBe(
      TEMPLATES[37].id
    );
  });
  it('não atualiza o cache salvo se a gravação for recusada', async () => {
    const oldTheme = tokensToTheme(TEMPLATES[0].tokens, { storeName: 'Minha loja' });
    const newTheme = tokensToTheme(TEMPLATES[1].tokens, oldTheme);
    themeService.setCache(tenantId, oldTheme);
    db.upsert.mockResolvedValueOnce({ error: { message: 'Sem conexão', code: 'NETWORK_ERROR' } });
    await expect(themeService.updateTheme(context, tenantId, newTheme)).rejects.toThrow();
    expect(themeService.getTheme(context, tenantId)).toEqual(oldTheme);
  });
});
