import { Offer } from '../types';
import { SecurityContext } from './securityEngine';
import { offerRepository } from '../repositories/offerRepository';

export const offerService = {
  async getOffers(context: SecurityContext, tenantId: string): Promise<Offer[]> {
    return offerRepository.getOffers(context, tenantId);
  },

  async create(context: SecurityContext, tenantId: string, data: Omit<Offer, 'id' | 'tenantId' | 'createdAt'>): Promise<Offer> {
    return offerRepository.create(context, tenantId, data);
  },

  async update(context: SecurityContext, tenantId: string, offerId: string, updates: Partial<Offer>): Promise<Offer> {
    return offerRepository.update(context, tenantId, offerId, updates);
  },

  async delete(context: SecurityContext, tenantId: string, offerId: string): Promise<void> {
    return offerRepository.delete(context, tenantId, offerId);
  },

  async toggleStatus(context: SecurityContext, tenantId: string, offerId: string): Promise<boolean> {
    return offerRepository.toggleStatus(context, tenantId, offerId);
  },

  async getPublic(slug: string): Promise<Offer[]> {
    return offerRepository.getPublicOffers(slug);
  }
};
