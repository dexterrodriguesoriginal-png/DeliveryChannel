import { supabase } from '../lib/supabase';
import { LEGAL_VERSION, LegalAudience } from '../lib/legal/documents';
export const legalRepository = {
  async status(
    audience: LegalAudience,
  ): Promise<{ accepted: boolean; version: string }> {
    const { data, error } = await supabase.rpc('get_my_legal_status', {
      p_audience: audience,
    });
    if (
      error ||
      !data ||
      typeof data.accepted !== 'boolean' ||
      typeof data.version !== 'string'
    )
      throw new Error(
        'Não foi possível consultar seu aceite. Tente novamente.',
      );
    return data;
  },
  async accept(audience: LegalAudience) {
    const { error } = await supabase.rpc('accept_current_legal', {
      p_audience: audience,
      p_version: LEGAL_VERSION,
    });
    if (error)
      throw new Error(
        'Não foi possível registrar o aceite. Atualize a página e tente novamente.',
      );
  },
  async exportMyData(): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.rpc('export_my_customer_data');
    if (error || !data || typeof data !== 'object')
      throw new Error('Não foi possível baixar seus dados. Tente novamente.');
    return data;
  },
};
