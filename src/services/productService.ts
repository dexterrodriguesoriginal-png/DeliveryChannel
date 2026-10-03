import { Product } from '../types';
import { SecurityContext } from './securityEngine';
import { productRepository } from '../repositories/productRepository';

export const productService = {
  async getProducts(context: SecurityContext, tenantId: string): Promise<Product[]> {
    return productRepository.getProducts(context, tenantId);
  },

  async getProductById(context: SecurityContext, tenantId: string, productId: string): Promise<Product | undefined> {
    const list = await productRepository.getProducts(context, tenantId);
    return list.find(p => p.id === productId);
  },

  async create(context: SecurityContext, tenantId: string, data: Omit<Product, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>): Promise<Product> {
    return productRepository.create(context, tenantId, data);
  },

  async update(context: SecurityContext, tenantId: string, productId: string, updates: Partial<Product>): Promise<Product> {
    return productRepository.update(context, tenantId, productId, updates);
  },

  async delete(context: SecurityContext, tenantId: string, productId: string): Promise<void> {
    return productRepository.delete(context, tenantId, productId);
  },

  async duplicate(context: SecurityContext, tenantId: string, productId: string): Promise<Product> {
    return productRepository.duplicate(context, tenantId, productId);
  },

  async toggleStatus(context: SecurityContext, tenantId: string, productId: string): Promise<boolean> {
    return productRepository.toggleStatus(context, tenantId, productId);
  }
};
