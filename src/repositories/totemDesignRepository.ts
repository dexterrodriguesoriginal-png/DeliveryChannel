import { announceThemeSaved } from '../lib/theme/themeLiveUpdate';
import { supabase } from '../lib/supabase';
import { requireBackend } from '../lib/backend';
import type { SecurityContext } from '../services/securityEngine';
import { canManageMenuTheme } from './menuThemeRepository';
import { isValidTotemDesign, normalizeTotemDesign, type TotemDesign } from '../lib/menu/totemDesign';

function authorize(context: SecurityContext, tenantId: string): void {
  if (!canManageMenuTheme(context, tenantId)) {
    throw new Error('Apenas o dono ou gerente desta loja pode editar o design do totem.');
  }
  requireBackend('Design do Totem');
}

export const totemDesignRepository = {
  canManage: canManageMenuTheme,

  async load(context: SecurityContext, tenantId: string): Promise<TotemDesign> {
    authorize(context, tenantId);
    const { data, error } = await supabase.rpc('get_totem_design', { p_tenant: tenantId });
    if (error) throw new Error('Não foi possível carregar o design do totem. Tente novamente.');
    return normalizeTotemDesign(data);
  },

  async save(context: SecurityContext, tenantId: string, design: TotemDesign): Promise<TotemDesign> {
    authorize(context, tenantId);
    const clean = normalizeTotemDesign(design);
    if (!isValidTotemDesign(clean)) throw new Error('Confira as cores em hexadecimal (#RRGGBB) e o raio do banner.');
    const { data, error } = await supabase.rpc('set_totem_design', { p_tenant: tenantId, p_cfg: clean });
    if (error) throw new Error('Não foi possível salvar o design do totem. Suas alterações continuam aqui.');
    if (!isValidTotemDesign(data)) throw new Error('O servidor não confirmou o design do totem. Recarregue e tente novamente.');
    void announceThemeSaved(tenantId);
    return normalizeTotemDesign(data);
  },
};
