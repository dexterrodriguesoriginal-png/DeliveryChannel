import { afterEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
  isSupabaseConfigured: true,
}));
vi.mock('../../lib/backend', () => ({
  localOnly: (_name: string, callback: () => unknown) => callback(),
  requireBackendOrLocalDemo: () => undefined,
  toBackendError: (error: unknown) => error,
  isLocalDemoAllowed: () => false,
}));

import { customerRepository } from '../customerRepository';

const TENANT_ID = 'f8965291-3c69-4052-be14-cef68bbcbf38';
const CUSTOMER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

afterEach(() => rpc.mockReset());

describe('store CRM repository', () => {
  it('loads only the current tenant CRM summary through its tenant-scoped RPC', async () => {
    rpc.mockResolvedValue({
      data: {
        totalCount: 1,
        limit: 15,
        offset: 0,
        customers: [{
          id: CUSTOMER_ID,
          name: 'Cliente',
          phone: '11999998888',
          origin: 'qr_code',
          totalOrders: 2,
          totalSpent: 75,
          lastOrderAt: '2026-10-20T12:00:00Z',
          contactConsent: false,
          hasLgpdConsent: true,
          isManual: false,
          notes: '',
          tags: [],
        }],
      },
      error: null,
    });
    const result = await customerRepository.getCrmCustomers(TENANT_ID, { search: 'Cliente', origin: 'qr_code', limit: 15 });
    expect(rpc).toHaveBeenCalledWith('crm_list_customers', {
      p_tenant_id: TENANT_ID,
      p_search: 'Cliente',
      p_origin: 'qr_code',
      p_limit: 15,
      p_offset: 0,
    });
    expect(result.customers[0]).toMatchObject({ totalOrders: 2, totalSpent: 75, contactConsent: false });
    expect(result.customers[0]).not.toHaveProperty('cpf');
    expect(result.customers[0]).not.toHaveProperty('userId');
  });

  it('fetches a WhatsApp target only through the live consent-checked RPC', async () => {
    rpc.mockResolvedValue({ data: '11999998888', error: null });
    await expect(customerRepository.getCrmCustomerContactTarget(TENANT_ID, CUSTOMER_ID)).resolves.toBe('11999998888');
    expect(rpc).toHaveBeenCalledWith('crm_get_customer_contact_target', {
      p_tenant_id: TENANT_ID,
      p_customer_id: CUSTOMER_ID,
    });
  });

  it('sends a separate recorded consent for manual data and WhatsApp contact', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await customerRepository.createCrmManualCustomer(TENANT_ID, {
      name: 'Cliente',
      phone: '11999998888',
      origin: 'whatsapp',
      consentLgpd: true,
      contactConsent: false,
    });
    expect(rpc).toHaveBeenCalledWith('crm_create_manual_customer', expect.objectContaining({
      p_tenant_id: TENANT_ID,
      p_lgpd_consent: true,
      p_contact_consent: false,
    }));
  });

  it('does not fall back to local records when the CRM RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(customerRepository.getCrmCustomers(TENANT_ID, {})).rejects.toThrow('permission denied');
  });
});
