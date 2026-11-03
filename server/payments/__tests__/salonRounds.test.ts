import { describe, expect, it, vi } from 'vitest';
import { PaymentStore } from '../store';

const TENANT = '10000000-0000-0000-0000-00000000000a';

function fixture(error: object | null = null) {
  const rounds = [{ id: 'round', tab_id: 'assigned-tab', status: 'READY' }];
  const db = {
    rpc: vi.fn().mockResolvedValue({ data: error ? null : rounds, error }),
    from: vi.fn(() => { throw new Error('Service fallback must use the scoped SQL gateway'); }),
  };
  return { db, rounds, store: new PaymentStore(db as any) };
}

describe('service-role Salão rounds fallback', () => {
  it('delegates the verified actor and selected store to the permission and table-scoped SQL gateway', async () => {
    const { store, db, rounds } = fixture();
    await expect(store.salonRounds('verified-user', TENANT)).resolves.toEqual(rounds);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('salon_rounds_for_staff', { p_user: 'verified-user', p_tenant: TENANT });
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each(['FORBIDDEN', 'MODULE_DISABLED', 'TOOL_DISABLED'])('fails closed when SQL rejects %s', async reason => {
    const { store, db } = fixture({ code: '42501', message: `${reason}: safe gateway rejection` });
    await expect(store.salonRounds('verified-user', TENANT)).rejects.toMatchObject({ status: 403 });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('rejects malformed store selectors before invoking the gateway', async () => {
    const { store, db } = fixture();
    await expect(store.salonRounds('verified-user', 'invalid-store')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });
});
