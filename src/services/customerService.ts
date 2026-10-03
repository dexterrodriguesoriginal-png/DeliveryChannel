import { Customer } from '../types';
import { SecurityContext } from './securityEngine';
import { customerRepository } from '../repositories/customerRepository';

const customersCache = new Map<string, Customer[]>();

export const customerService = {
  getCustomers(context: SecurityContext, tenantId: string): Customer[] {
    customerRepository.getCustomers(context, tenantId)
      .then(data => {
        customersCache.set(tenantId, data);
      })
      .catch(err => {
        console.warn('[customerService] Erro ao sincronizar clientes do Supabase:', err);
      });

    return customersCache.get(tenantId) || [];
  },

  async fetchRemoteCustomers(context: SecurityContext, tenantId: string): Promise<Customer[]> {
    const data = await customerRepository.getCustomers(context, tenantId);
    customersCache.set(tenantId, data);
    return data;
  }
};
