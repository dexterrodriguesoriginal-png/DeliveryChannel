import { afterEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
  isSupabaseConfigured: true,
}));

import { customerAppRepository } from '../customerAppRepository';

const TENANT_ID = 'f8965291-3c69-4052-be14-cef68bbcbf38';

afterEach(() => rpc.mockReset());

describe('customer contact consent', () => {
  it('reads the signed-in customer consent for the selected store', async () => {
    rpc.mockResolvedValue({ data: { registered: true, contactConsent: true }, error: null });
    await expect(customerAppRepository.getMyContactConsent(TENANT_ID)).resolves.toEqual({
      registered: true,
      contactConsent: true,
    });
    expect(rpc).toHaveBeenCalledWith('crm_get_my_contact_consent', { p_tenant_id: TENANT_ID });
  });

  it('registers a store customer only with affirmative LGPD consent', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await customerAppRepository.registerMyStoreCustomer(TENANT_ID, {
      name: 'Cliente',
      phone: '(11) 99999-8888',
      consentLgpd: true,
      contactConsent: false,
    });
    expect(rpc).toHaveBeenCalledWith('crm_register_my_store_customer', {
      p_tenant_id: TENANT_ID,
      p_name: 'Cliente',
      p_phone: '(11) 99999-8888',
      p_lgpd_consent: true,
      p_contact_consent: false,
    });
  });

  it('persists an explicit consent choice through the customer-scoped RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await customerAppRepository.setMyContactConsent(TENANT_ID, false);
    expect(rpc).toHaveBeenCalledWith('crm_set_my_contact_consent', {
      p_tenant_id: TENANT_ID,
      p_accepted: false,
    });
  });

  it('surfaces consent RPC errors rather than granting a success-shaped fallback', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(customerAppRepository.setMyContactConsent(TENANT_ID, true)).rejects.toThrow('permission denied');
  });

  it('safely handles collision when a manual store record already exists with the phone', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'PHONE_MANUAL_RECORD_CONFLICT: Já existe um cadastro interno do estabelecimento' },
    });
    await expect(
      customerAppRepository.registerMyStoreCustomer(TENANT_ID, {
        name: 'Cliente Novo',
        phone: '11999998888',
        consentLgpd: true,
        contactConsent: false,
      })
    ).rejects.toThrow(/cadastro presencial anterior com este telefone/);
  });

  it('safely rejects registration when the phone is already tied to another digital account', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'PHONE_ALREADY_REGISTERED: Este telefone já está associado a outra conta' },
    });
    await expect(
      customerAppRepository.registerMyStoreCustomer(TENANT_ID, {
        name: 'Cliente Teste',
        phone: '11999998888',
        consentLgpd: true,
        contactConsent: false,
      })
    ).rejects.toThrow(/número de telefone já está registrado/);
  });
});
