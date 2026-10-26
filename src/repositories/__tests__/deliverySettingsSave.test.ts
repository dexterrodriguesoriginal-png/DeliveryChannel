import { afterEach, describe, expect, it, vi } from 'vitest';
const { from, update, eq, select } = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { from }, isSupabaseConfigured: true }));
import { tenantRepository } from '../tenantRepository';
const tenantId = '10000000-0000-0000-0000-00000000000a';
afterEach(() => vi.clearAllMocks());
function setup(data: unknown[]) {
  from.mockReturnValue({ update }); update.mockReturnValue({ eq }); eq.mockReturnValue({ select });
  select.mockResolvedValue({ data, error: null });
}
describe('persistir entrega grátis', () => {
  it('envia zero ao banco e só conclui quando uma linha foi atualizada', async () => {
    setup([{ tenant_id: tenantId }]);
    await tenantRepository.updateSettings({} as any, tenantId, { deliveryFee: 0 });
    expect(from).toHaveBeenCalledWith('tenant_settings');
    expect(update).toHaveBeenCalledWith({ delivery_fee: 0, updated_at: expect.any(String) });
    expect(eq).toHaveBeenCalledWith('tenant_id', tenantId);
  });
  it('não informa sucesso se RLS ou linha ausente impedir a gravação', async () => {
    setup([]);
    await expect(tenantRepository.updateSettings({} as any, tenantId, { deliveryFee: 0 })).rejects.toThrow('As configurações não foram salvas');
  });
});
