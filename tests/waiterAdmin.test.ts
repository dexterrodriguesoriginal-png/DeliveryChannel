import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWaiterAdminHandler } from '../supabase/functions/waiter-admin/handler';

const TENANT = '10000000-0000-0000-0000-000000000001';
const OWNER = '10000000-0000-0000-0000-000000000002';
const WAITER = '10000000-0000-0000-0000-000000000003';
const MEMBER = '10000000-0000-0000-0000-000000000004';
const env = { url: 'https://supabase.test', anon: 'anon-key', service: 'service-key' };
const createInput = { action: 'create', tenantId: TENANT, name: 'João Silva', phone: '(11) 99999-0000', username: 'joao', password: 'senha123', contactEmail: 'contato@example.com' };

let caller: any, admin: any, factory: any, handler: ReturnType<typeof createWaiterAdminHandler>;
let queries: Record<string, any>;
const post = (body: Record<string, unknown>, token = 'caller-jwt') => handler(new Request('https://edge.test/waiter-admin', {
  method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

beforeEach(() => {
  queries = {};
  caller = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: OWNER } }, error: null }) }, rpc: vi.fn().mockResolvedValue({ data: true, error: null }) };
  admin = {
    auth: { admin: {
      createUser: vi.fn().mockResolvedValue({ data: { user: { id: WAITER } }, error: null }),
      deleteUser: vi.fn().mockResolvedValue({ error: null }), updateUserById: vi.fn().mockResolvedValue({ error: null }),
    } },
    rpc: vi.fn().mockImplementation((fn: string) => Promise.resolve({ data: fn === 'waiter_username_state' ? { state: 'FREE' } : true, error: null })),
    from: vi.fn().mockImplementation((table: string) => {
      const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: table === 'tenants' ? { slug: 'loja-a' } : { id: MEMBER }, error: null }) };
      query.select.mockReturnValue(query); query.eq.mockReturnValue(query); queries[table] = query; return query;
    }),
  };
  factory = vi.fn().mockImplementation((_url: string, key: string) => key === env.anon ? caller : admin);
  handler = createWaiterAdminHandler(factory, env);
});

describe('waiter-admin authenticated boundary', () => {
  it('preflight supports current Supabase headers without creating a client', async () => {
    const response = await handler(new Request('https://edge.test', { method: 'OPTIONS' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('x-supabase-client-platform');
    expect(factory).not.toHaveBeenCalled();
  });

  it('requires a real authenticated user before a service-role client exists', async () => {
    expect((await post(createInput, '')).status).toBe(401);
    expect(factory).not.toHaveBeenCalled();
    caller.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Invalid JWT' } });
    expect((await post(createInput)).status).toBe(401);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(caller.rpc).not.toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('checks OWNER/MANAGER in the supplied store using the caller JWT', async () => {
    caller.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await post(createInput)).status).toBe(403);
    expect(caller.rpc).toHaveBeenCalledWith('is_tenant_owner_or_manager', { p_tenant_id: TENANT });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0][2].global.headers.Authorization).toBe('Bearer caller-jwt');
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('creates the scoped login with trusted app metadata and provisions the same store', async () => {
    const response = await post(createInput);
    expect(await response.json()).toEqual({ ok: true, userId: WAITER, username: 'joao' });
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: 'joao.loja-a@garcom.deliverychannel.local', password: 'senha123', email_confirm: true,
      user_metadata: { name: 'João Silva', waiter: true }, app_metadata: { waiter_tenant_id: TENANT },
    });
    expect(admin.rpc).toHaveBeenCalledWith('waiter_provision', expect.objectContaining({ p_tenant: TENANT, p_user: WAITER, p_created_by: OWNER, p_contact_email: 'contato@example.com' }));
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('returns the real friendly duplicate error instead of the generic create failure', async () => {
    admin.auth.admin.createUser.mockResolvedValueOnce({ data: { user: null }, error: { code: 'email_exists', message: 'A user with this email address has already been registered', status: 422 } });
    const response = await post(createInput);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'USERNAME_TAKEN', message: expect.stringMatching(/usuário já existe/) });
  });

  it('explains missing migration / legal provisioning and never leaks SQL', async () => {
    admin.auth.admin.createUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Database error saving new user: SQL auth.users legal_signup_check' } });
    const response = await post(createInput);
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result.code).toBe('WAITER_SETUP_REQUIRED');
    expect(result.message).toContain('atualização no servidor');
    expect(result.message).not.toMatch(/auth\.users|SQL|legal_signup_check/);
  });

  it('does not create an Auth orphan when the state RPC is unavailable', async () => {
    admin.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
    expect((await post(createInput)).status).toBe(503);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('rolls back only its newly created account when provisioning loses a username race', async () => {
    admin.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'waiter_provision'
      ? { error: { code: 'P0412', message: 'internal constraint detail' } } : { data: { state: 'FREE' }, error: null }));
    const response = await post(createInput);
    expect(response.status).toBe(409);
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledExactlyOnceWith(WAITER);
    expect((await response.json()).message).not.toContain('constraint');
  });

  it.each(['legacy', 'v2'])('revokes a %s waiter only in the selected store without deleting Auth', async () => {
    const response = await post({ action: 'delete', tenantId: TENANT, userId: WAITER });
    expect(await response.json()).toEqual({ ok: true });
    expect(queries.tenant_users.eq.mock.calls).toEqual([['tenant_id', TENANT], ['user_id', WAITER], ['role_id', 'WAITER']]);
    expect(caller.rpc).toHaveBeenCalledWith('remove_team_member', { p_tenant_user_id: MEMBER });
    expect(admin.rpc).not.toHaveBeenCalledWith('waiter_assert_member', expect.anything());
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('cannot revoke a user who has no waiter membership in this store', async () => {
    admin.from.mockImplementation((table: string) => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'tenants' ? { slug: 'loja-a' } : null, error: null }) }; return q;
    });
    expect((await post({ action: 'delete', tenantId: TENANT, userId: WAITER })).status).toBe(404);
    expect(caller.rpc).not.toHaveBeenCalledWith('remove_team_member', expect.anything());
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('does not return raw unexpected errors or credentials', async () => {
    caller.rpc.mockRejectedValueOnce(new Error('SQL auth.users password=secret service-key'));
    const result = await (await post(createInput)).json();
    expect(result.code).toBe('INTERNAL');
    expect(result.message).not.toMatch(/SQL|auth\.users|secret|service-key/);
  });
});
