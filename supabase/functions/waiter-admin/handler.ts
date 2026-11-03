// Edge Function `waiter-admin` — gestão de garçons com login simples (usuário + senha).
// A SERVICE ROLE vive só aqui (servidor). A senha nunca é gravada em tabela própria nem registrada em log.
// Ações: create | reactivate | update | reset_password | set_active | delete
// Quem chama precisa ser OWNER/MANAGER da loja (validado com o JWT do chamador via is_tenant_owner_or_manager).
// deno-lint-ignore-file no-explicit-any
import { corsHeaders, json } from '../_shared/cors.ts';
import {
  cleanWaiterPhone, isValidWaiterPassword, isValidWaiterUsername, normalizeWaiterUsername, waiterSyntheticEmail,
} from '../_shared/waiterIdentity.ts';

const MAX_PHOTO_BYTES = 256 * 1024;

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, code, message, ...extra }, status);
}

async function uploadPhoto(admin: any, tenantId: string, userId: string, dataUrl: string): Promise<string> {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('PHOTO_INVALID');
  const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error('PHOTO_TOO_LARGE');
  const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
  const path = `${tenantId}/${userId}-${Date.now()}.${ext}`;
  const { error } = await admin.storage.from('waiter-photos').upload(path, bytes, { contentType: m[1], upsert: true });
  if (error) throw new Error('PHOTO_UPLOAD_FAILED');
  return admin.storage.from('waiter-photos').getPublicUrl(path).data.publicUrl as string;
}

export interface WaiterAdminEnv { url: string; anon: string; service: string }

