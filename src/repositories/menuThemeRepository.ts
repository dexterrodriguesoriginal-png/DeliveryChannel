import { announceThemeSaved } from '../lib/theme/themeLiveUpdate';
import { supabase } from '../lib/supabase';
import { requireBackend } from '../lib/backend';
import type { SecurityContext } from '../services/securityEngine';
import type { MenuTheme } from '../types/menuTheme';
import { isValidMenuTheme, normalizeMenuTheme } from '../lib/theme/menuTheme';

export function canManageMenuTheme(context: SecurityContext, tenantId: string): boolean {
  return Boolean(context.userId) && context.tenantId === tenantId && ['OWNER', 'MANAGER'].includes(context.userRole);
}

function authorize(context: SecurityContext, tenantId: string): void {
  if (!canManageMenuTheme(context, tenantId)) throw new Error('Apenas o dono ou gerente desta loja pode editar o cardápio.');
  requireBackend('Design do Cardápio');
}

export const menuThemeRepository = {
  async load(context: SecurityContext, tenantId: string): Promise<MenuTheme> {
    authorize(context, tenantId);
    const { data, error } = await supabase.rpc('get_menu_theme', { p_tenant: tenantId });
    if (error) throw new Error('Não foi possível carregar o design do cardápio. Tente novamente.');
    return normalizeMenuTheme(data);
  },
  async save(context: SecurityContext, tenantId: string, theme: MenuTheme): Promise<MenuTheme> {
    authorize(context, tenantId);
    if (!isValidMenuTheme(theme)) throw new Error('Confira as cores e o estilo do cardápio antes de salvar.');
    const { data, error } = await supabase.rpc('set_menu_theme', { p_tenant: tenantId, p_theme: theme });
    if (error) throw new Error('Não foi possível salvar o design do cardápio. Suas alterações continuam aqui.');
    if (!isValidMenuTheme(data)) throw new Error('O servidor não confirmou o design do cardápio. Recarregue e tente novamente.');
    void announceThemeSaved(tenantId);
    return normalizeMenuTheme(data);
  },
};
