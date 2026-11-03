import { describe, expect, it, vi } from 'vitest';
import { PaymentStore } from '../store';

const TENANT = '10000000-0000-0000-0000-00000000000a';

function fixture({ role = 'MANAGER', permissions = ['view_orders', 'manage_orders'], customerOwned = false, memberUser = 'actor' } = {}) {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    orders: [{ id: 'order', tenant_id: TENANT, customer_id: 'customer', customer_name: 'Private customer', customer_email: 'private@example.test', tenants: { slug: 'store', status: 'ACTIVE' } }],
    customers: customerOwned ? [{ id: 'customer', tenant_id: TENANT, user_id: 'actor' }] : [],
    tenant_users: [{ id: 'membership', tenant_id: TENANT, user_id: memberUser, role_id: role, status: 'ACTIVE' }],
  };
  const db = {
    from: vi.fn((table: string) => {
      const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          predicates.push(row => key.split('.').reduce((value: any, part) => value?.[part], row) === value);
          return query;
        },
        in: (key: string, values: unknown[]) => { predicates.push(row => values.includes(row[key])); return query; },
        maybeSingle: async () => ({ data: rows[table].find(row => predicates.every(predicate => predicate(row))) ?? null, error: null }),
      };
      return query;
    }),
    rpc: vi.fn(async (_fn: string, args: { p_user: string; p_tenant: string; p_perm: string }) => ({
      data: args.p_user === 'actor' && args.p_tenant === TENANT && permissions.includes(args.p_perm), error: null,
    })),
  };
  return { store: new PaymentStore(db as any), db };
}

describe('payment order actor permissions', () => {
  it('denies staff whose order and cashier permissions were disabled', async () => {
    const { store } = fixture({ permissions: [] });
    await expect(store.order('actor', 'order', true)).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });
  it('keeps read-only staff from receiving payments', async () => {
    const { store } = fixture({ permissions: ['view_orders'] });
    await expect(store.order('actor', 'order')).resolves.toMatchObject({ staffRole: 'MANAGER', customerOwned: false, canReceive: false });
  });
  it.each([
    { role: 'MANAGER', permissions: ['manage_orders'] },
    { role: 'CASHIER', permissions: ['manage_cashier'] },
  ])('allows operational receipts with the effective %s permission', async options => {
    const { store, db } = fixture(options);
    await expect(store.order('actor', 'order')).resolves.toMatchObject({ staffRole: options.role, canReceive: true });
    expect(db.rpc).toHaveBeenCalledWith('_store_user_permission', { p_user: 'actor', p_tenant: TENANT, p_perm: options.permissions[0] });
  });
  it('preserves own-customer access even without staff permission', async () => {
    const { store } = fixture({ role: 'KITCHEN', permissions: [], customerOwned: true });
    await expect(store.order('actor', 'order')).resolves.toMatchObject({ customerOwned: true, canReceive: false, staffRole: undefined });
  });
  it.each(['KITCHEN', 'WAITER', 'DRIVER'])('does not expose payment customer data to a %s membership', async role => {
    const { store, db } = fixture({ role });
    await expect(store.order('actor', 'order', true)).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('does not authorize using another user membership', async () => {
    const { store, db } = fixture({ memberUser: 'someone-else' });
    await expect(store.order('actor', 'order')).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
