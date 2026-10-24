import { supabase } from '../lib/supabase';
import {
  FeedbackInput,
  StoreFeedback,
  validFeedback,
  FeedbackStats,
} from '../lib/feedback/model';
export const feedbackRepository = {
  async submit(slug: string, input: FeedbackInput): Promise<void> {
    if (!validFeedback(input))
      throw new Error(
        'Confira a mensagem (10–1000 caracteres) e os campos selecionados.',
      );
    // supabase-js supplies the current JWT (or the public key for visitors).
    // Identity, tenant resolution, hashing and quota belong exclusively to the RPC.
    const { error } = await Promise.resolve(supabase.rpc('submit_store_feedback_v2', {
      p_tenant_slug_or_id: slug,
      p_type: input.type,
      p_area: input.area ?? null,
      p_rating: input.rating ?? null,
      p_message: input.message.trim(),
    })).catch(() => ({ error: { code: 'NETWORK' } }));
    if (error?.code === 'P0001')
      throw new Error('Limite diário de 5 envios por loja atingido.');
    if (error?.code === '22023')
      throw new Error('Confira os campos e se a loja está disponível.');
    if (error) throw new Error('Não foi possível enviar seu relato. Tente novamente.');
  },
  async list(
    slug: string,
    filters: {
      type?: string;
      area?: string;
      from?: string;
      to?: string;
      state?: string;
      offset?: number;
    } = {},
  ): Promise<{
    rows: StoreFeedback[];
    stats: FeedbackStats;
  }> {
    const { data, error } = await supabase.rpc('list_store_feedback', {
      p_store_slug: slug,
      p_type: filters.type || null,
      p_area: filters.area || null,
      p_from: filters.from || null,
      p_to: filters.to || null,
      p_state: filters.state || 'all',
      p_offset: filters.offset || 0,
    });
    if (error) throw new Error('Não foi possível carregar a Voz do cliente.');
    if (!data || !Array.isArray(data.rows) || !data.stats)
      throw new Error('Resposta de feedback inválida.');
    return data;
  },
  async setState(
    slug: string,
    row: StoreFeedback,
    read: boolean,
    archived: boolean,
  ) {
    const { error } = await supabase.rpc('set_store_feedback_state', {
      p_store_slug: slug,
      p_id: row.id,
      p_read: read,
      p_archived: archived,
    });
    if (error) throw new Error('Não foi possível atualizar o relato.');
  },
  async ceoCounts(): Promise<
    { store_id: string; store_name: string; total: number }[]
  > {
    const { data, error } = await supabase.rpc('ceo_store_feedback_counts');
    if (error) throw new Error('Contagens de feedback indisponíveis.');
    return data || [];
  },
};
