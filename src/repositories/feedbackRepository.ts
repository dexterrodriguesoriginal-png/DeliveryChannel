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
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error('Não foi possível verificar sua sessão.');
    const token = data.session?.access_token;
    const response = await fetch(
      `/api/store-feedback/${encodeURIComponent(slug)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'Não foi possível enviar seu relato.');
    }
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
