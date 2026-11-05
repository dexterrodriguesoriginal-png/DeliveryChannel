import { describe, expect, it, vi } from 'vitest';
import { PaymentStore } from '../store';
import type { SupabaseClient } from '@supabase/supabase-js';

const membershipId = '10000000-0000-0000-0000-000000000001';
const member = { id: membershipId, user_id: 'owner', tenant_id: 'store-a', role_id: 'OWNER', status: 'ACTIVE', 'tenants.status': 'ACTIVE' };

function fixture(row: Record<string, string>) {
  const predicates: Array<(candidate: Record<string, string>) => boolean> = [];
  const query = {
    select: () => query,
    eq: (key: string, value: string) => { predicates.push(candidate => candidate[key] === value); return query; },
    in: (key: string, values: string[]) => { predicates.push(candidate => values.includes(candidate[key])); return query; },
    maybeSingle: async () => ({ data: predicates.every(predicate => predicate(row)) ? row : null, error: null }),
  };
  const db = { from: vi.fn().mockReturnValue(query) };
  return { db, store: new PaymentStore(db as unknown as SupabaseClient) };
}

describe('sensitive provider account membership', () => {
  it('allows only the active owner of an active store', async () => {
    const { store } = fixture(member);
    await expect(store.membership('owner', membershipId)).resolves.toMatchObject({ tenant_id: 'store-a', role_id: 'OWNER' });
  });
  it.each(['MANAGER', 'CASHIER', 'KITCHEN', 'WAITER', 'OPERATOR', 'DRIVER'])('rejects %s even in the same store', async role_id => {
    const { store } = fixture({ ...member, role_id });
    await expect(store.membership('owner', membershipId)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
  it.each([
    { user_id: 'someone-else' }, { status: 'SUSPENDED' }, { 'tenants.status': 'SUSPENDED' },
  ])('rejects an inactive or foreign membership %j', async patch => {
    const { store } = fixture({ ...member, ...patch });
    await expect(store.membership('owner', membershipId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

