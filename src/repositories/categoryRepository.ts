import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Category } from '../types';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { publicStoreRepository } from './publicStoreRepository';
import { isValidUuid } from '../lib/uuid';

function mapRowToCategory(row: any): Category {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description || '',
    imageUrl: row.image_url || undefined,
    order: Number(row.display_order ?? 0),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    isDemo: Boolean(row.is_demo),
  };
}

export const categoryRepository = {
  /**
   * Obtém as categorias cadastradas do estabelecimento no Supabase.
   */
  async getCategories(context: SecurityContext, tenantId: string): Promise<Category[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('categories')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('display_order', { ascending: true });

        if (error) {
          console.warn('[categoryRepository] Erro ao carregar categorias do Supabase:', error.message);
          return dataStore.getCategories(context, tenantId);
        }

        return (data || []).map(mapRowToCategory);
      } catch (err) {
        console.warn('[categoryRepository] Falha ao consultar categorias no Supabase:', err);
        return dataStore.getCategories(context, tenantId);
      }
    }
    return dataStore.getCategories(context, tenantId);
  },

  /**
   * Obtém as categorias públicas para a vitrine através da RPC segura.
   */
  async getPublicCategories(slug: string): Promise<Category[]> {
    if (isSupabaseConfigured) {
      const store = await publicStoreRepository.getPublicStore(slug);
      if (store) {
        return store.categories;
      }
      return [];
    }
    return dataStore.getPublicCategories(slug);
  },

  /**
   * Cria nova categoria com UUID real gerado pelo PostgreSQL.
   */
  async create(
    context: SecurityContext, 
    tenantId: string, 
    data: Omit<Category, 'id' | 'tenantId' | 'createdAt'>
  ): Promise<Category> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data: inserted, error } = await supabase
          .from('categories')
          .insert({
            tenant_id: tenantId,
            name: data.name.trim(),
            description: data.description ? data.description.trim() : '',
            image_url: data.imageUrl || null,
            display_order: data.order ?? 0,
            is_active: data.isActive !== undefined ? data.isActive : true,
            is_demo: data.isDemo ?? false,
          })
          .select()
          .single();

        if (error) {
          console.warn('[categoryRepository] Erro ao criar categoria no Supabase:', error.message);
          return dataStore.createCategory(context, tenantId, data);
        }

        return mapRowToCategory(inserted);
      } catch (err) {
        console.warn('[categoryRepository] Falha ao criar categoria no Supabase:', err);
        return dataStore.createCategory(context, tenantId, data);
      }
    }
    return dataStore.createCategory(context, tenantId, data);
  },

  /**
   * Atualiza dados de categoria existente no Supabase.
   */
  async update(
    context: SecurityContext, 
    tenantId: string, 
    categoryId: string, 
    updates: Partial<Category>
  ): Promise<Category> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(categoryId)) {
      try {
        const dbUpdates: any = { updated_at: new Date().toISOString() };
        if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
        if (updates.description !== undefined) dbUpdates.description = updates.description.trim();
        if (updates.imageUrl !== undefined) dbUpdates.image_url = updates.imageUrl;
        if (updates.order !== undefined) dbUpdates.display_order = updates.order;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;

        const { data: updated, error } = await supabase
          .from('categories')
          .update(dbUpdates)
          .eq('tenant_id', tenantId)
          .eq('id', categoryId)
          .select()
          .single();

        if (error) {
          console.warn('[categoryRepository] Erro ao atualizar categoria no Supabase:', error.message);
          return dataStore.updateCategory(context, tenantId, categoryId, updates);
        }

        return mapRowToCategory(updated);
      } catch (err) {
        console.warn('[categoryRepository] Falha ao atualizar categoria no Supabase:', err);
        return dataStore.updateCategory(context, tenantId, categoryId, updates);
      }
    }
    return dataStore.updateCategory(context, tenantId, categoryId, updates);
  },

  /**
   * Exclui categoria no Supabase.
   */
  async delete(context: SecurityContext, tenantId: string, categoryId: string): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(categoryId)) {
      try {
        const { error } = await supabase
          .from('categories')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('id', categoryId);

        if (error) {
          console.warn('[categoryRepository] Erro ao deletar categoria no Supabase:', error.message);
        }
      } catch (err) {
        console.warn('[categoryRepository] Falha ao excluir categoria no Supabase:', err);
      }
    }
    dataStore.deleteCategory(context, tenantId, categoryId);
  },

  /**
   * Alterna visibilidade da categoria no Supabase.
   */
  async toggleStatus(context: SecurityContext, tenantId: string, categoryId: string): Promise<boolean> {
    const list = await this.getCategories(context, tenantId);
    const category = list.find(c => c.id === categoryId);
    if (!category) throw new Error('Categoria não encontrada');
    const newStatus = !category.isActive;
    await this.update(context, tenantId, categoryId, { isActive: newStatus });
    return newStatus;
  },

  /**
   * Atualiza a ordem de exibição das categorias no Supabase.
   */
  async reorder(context: SecurityContext, tenantId: string, orderedIds: string[]): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const promises = orderedIds.map((id, index) =>
          supabase
            .from('categories')
            .update({ display_order: index, updated_at: new Date().toISOString() })
            .eq('tenant_id', tenantId)
            .eq('id', id)
        );
        const results = await Promise.all(promises);
        const err = results.find(r => r.error);
        if (err?.error) {
          console.warn('[categoryRepository] Erro ao reordenar categorias no Supabase:', err.error.message);
        }
      } catch (err) {
        console.warn('[categoryRepository] Falha ao reordenar categorias:', err);
      }
      return;
    }
    dataStore.reorderCategories(context, tenantId, orderedIds);
  }
};
