import { Category } from '../types';
import { SecurityContext } from './securityEngine';
import { categoryRepository } from '../repositories/categoryRepository';

export const categoryService = {
  async getCategories(context: SecurityContext, tenantId: string): Promise<Category[]> {
    return categoryRepository.getCategories(context, tenantId);
  },

  async create(context: SecurityContext, tenantId: string, data: Omit<Category, 'id' | 'tenantId' | 'createdAt'>): Promise<Category> {
    return categoryRepository.create(context, tenantId, data);
  },

  async update(context: SecurityContext, tenantId: string, categoryId: string, updates: Partial<Category>): Promise<Category> {
    return categoryRepository.update(context, tenantId, categoryId, updates);
  },

  async delete(context: SecurityContext, tenantId: string, categoryId: string): Promise<void> {
    return categoryRepository.delete(context, tenantId, categoryId);
  },

  async toggleStatus(context: SecurityContext, tenantId: string, categoryId: string): Promise<boolean> {
    return categoryRepository.toggleStatus(context, tenantId, categoryId);
  },

  async reorder(context: SecurityContext, tenantId: string, orderedIds: string[]): Promise<void> {
    return categoryRepository.reorder(context, tenantId, orderedIds);
  },

  async getPublic(slug: string): Promise<Category[]> {
    return categoryRepository.getPublicCategories(slug);
  }
};
