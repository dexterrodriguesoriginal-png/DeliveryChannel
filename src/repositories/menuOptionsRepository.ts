import { supabase } from '../lib/supabase';
import { requireBackend } from '../lib/backend';
import type { SecurityContext } from '../services/securityEngine';
import type { MenuOptions } from '../types/menuOptions';
import { isValidMenuOptions, normalizeMenuOptions } from '../lib/menu/menuOptions';
import { canManageMenuTheme } from './menuThemeRepository';

function authorize(context: SecurityContext, tenantId: string): void {
  if (!canManageMenuTheme(context, tenantId)) throw new Error('Apenas o dono ou gerente desta loja pode editar o cardápio.');
  requireBackend('Opções do Cardápio');
}

export const menuOptionsRepository = {
  async load(context: SecurityContext, tenantId: string): Promise<MenuOptions> {
    authorize(context, tenantId);
    const { data, error } = await supabase.rpc('get_menu_options', { p_tenant: tenantId });
    if (error) throw new Error('Não foi possível carregar as opções do cardápio. Tente novamente.');
    return normalizeMenuOptions(data);
  },
  async save(context: SecurityContext, tenantId: string, options: MenuOptions): Promise<MenuOptions> {
    authorize(context, tenantId);
    if (!isValidMenuOptions(options)) throw new Error('Confira o modo totem e o tempo de inatividade (30 a 300 segundos).');
    const { data, error } = await supabase.rpc('set_menu_options', { p_tenant: tenantId, p_options: options });
    if (error) throw new Error('Não foi possível salvar as opções do cardápio. Suas alterações continuam aqui.');
    if (!isValidMenuOptions(data)) throw new Error('O servidor não confirmou as opções do cardápio. Recarregue e tente novamente.');
    return normalizeMenuOptions(data);
  },
};
