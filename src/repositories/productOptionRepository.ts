import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { BackendError, toBackendError } from '../lib/backend';
import type { ProductOption, ProductOptionGroup, ProductOptionPricingRule, ProductOptionGroupType } from '../types';

type GroupInput = Pick<ProductOptionGroup, 'name' | 'type' | 'minSelect' | 'maxSelect' | 'allowRepeat' | 'pricingRule' | 'active' | 'sort'>;
type OptionInput = Pick<ProductOption, 'name' | 'extraPriceCents' | 'active' | 'soldOut' | 'sort'>;

export function isMissingOptionSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && ['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code || ''));
}

function mapGroup(row: any, options: any[] = []): ProductOptionGroup {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    type: row.type as ProductOptionGroupType,
    minSelect: Number(row.min_select),
    maxSelect: Number(row.max_select),
    allowRepeat: Boolean(row.allow_repeat),
    pricingRule: row.pricing_rule as ProductOptionPricingRule,
    active: Boolean(row.active),
    sort: Number(row.sort),
    options: options.map(option => ({
      id: option.id,
      tenantId: option.tenant_id,
      groupId: option.group_id,
      name: option.name,
      extraPriceCents: Number(option.extra_price_cents),
      active: Boolean(option.active),
      soldOut: Boolean(option.sold_out),
      sort: Number(option.sort),
    })),
  };
}

export const productOptionRepository = {
  async getPublicForProducts(tenantId: string, productIds: string[]): Promise<Map<string, ProductOptionGroup[]>> {
    const result = new Map<string, ProductOptionGroup[]>();
    if (!isSupabaseConfigured || productIds.length === 0) return result;
    const links = await supabase.from('product_option_group_links')
      .select('product_id, group_id').eq('tenant_id', tenantId).in('product_id', productIds);
    if (links.error) {
      if (isMissingOptionSchema(links.error)) return result;
      throw toBackendError(links.error, 'Falha ao carregar os grupos de adicionais.');
    }
    const groupIds = [...new Set((links.data || []).map(row => row.group_id))];
    if (!groupIds.length) return result;
    const [groups, options] = await Promise.all([
      supabase.from('product_option_groups').select('*').eq('tenant_id', tenantId).in('id', groupIds).eq('active', true).order('sort'),
      supabase.from('product_options').select('*').eq('tenant_id', tenantId).in('group_id', groupIds).eq('active', true).order('sort'),
    ]);
    const error = groups.error || options.error;
    if (error) {
      if (isMissingOptionSchema(error)) return result;
      throw toBackendError(error, 'Falha ao carregar as opções dos produtos.');
    }
    const optionsByGroup = new Map<string, any[]>();
    for (const option of options.data || []) {
      const groupOptions = optionsByGroup.get(option.group_id) || [];
      groupOptions.push(option);
      optionsByGroup.set(option.group_id, groupOptions);
    }
    const mapped = new Map((groups.data || []).map(row => [row.id, mapGroup(row, optionsByGroup.get(row.id) || [])]));
    for (const link of links.data || []) {
      const group = mapped.get(link.group_id);
      if (group) result.set(link.product_id, [...(result.get(link.product_id) || []), group]);
    }
    for (const groupsForProduct of result.values()) groupsForProduct.sort((a, b) => a.sort - b.sort);
    return result;
  },

  async listForTenant(tenantId: string): Promise<ProductOptionGroup[]> {
    const { data, error } = await supabase.from('product_option_groups').select('*')
      .eq('tenant_id', tenantId).order('sort').order('name');
    if (error) throw isMissingOptionSchema(error)
      ? new BackendError('ADDONS_UNAVAILABLE', 'Os grupos de adicionais ainda não estão disponíveis neste ambiente.')
      : toBackendError(error, 'Falha ao carregar a biblioteca de adicionais.');
    const groups = data || [];
    if (!groups.length) return [];
    const options = await supabase.from('product_options').select('*').eq('tenant_id', tenantId)
      .in('group_id', groups.map(group => group.id)).order('sort').order('name');
    if (options.error) throw toBackendError(options.error, 'Falha ao carregar as opções.');
    const optionsByGroup = new Map<string, any[]>();
    for (const option of options.data || []) optionsByGroup.set(option.group_id, [...(optionsByGroup.get(option.group_id) || []), option]);
    return groups.map(group => mapGroup(group, optionsByGroup.get(group.id) || []));
  },

  async saveGroup(tenantId: string, input: GroupInput, id?: string): Promise<void> {
    const row = {
      tenant_id: tenantId, name: input.name.trim(), type: input.type,
      min_select: input.minSelect, max_select: input.maxSelect, allow_repeat: input.allowRepeat,
      pricing_rule: input.pricingRule, active: input.active, sort: input.sort,
    };
    const query = id
      ? supabase.from('product_option_groups').update(row).eq('tenant_id', tenantId).eq('id', id)
      : supabase.from('product_option_groups').insert(row);
    const { error } = await query;
    if (error) throw toBackendError(error, 'Falha ao salvar o grupo de adicionais.');
  },

  async saveOption(tenantId: string, groupId: string, input: OptionInput, id?: string): Promise<void> {
    const row = {
      tenant_id: tenantId, group_id: groupId, name: input.name.trim(),
      extra_price_cents: input.extraPriceCents, active: input.active, sold_out: input.soldOut, sort: input.sort,
    };
    const query = id
      ? supabase.from('product_options').update(row).eq('tenant_id', tenantId).eq('id', id)
      : supabase.from('product_options').insert(row);
    const { error } = await query;
    if (error) throw toBackendError(error, 'Falha ao salvar a opção.');
  },

  async setProductGroups(tenantId: string, productId: string, groupIds: string[]): Promise<void> {
    const { error } = await supabase.rpc('set_product_option_group_links', {
      p_tenant_id: tenantId, p_product_id: productId, p_group_ids: groupIds,
    });
    if (error) throw toBackendError(error, 'Falha ao vincular os grupos ao produto.');
  },

  async setOptionSoldOut(tenantId: string, optionId: string, soldOut: boolean): Promise<void> {
    const { error } = await supabase.from('product_options').update({ sold_out: soldOut })
      .eq('tenant_id', tenantId).eq('id', optionId);
    if (error) throw toBackendError(error, 'Falha ao atualizar a disponibilidade da opção.');
  },

  async changeOptionPrice(tenantId: string, optionId: string, deltaCents: number): Promise<void> {
    return this.changeOptionPrices(tenantId, [optionId], deltaCents);
  },

  async changeOptionPrices(tenantId: string, optionIds: string[], deltaCents: number): Promise<void> {
    if (!optionIds.length) return;
    const { data, error } = await supabase.rpc('change_product_options_price', {
      p_tenant_id: tenantId, p_option_ids: optionIds, p_delta_cents: deltaCents,
    });
    if (error) throw toBackendError(error, 'Falha ao atualizar o preço da opção.');
    if (!data) throw new BackendError('OPTION_PRICE_INVALID', 'O preço não pode ficar negativo. Nenhuma alteração foi aplicada.');
  },
};
