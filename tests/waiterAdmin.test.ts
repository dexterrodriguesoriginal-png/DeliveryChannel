import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWaiterAdminHandler } from '../supabase/functions/waiter-admin/handler';

const TENANT = '10000000-0000-0000-0000-000000000001';
const OWNER = '10000000-0000-0000-0000-000000000002';
const WAITER = '10000000-0000-0000-0000-000000000003';
const MEMBER = '10000000-0000-0000-0000-000000000004';
const env = { url: 'https://supabase.test', anon: 'anon-key', service: 'service-key' };
const createInput = { action: 'create', tenantId: TENANT, name: 'João Silva', phone: '(11) 99999-0000', username: 'joao', password: 'senha123', contactEmail: 'contato@example.com' };

let caller: any, admin: any, factory: any, storage: any, handler: ReturnType<typeof createWaiterAdminHandler>;
let queries: Record<string, any>;
const post = (body: Record<string, unknown>, token = 'caller-jwt') => handler(new Request('https://edge.test/waiter-admin', {
  method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  queries = {};
  storage = {
    upload: vi.fn().mockResolvedValue({ error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
    getPublicUrl: vi.fn().mockImplementation((path: string) => ({ data: { publicUrl: `https://storage.test/${path}` } })),
  };
  caller = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: OWNER } }, error: null }) }, rpc: vi.fn().mockResolvedValue({ data: true, error: null }) };
  admin = {
    storage: { from: vi.fn().mockReturnValue(storage) },
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
afterEach(() => vi.restoreAllMocks());

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

  it.each(['create', 'update', 'reset_password', 'set_active', 'reactivate', 'delete'])('enforces disabled team permission before service-role %s', async action => {
    caller.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    const response = await post({ ...createInput, action, userId: WAITER });
    expect(response.status).toBe(403);
    expect(caller.rpc).toHaveBeenCalledWith('has_store_permission', { p_tenant: TENANT, p_perm: 'manage_team' });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
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

  it('maps GoTrue creating-new-user trigger errors with the Auth stage', async () => {
    admin.auth.admin.createUser.mockResolvedValueOnce({ data: { user: null }, error: { code: 'unexpected_failure', status: 500, message: 'Database error creating new user' } });
    const response = await post({ ...createInput, photoDataUrl: 'data:image/png;base64,aGVsbG8=' });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'WAITER_SETUP_REQUIRED', stage: 'auth_create' });
    expect(console.error).toHaveBeenCalledWith('[waiter-admin]', 'create', 'auth_create', 'unexpected_failure', 500, 'Database error creating new user');
    expect(admin.rpc).not.toHaveBeenCalledWith('waiter_provision', expect.anything());
  });

  it.each([
    { code: 'email_exists', status: 422 },
    { status: 422, message: 'A user with this email address has already been registered' },
  ])('reuses a trusted orphan identity and provisions a previous membership (%j)', async (duplicate) => {
    admin.auth.admin.createUser.mockResolvedValueOnce({ data: { user: null }, error: duplicate });
    admin.rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'waiter_username_state' ? { state: 'FREE' } : fn === 'waiter_reusable_identity' ? WAITER : null, error: null }));
    const response = await post({ ...createInput, photoDataUrl: 'data:image/png;base64,aGVsbG8=' });
    expect(await response.json()).toMatchObject({ ok: true, userId: WAITER });
    expect(admin.rpc).toHaveBeenCalledWith('waiter_reusable_identity', { p_tenant: TENANT, p_username: 'joao' });
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledExactlyOnceWith(WAITER, {
      password: 'senha123', ban_duration: 'none', app_metadata: { waiter_tenant_id: TENANT },
    });
    expect(admin.rpc).toHaveBeenCalledWith('waiter_provision', expect.objectContaining({ p_tenant: TENANT, p_user: WAITER, p_photo_url: expect.stringContaining(TENANT), p_phone: '11999990000' }));
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('does not reset or delete an identity the scoped resolver rejects', async () => {
    admin.auth.admin.createUser.mockResolvedValueOnce({ data: {}, error: { code: 'email_exists' } });
    admin.rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'waiter_username_state' ? { state: 'FREE' } : null, error: null }));
    expect((await post(createInput)).status).toBe(409);
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('keeps a reused identity when membership provisioning fails', async () => {
    admin.auth.admin.createUser.mockResolvedValueOnce({ data: {}, error: { code: 'email_exists' } });
    admin.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'waiter_provision'
      ? { error: { code: '23505', message: 'duplicate user phone=11999990000 contato@example.com' } }
      : { data: fn === 'waiter_username_state' ? { state: 'FREE' } : WAITER, error: null }));
    const response = await post({ ...createInput, photoDataUrl: 'data:image/png;base64,aGVsbG8=' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'USERNAME_TAKEN', stage: 'provision' });
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith([expect.stringContaining(`${TENANT}/${WAITER}-`)]);
  });

  it('rejects an oversized photo before creating or resetting an Auth identity', async () => {
    const response = await post({ ...createInput, photoDataUrl: `data:image/jpeg;base64,${'a'.repeat(349532)}` });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'PHOTO_TOO_LARGE', stage: 'photo', message: expect.stringContaining('256 KB') });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(admin.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it.each(['data:image/svg+xml;base64,aGVsbG8=', 'data:image/png;base64,a==='])('rejects invalid photos (%s)', async (photoDataUrl) => {
    const response = await post({ ...createInput, photoDataUrl });
    expect(await response.json()).toMatchObject({ code: 'PHOTO_INVALID', stage: 'photo' });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('maps a missing photo bucket to a setup action and removes its new Auth account', async () => {
    storage.upload.mockResolvedValueOnce({ error: { statusCode: '404', message: 'Bucket not found' } });
    const response = await post({ ...createInput, photoDataUrl: 'data:image/png;base64,aGVsbG8=' });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'PHOTO_BUCKET_MISSING', stage: 'photo', message: expect.stringContaining('cadastre sem foto') });
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledExactlyOnceWith(WAITER);
    expect(admin.rpc).not.toHaveBeenCalledWith('waiter_provision', expect.anything());
  });

  it.each([false, true])('maps returned and thrown storage errors safely (thrown=%s)', async (thrown) => {
    const storageError = { code: 'AccessDenied', statusCode: 403, message: 'upload failed phone=11999990000 contato@example.com service-key senha123' };
    if (thrown) storage.upload.mockRejectedValueOnce(storageError);
    else storage.upload.mockResolvedValueOnce({ error: storageError });
    const response = await post({ ...createInput, photoDataUrl: 'data:image/webp;base64,aGVsbG8=' });
    expect(await response.json()).toMatchObject({ code: 'PHOTO_UPLOAD_FAILED', stage: 'photo' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/11999990000|contato@example|service-key|senha123/);
  });

  it('logs a failed rollback separately and preserves the original diagnostic stage', async () => {
    admin.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'waiter_provision'
      ? { error: { code: '23505', message: 'private SQL detail' } } : { data: { state: 'FREE' }, error: null }));
    admin.auth.admin.deleteUser.mockResolvedValueOnce({ error: { code: 'unexpected_failure', status: 500, message: 'secret rollback error' } });
    const response = await post(createInput);
    expect(await response.json()).toMatchObject({ code: 'USERNAME_TAKEN', stage: 'provision' });
    expect(console.error).toHaveBeenCalledWith('[waiter-admin]', 'create', 'rollback', 'unexpected_failure', 500, 'Server operation failed');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private|SQL|secret/);
  });

  it('includes a safe diagnostic stage for truly unexpected create errors', async () => {
    admin.auth.admin.createUser.mockResolvedValueOnce({ data: {}, error: { code: 'secret-key', message: 'contato@example.com 11999990000 senha123 service-key caller-jwt', status: 500 } });
    const result = await (await post(createInput)).json();
    expect(result).toMatchObject({ code: 'INTERNAL', stage: 'auth_create' });
    expect(JSON.stringify(result) + JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/contato@example|11999990000|senha123|service-key|caller-jwt|secret-key/);
  });
});
