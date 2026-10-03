import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Product } from '../types';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { publicStoreRepository } from './publicStoreRepository';
import { isValidUuid } from '../lib/uuid';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapRowToProduct(row: any): Product {
  const stockQty = Number(row.stock_quantity ?? 0);
  const active = Boolean(row.is_active);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    categoryId: row.category_id || '',
    name: row.name,
    description: row.description || '',
    price: Number(row.price),
    promotionalPrice: row.promotional_price ? Number(row.promotional_price) : undefined,
    cost: row.cost_price ? Number(row.cost_price) : undefined,
    sku: row.sku || undefined,
    imageUrl: row.image_url || 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&auto=format&fit=crop&q=80',
    isAvailable: stockQty > 0 && active,
    isActive: active,
    isFeatured: Boolean(row.is_featured),
    stockQuantity: stockQty,
    minStock: row.min_stock_alert ? Number(row.min_stock_alert) : undefined,
    unit: row.unit || 'un',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDemo: Boolean(row.is_demo),
  };
}

export const productRepository = {
  /**
   * Obtém lista de produtos reais do estabelecimento a partir do Supabase.
   */
  async getProducts(context: SecurityContext, tenantId: string): Promise<Product[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('name');

        if (error) {
          console.warn('[productRepository] Erro ao buscar produtos do Supabase:', error.message);
          return dataStore.getProducts(context, tenantId);
        }

        return (data || []).map(mapRowToProduct);
      } catch (err) {
        console.warn('[productRepository] Falha ao consultar produtos no Supabase:', err);
        return dataStore.getProducts(context, tenantId);
      }
    }
    return dataStore.getProducts(context, tenantId);
  },

  /**
   * Obtém produtos públicos para a vitrine através da RPC segura.
   */
  async getPublicProducts(slug: string): Promise<Product[]> {
    if (isSupabaseConfigured) {
      const store = await publicStoreRepository.getPublicStore(slug);
      if (store) {
        return store.products;
      }
      return [];
    }
    return dataStore.getPublicProducts(slug);
  },

  /**
   * Valida se uma category_id é UUID legítimo e pertence ao tenant especificado.
   */
  async validateCategoryBelongsToTenant(tenantId: string, categoryId?: string | null): Promise<string | null> {
    if (!categoryId || !categoryId.trim()) return null;
    const cleanId = categoryId.trim();

    if (!isValidUuid(cleanId)) {
      console.warn(`[productRepository] Categoria "${cleanId}" não é UUID válido. Ignorando vínculo.`);
      return null;
    }

    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('categories')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('id', cleanId)
          .maybeSingle();

        if (error) {
          console.warn('[productRepository] Erro ao validar categoria no banco:', error.message);
          return null;
        }

        if (!data) {
          throw new Error('A categoria selecionada não pertence a este estabelecimento comercial.');
        }
        return cleanId;
      } catch (err) {
        console.warn('[productRepository] Falha ao validar categoria no Supabase:', err);
        return null;
      }
    }

    return cleanId;
  },

  /**
   * Cria novo produto com UUID real gerado pelo PostgreSQL.
   */
  async create(
    context: SecurityContext, 
    tenantId: string, 
    data: Omit<Product, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
  ): Promise<Product> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const validatedCategoryId = await this.validateCategoryBelongsToTenant(tenantId, data.categoryId);

        const { data: inserted, error } = await supabase
          .from('products')
          .insert({
            tenant_id: tenantId,
            category_id: validatedCategoryId,
            name: data.name.trim(),
            description: data.description ? data.description.trim() : '',
            price: data.price,
            promotional_price: data.promotionalPrice && data.promotionalPrice > 0 ? data.promotionalPrice : null,
            cost_price: data.cost && data.cost > 0 ? data.cost : null,
            sku: data.sku && data.sku.trim() ? data.sku.trim() : null,
            image_url: data.imageUrl || 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&auto=format&fit=crop&q=80',
            is_active: data.isActive !== undefined ? data.isActive : true,
            is_featured: Boolean(data.isFeatured),
            stock_quantity: data.stockQuantity ?? 0,
            min_stock_alert: data.minStock ?? 5,
            unit: data.unit || 'un',
            is_demo: data.isDemo ?? false,
          })
          .select()
          .single();

        if (error) {
          console.warn('[productRepository] Erro ao cadastrar produto no Supabase, usando dataStore:', error.message);
          return dataStore.createProduct(context, tenantId, data);
        }

        return mapRowToProduct(inserted);
      } catch (err) {
        console.warn('[productRepository] Falha ao cadastrar produto no Supabase:', err);
        return dataStore.createProduct(context, tenantId, data);
      }
    }
    return dataStore.createProduct(context, tenantId, data);
  },

  /**
   * Atualiza produto existente no Supabase.
   */
  async update(
    context: SecurityContext, 
    tenantId: string, 
    productId: string, 
    updates: Partial<Product>
  ): Promise<Product> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(productId)) {
      try {
        const dbUpdates: any = { updated_at: new Date().toISOString() };
        if (updates.name !== undefined) dbUpdates.name = updates.name.trim();
        if (updates.description !== undefined) dbUpdates.description = updates.description.trim();
        if (updates.categoryId !== undefined) {
          dbUpdates.category_id = await this.validateCategoryBelongsToTenant(tenantId, updates.categoryId);
        }
        if (updates.price !== undefined) dbUpdates.price = updates.price;
        if (updates.promotionalPrice !== undefined) {
          dbUpdates.promotional_price = updates.promotionalPrice > 0 ? updates.promotionalPrice : null;
        }
        if (updates.cost !== undefined) {
          dbUpdates.cost_price = updates.cost > 0 ? updates.cost : null;
        }
        if (updates.sku !== undefined) {
          dbUpdates.sku = updates.sku.trim() ? updates.sku.trim() : null;
        }
        if (updates.imageUrl !== undefined) dbUpdates.image_url = updates.imageUrl;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
        if (updates.isFeatured !== undefined) dbUpdates.is_featured = updates.isFeatured;
        if (updates.stockQuantity !== undefined) dbUpdates.stock_quantity = updates.stockQuantity;
        if (updates.minStock !== undefined) dbUpdates.min_stock_alert = updates.minStock;
        if (updates.unit !== undefined) dbUpdates.unit = updates.unit;

        const { data: updated, error } = await supabase
          .from('products')
          .update(dbUpdates)
          .eq('tenant_id', tenantId)
          .eq('id', productId)
          .select()
          .single();

        if (error) {
          console.warn('[productRepository] Erro ao atualizar produto no Supabase, usando dataStore:', error.message);
          return dataStore.updateProduct(context, tenantId, productId, updates);
        }

        return mapRowToProduct(updated);
      } catch (err) {
        console.warn('[productRepository] Falha ao atualizar produto no Supabase:', err);
        return dataStore.updateProduct(context, tenantId, productId, updates);
      }
    }
    return dataStore.updateProduct(context, tenantId, productId, updates);
  },

  /**
   * Remove produto do Supabase.
   */
  async delete(context: SecurityContext, tenantId: string, productId: string): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(productId)) {
      try {
        const { error } = await supabase
          .from('products')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('id', productId);

        if (error) {
          console.warn('[productRepository] Erro ao excluir produto no Supabase:', error.message);
        }
      } catch (err) {
        console.warn('[productRepository] Falha ao excluir produto no Supabase:', err);
      }
    }
    dataStore.deleteProduct(context, tenantId, productId);
  },

  /**
   * Duplica produto diretamente no banco.
   */
  async duplicate(context: SecurityContext, tenantId: string, productId: string): Promise<Product> {
    const list = await this.getProducts(context, tenantId);
    const prod = list.find(p => p.id === productId);
    if (!prod) throw new Error('Produto a ser duplicado não foi encontrado.');

    const copyData: Omit<Product, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'> = {
      categoryId: prod.categoryId,
      name: `${prod.name} (Cópia)`,
      description: prod.description,
      price: prod.price,
      promotionalPrice: prod.promotionalPrice,
      cost: prod.cost,
      sku: prod.sku ? `${prod.sku}-COPY` : undefined,
      imageUrl: prod.imageUrl,
      isAvailable: prod.isAvailable,
      isActive: prod.isActive,
      isFeatured: false,
      stockQuantity: prod.stockQuantity,
      minStock: prod.minStock,
      unit: prod.unit,
      isDemo: false,
    };

    return this.create(context, tenantId, copyData);
  },

  /**
   * Alterna disponibilidade do produto no Supabase.
   */
  async toggleStatus(context: SecurityContext, tenantId: string, productId: string): Promise<boolean> {
    const list = await this.getProducts(context, tenantId);
    const prod = list.find(p => p.id === productId);
    if (!prod) throw new Error('Produto não encontrado');
    const newStatus = !prod.isActive;
    await this.update(context, tenantId, productId, { isActive: newStatus });
    return newStatus;
  }
};