/** A factory keeps the authenticated server boundary testable without Deno or real credentials. */
export function createWaiterAdminHandler(createClient: (...args: any[]) => any, env: WaiterAdminEnv) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');

    const { url, anon, service } = env;
    if (!url || !anon || !service) return fail(503, 'NOT_CONFIGURED', 'O cadastro de garçons está indisponível. Verifique a configuração do servidor.');
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return fail(401, 'UNAUTHENTICATED', 'Entre na sua conta para continuar.');

    let body: any;
    try { body = await req.json(); } catch { return fail(400, 'INVALID_INPUT', 'Requisição inválida.'); }
    const action = String(body?.action ?? '');
    const tenantId = String(body?.tenantId ?? '');
    const validId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    if (!validId(tenantId)) return fail(400, 'INVALID_INPUT', 'Loja inválida.');
    if (!['create', 'reactivate', 'update', 'reset_password', 'set_active', 'delete'].includes(action)) return fail(400, 'INVALID_INPUT', 'Ação desconhecida.');

    try {
      const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
      const { data: who } = await caller.auth.getUser();
      if (!who?.user) return fail(401, 'UNAUTHENTICATED', 'Sessão expirada. Entre novamente.');
      const { data: allowed, error: permissionError } = await caller.rpc('is_tenant_owner_or_manager', { p_tenant_id: tenantId });
      if (permissionError) return serverError(permissionError);
      if (allowed !== true) return fail(403, 'FORBIDDEN', 'Apenas o dono ou o gerente podem gerenciar garçons.');

      const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: tenant } = await admin.from('tenants').select('slug').eq('id', tenantId).maybeSingle();
      if (!tenant?.slug) return fail(404, 'NOT_FOUND', 'Loja não encontrada.');
      const userId = String(body?.userId ?? '');

      if (action === 'create') {
        const username = normalizeWaiterUsername(body?.username);
        const phone = cleanWaiterPhone(body?.phone);
        const name = String(body?.name ?? '').trim();
        if (name.length < 2 || name.length > 120) return fail(400, 'INVALID_INPUT', 'Informe o nome do garçom (2 a 120 caracteres).');
        if (!phone) return fail(400, 'INVALID_INPUT', 'Informe um telefone válido com DDD.');
        if (!isValidWaiterUsername(username)) return fail(400, 'INVALID_INPUT', 'Usuário: 3 a 24 caracteres (letras, números ou _).');
        if (!isValidWaiterPassword(body?.password)) return fail(400, 'INVALID_INPUT', 'A senha precisa ter pelo menos 6 caracteres.');

        const contactEmail = body?.contactEmail ? String(body.contactEmail).trim().toLowerCase() : null;
        if (contactEmail && (contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) return fail(400, 'INVALID_INPUT', 'Informe um e-mail de contato válido.');
        const { data: state, error: stateError } = await admin.rpc('waiter_username_state', { p_tenant: tenantId, p_username: username });
        if (stateError) return serverError(stateError);
        if (state?.state === 'ACTIVE') {
          return fail(409, 'USERNAME_ACTIVE', `O usuário "${username}" já faz parte da equipe desta loja. Escolha outro usuário ou edite o garçom existente.`);
        }
        if (state?.state === 'INACTIVE') {
          return fail(409, 'USERNAME_INACTIVE', `O usuário "${username}" já existe, mas está desativado. Deseja reativá-lo?`, { userId: state.user_id, canReactivate: true });
        }
        const email = waiterSyntheticEmail(username, tenant.slug);
        const created = await admin.auth.admin.createUser({
          email, password: String(body.password), email_confirm: true,
          user_metadata: { name, waiter: true }, app_metadata: { waiter_tenant_id: tenantId },
        });
        if (created.error || !created.data?.user) {
          const cmsg = String(created.error?.message || '');
          const ccode = String(created.error?.code || '');
          if (/email_exists|user_already_exists/.test(ccode) || /already.*(?:registered|exists)|duplicate/i.test(cmsg)) {
            return fail(409, 'USERNAME_TAKEN', 'O usuário já existe. Tente outro nome de usuário.');
          }
          if (/password/i.test(ccode + cmsg)) return fail(400, 'INVALID_INPUT', 'A senha não atende aos requisitos de segurança. Escolha uma senha mais forte.');
          if (ccode === 'email_address_invalid') return fail(400, 'INVALID_INPUT', 'O identificador de acesso da loja é inválido. Verifique o endereço da loja.');
          return serverError(created.error);
        }
        const newId = created.data.user.id;
        let photoUrl: string | null = null;
        try {
          if (typeof body?.photoDataUrl === 'string' && body.photoDataUrl) photoUrl = await uploadPhoto(admin, tenantId, newId, body.photoDataUrl);
          const { error } = await admin.rpc('waiter_provision', {
            p_tenant: tenantId, p_user: newId, p_name: name, p_phone: phone, p_username: username,
            p_synthetic_email: email, p_contact_email: contactEmail,
            p_photo_url: photoUrl, p_created_by: who.user.id,
          });
          if (error) throw error;
        } catch (e) {
          await admin.auth.admin.deleteUser(newId); // desfaz: não deixa conta órfã
          const code = (e as any)?.code;
          if (code === 'P0412') return fail(409, 'USERNAME_ACTIVE', `O usuário "${username}" já faz parte da equipe desta loja.`);
          const msg = (e as Error)?.message;
          if (msg === 'PHOTO_TOO_LARGE') return fail(400, 'INVALID_INPUT', 'A foto deve ter até 256 KB.');
          if (msg === 'PHOTO_INVALID') return fail(400, 'INVALID_INPUT', 'Foto inválida (use JPG, PNG ou WebP).');
          if (msg === 'PHOTO_UPLOAD_FAILED') return fail(503, 'PHOTO_UPLOAD_FAILED', 'Não foi possível salvar a foto. Tente novamente ou cadastre sem foto.');
          return serverError(e);
        }
        return json({ ok: true, userId: newId, username });
      }

      // Demais ações operam sobre um garçom existente DESTA loja.
      if (!validId(userId)) return fail(400, 'INVALID_INPUT', 'Garçom inválido.');
      if (action === 'delete') {
        // Legacy waiters have no waiter_profiles row. Revoke only this store membership;
        // the shared Auth identity and its access to other establishments are preserved.
        const { data: membership, error: memberError } = await admin.from('tenant_users').select('id')
          .eq('tenant_id', tenantId).eq('user_id', userId).eq('role_id', 'WAITER').maybeSingle();
        if (memberError) return serverError(memberError);
        if (!membership) return fail(404, 'NOT_FOUND', 'Garçom não encontrado nesta loja.');
        const { error } = await caller.rpc('remove_team_member', { p_tenant_user_id: membership.id });
        if (error) return serverError(error);
        return json({ ok: true });
      }
      const { data: member, error: assertError } = await admin.rpc('waiter_assert_member', { p_tenant: tenantId, p_user: userId });
      if (assertError) return serverError(assertError);
      if (member !== true) return fail(404, 'NOT_FOUND', 'Garçom não encontrado nesta loja.');

      if (action === 'update') {
        const phone = cleanWaiterPhone(body?.phone);
        if (!phone) return fail(400, 'INVALID_INPUT', 'Informe um telefone válido com DDD.');
        let photoUrl: string | null = null;
        const setPhoto = typeof body?.photoDataUrl === 'string' || body?.removePhoto === true;
        if (typeof body?.photoDataUrl === 'string' && body.photoDataUrl) photoUrl = await uploadPhoto(admin, tenantId, userId, body.photoDataUrl);
        const { error } = await admin.rpc('waiter_update_profile', {
          p_tenant: tenantId, p_user: userId, p_name: String(body?.name ?? ''), p_phone: phone, p_photo_url: photoUrl, p_set_photo: setPhoto,
        });
        if (error) return fail(400, 'INVALID_INPUT', 'Confira nome e telefone.');
        return json({ ok: true });
      }
      if (action === 'reset_password') {
        if (!isValidWaiterPassword(body?.password)) return fail(400, 'INVALID_INPUT', 'A senha precisa ter pelo menos 6 caracteres.');
        const { error } = await admin.auth.admin.updateUserById(userId, { password: String(body.password) });
        if (error) return fail(500, 'INTERNAL', 'Não foi possível redefinir a senha.');
        return json({ ok: true });
      }
      if (action === 'set_active' || action === 'reactivate') {
        const active = action === 'reactivate' ? true : body?.active === true;
        // A global Auth ban would also revoke legitimate access to other establishments.
        // The profile, membership, login RPC and RLS enforce deactivation in this store.
        if (action === 'reactivate' && body?.password && !isValidWaiterPassword(body.password)) return fail(400, 'INVALID_INPUT', 'A senha precisa ter de 6 a 72 caracteres.');
        if (active) {
          const { error: passwordError } = await admin.auth.admin.updateUserById(userId, {
            ban_duration: 'none',
            ...(action === 'reactivate' && isValidWaiterPassword(body?.password) ? { password: String(body.password) } : {}),
          });
          if (passwordError) return serverError(passwordError);
        }
        const { error } = await admin.rpc('waiter_set_active', { p_tenant: tenantId, p_user: userId, p_active: active });
        if (error) return fail(400, 'INVALID_INPUT', 'Não foi possível alterar o garçom.');
        return json({ ok: true });
      }
      return fail(400, 'INVALID_INPUT', 'Ação desconhecida.');
    } catch (e) {
      return serverError(e);
    }
  };
}

/** Exposes actionable causes, never SQL, tokens, stack traces or another store's data. */
function serverError(error: any): Response {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (['PGRST202', '42883'].includes(code) || /LEGAL_ACCEPTANCE_REQUIRED|database error saving new user/i.test(message)) {
    return fail(503, 'WAITER_SETUP_REQUIRED', 'O cadastro de garçons precisa de uma atualização no servidor. Solicite a atualização ao suporte.');
  }
  if (code === 'P0412' || code === '23505') return fail(409, 'USERNAME_TAKEN', 'O usuário já existe nesta loja. Escolha outro nome de usuário.');
  if (code === '42501') return fail(403, 'FORBIDDEN', 'Você não tem permissão para gerenciar garçons nesta loja.');
  if (code === '23514' || code === '22001') return fail(400, 'INVALID_INPUT', 'Confira o nome, o telefone e o e-mail de contato do garçom.');
  return fail(500, 'INTERNAL', 'Não foi possível concluir o cadastro. Tente novamente em instantes.');
}
