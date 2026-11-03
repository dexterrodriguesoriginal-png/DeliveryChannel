import { describe, expect, it, vi } from 'vitest';
import { PaymentStore } from '../store';

const TENANT = '10000000-0000-0000-0000-00000000000a';

function fixture(member: unknown = { id: 'membership', role_id: 'WAITER' }, enabled = true) {
  const queries: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  const from = vi.fn((table: string) => {
    const query = { table, filters: [] as Array<[string, string, unknown]> };
    queries.push(query);
    const value = table === 'tenant_users' ? member : table === 'tenant_modules' ? (enabled ? { enabled: true } : null)
      : table === 'dining_tabs' ? [{ id: 'tab' }] : [{ id: 'round', tab_id: 'tab', status: 'READY' }];
    const result = { data: value, error: null };
    const chain: any = { select: () => chain, maybeSingle: async () => result, order: async () => result,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const operation of ['eq', 'in', 'neq']) chain[operation] = (key: string, val: unknown) => {
      query.filters.push([operation, key, val]); return chain;
    };
    return chain;
  });
  return { store: new PaymentStore({ from } as any), queries };
}

describe('service-role Salão rounds fallback', () => {
  it('does not read tabs or orders without an active membership in the requested store', async () => {
    const { store, queries } = fixture(null);
    await expect(store.salonRounds('user', TENANT)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(queries.map(q => q.table)).toEqual(['tenant_users']);
    expect(queries[0].filters).toEqual(expect.arrayContaining([
      ['eq', 'tenant_id', TENANT], ['eq', 'user_id', 'user'], ['eq', 'status', 'ACTIVE'],
    ]));
  });

  it('does not bypass the disabled Salão module with service role', async () => {
    const { store, queries } = fixture(undefined, false);
    await expect(store.salonRounds('user', TENANT)).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    expect(queries.map(q => q.table)).toEqual(['tenant_users', 'tenant_modules']);
  });

  it('keeps rounds visible during authorization and pending payment, scoped to the same store and tabs', async () => {
    const { store, queries } = fixture();
    await expect(store.salonRounds('user', TENANT)).resolves.toEqual([{ id: 'round', tab_id: 'tab', status: 'READY' }]);
    const tabs = queries.find(q => q.table === 'dining_tabs')!;
    expect(tabs.filters).toContainEqual(['in', 'status', ['OPEN', 'BILL_REQUESTED', 'WAITER_AUTHORIZED', 'AWAITING_PAYMENT']]);
    for (const query of queries) expect(query.filters).toContainEqual(['eq', 'tenant_id', TENANT]);
    expect(queries.find(q => q.table === 'orders')!.filters).toContainEqual(['in', 'tab_id', ['tab']]);
  });
});
