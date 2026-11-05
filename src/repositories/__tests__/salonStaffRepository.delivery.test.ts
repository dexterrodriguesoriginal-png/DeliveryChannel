import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn(), rows: [] as unknown[] }));
vi.mock('../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {
  rpc: h.rpc,
  from: () => {
    const chain: Record<string, unknown> = { select: (...args: unknown[]) => { h.select(...args); return chain; } };
    for (const key of ['eq', 'in', 'neq', 'order']) chain[key] = () => chain;
    chain.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: h.rows, error: null }).then(resolve);
    return chain;
  },
} }));
import { salonStaffRepository } from '../salonStaffRepository';

beforeEach(() => { h.rpc.mockReset(); h.select.mockClear(); h.rows = []; });
describe('Projeção segura de entrega para o salão', () => {
  it('obtém flags da rodada via RPC sem selecionar o código secreto', async () => {
    h.rows = [{ id: 'old-code', tab_id: 'tab' }, { id: 'no-code', tab_id: 'tab' }];
    h.rpc.mockResolvedValue({ data: [
      { order_id: 'old-code', delivery_code_required: true, delivery_confirmed_with_code: false, delivery_code: '1234' },
      { order_id: 'no-code', delivery_code_required: false, delivery_confirmed_with_code: true },
    ], error: null });
    const result = await salonStaffRepository.fetchRoundsForTabs('tenant', ['tab']);
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('salon_delivery_states', { p_tenant: 'tenant', p_order_ids: ['old-code', 'no-code'] });
    expect(h.select.mock.calls[0][0]).not.toContain('delivery_code');
    expect(result).toEqual([
      { id: 'old-code', tab_id: 'tab', delivery_code_required: true, delivery_confirmed_with_code: false },
      { id: 'no-code', tab_id: 'tab', delivery_code_required: false, delivery_confirmed_with_code: true },
    ]);
    expect(JSON.stringify(result)).not.toContain('1234');
  });
  it('envia consentimento somente quando fornecido explicitamente', async () => {
    h.rpc.mockResolvedValue({ data: {}, error: null });
    await salonStaffRepository.joinTables(['one', 'two']);
    expect(h.rpc).toHaveBeenLastCalledWith('staff_join_tables', { p_table_ids: ['one', 'two'], p_accept_occupied: false });
    await salonStaffRepository.joinTables(['one', 'two'], true);
    expect(h.rpc).toHaveBeenLastCalledWith('staff_join_tables', { p_table_ids: ['one', 'two'], p_accept_occupied: true });
  });
  it('envia a mesa física ao pedir por mesa secundária de um grupo', async () => {
    h.rpc.mockResolvedValue({ data: {}, error: null });
    const items = [{ productId: 'product', quantity: 1 }];
    await salonStaffRepository.submitTableRound('secondary-table', items, 'idempotency');
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith('staff_submit_table_round', { p_table_id: 'secondary-table', p_items: items, p_idempotency_key: 'idempotency' });
  });
});

