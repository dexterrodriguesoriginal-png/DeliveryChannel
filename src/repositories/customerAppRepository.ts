/**
 * App do cliente (P1 iFood): perfil, cupons visíveis e pedido de exclusão de conta (LGPD).
 * Cada chamada nova usa uma RPC aditiva (migration 20261018001800). Se a RPC ainda não existir no banco
 * (produção antes da migration), cai para o comportamento seguro anterior — nunca quebra a vitrine.
 */
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { isValidUuid } from '../lib/uuid';
import type { Campaign } from '../types';

export interface StoreCoupon {
  code: string;
  description?: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: number;
  minOrderValue?: number;
  maxDiscountAmount?: number;
  firstOrderOnly?: boolean;
  endsAt?: string;
  remainingUses?: number | null;
  /** 'campaign' = divulgado num card de campanha; 'personal' = cupom só seu. */
  source: 'campaign' | 'personal' | 'store';
}

/** RPC ausente (PostgREST PGRST202 / Postgres 42883) ou coluna ausente (42703). */
export function isMissingBackendFeature(err: unknown): boolean {
  const e = (err || {}) as { code?: string; message?: string };
  if (e.code === 'PGRST202' || e.code === '42883' || e.code === '42703' || e.code === 'PGRST204') return true;
  return /could not find the function|does not exist|schema cache/i.test(e.message || '');
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));

/** Cupons divulgados nos cards de campanha publicados (já são públicos via get_public_store). */
export function couponsFromCampaigns(campaigns: Campaign[]): StoreCoupon[] {
  const out = new Map<string, StoreCoupon>();
  for (const c of campaigns || []) {
    for (const card of c.cards || []) {
      const cp = card.coupon;
      if (!cp || cp.isExhausted || out.has(cp.code)) continue;
      out.set(cp.code, {
        code: cp.code,
        description: card.title || c.name,
        discountType: cp.discountType,
        discountValue: Number(cp.discountValue) || 0,
        endsAt: c.noEndDate ? undefined : c.endAt || undefined,
        remainingUses: cp.remainingUses ?? null,
        source: 'campaign',
      });
    }
  }
  return [...out.values()];
}

export const customerAppRepository = {
  /** Cupons que o cliente pode ver nesta loja. */
  async listStoreCoupons(slug: string, campaigns: Campaign[]): Promise<StoreCoupon[]> {
    const fromCampaigns = couponsFromCampaigns(campaigns);
    if (!isSupabaseConfigured || !slug) return fromCampaigns;
    const { data, error } = await supabase.rpc('list_store_coupons_for_customer', { p_tenant_slug: slug });
    if (error) {
      if (!isMissingBackendFeature(error)) console.warn('[customerApp] cupons indisponíveis:', error.message);
      return fromCampaigns;
    }
    const rows = Array.isArray(data) ? data : [];
    const merged = new Map<string, StoreCoupon>(fromCampaigns.map(c => [c.code, c]));
    for (const r of rows as Record<string, unknown>[]) {
      const code = String(r.code || '');
      if (!code) continue;
      merged.set(code, {
        code,
        description: (r.description as string) || merged.get(code)?.description,
        discountType: r.discount_type === 'FIXED_AMOUNT' ? 'FIXED_AMOUNT' : 'PERCENTAGE',
        discountValue: Number(r.discount_value) || 0,
        minOrderValue: num(r.min_order_value),
        maxDiscountAmount: num(r.max_discount_amount),
        firstOrderOnly: Boolean(r.first_order_only),
        endsAt: (r.end_date as string) || undefined,
        remainingUses: r.remaining_uses === null || r.remaining_uses === undefined ? null : Number(r.remaining_uses),
        source: r.source === 'personal' ? 'personal' : r.source === 'campaign' ? 'campaign' : 'store',
      });
    }
    return [...merged.values()];
  },

  /** CPF salvo no servidor (null se não houver ou se a coluna ainda não existir). */
  async getMyCpf(tenantId: string, userId: string): Promise<string | null> {
    if (!isSupabaseConfigured || !isValidUuid(tenantId) || !isValidUuid(userId)) return null;
    const { data, error } = await supabase.from('customers').select('cpf').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    if (error) return null;
    return ((data as { cpf?: string | null } | null)?.cpf as string) || null;
  },

  /**
   * Atualiza nome/telefone/CPF do PRÓPRIO cadastro de cliente nesta loja.
   * Retorna 'server' quando tudo foi gravado no servidor; 'partial' quando o CPF não pôde ir ao servidor
   * (migration pendente) — nesse caso nome/telefone vão pela política customers_self_update existente.
   */
  async updateMyProfile(tenantId: string, userId: string, p: { name: string; phone: string; cpf?: string | null }): Promise<'server' | 'partial' | 'no_customer'> {
    if (!isSupabaseConfigured || !isValidUuid(tenantId) || !isValidUuid(userId)) return 'partial';
    const { data, error } = await supabase.rpc('update_my_customer_profile', {
      p_tenant_id: tenantId,
      p_name: p.name,
      p_phone: p.phone,
      p_cpf: p.cpf || null,
    });
    if (!error) return data === false ? 'no_customer' : 'server';
    if (!isMissingBackendFeature(error)) throw new Error(error.message || 'Falha ao salvar seus dados.');
    const { data: rows, error: upErr } = await supabase
      .from('customers')
      .update({ name: p.name, phone: p.phone })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .select('id');
    if (upErr) throw new Error(upErr.message || 'Falha ao salvar seus dados.');
    if (!rows || rows.length === 0) return 'no_customer';
    return 'partial';
  },

  /** Pede a exclusão/anonimização da conta (LGPD). Não apaga nada na hora; o pedido é processado pela plataforma. */
  async requestAccountDeletion(reason: string): Promise<{ ok: true; requestId?: string } | { ok: false; unavailable: boolean; message: string }> {
    if (!isSupabaseConfigured) return { ok: false, unavailable: true, message: 'Indisponível no modo demonstração.' };
    const { data, error } = await supabase.rpc('request_my_account_deletion', { p_reason: reason || null });
    if (error) {
      return isMissingBackendFeature(error)
        ? { ok: false, unavailable: true, message: 'A solicitação de exclusão ainda não está disponível. Tente novamente mais tarde.' }
        : { ok: false, unavailable: false, message: error.message || 'Falha ao registrar a solicitação.' };
    }
    return { ok: true, requestId: typeof data === 'string' ? data : undefined };
  },
};
