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
type Stage = 'username_state' | 'auth_create' | 'photo' | 'provision' | 'rollback';

/** Provider messages may contain email, phone, SQL values or credentials. Log a
 * bounded diagnostic vocabulary, never the raw error or request body. */
function logError(action: string, stage: Stage, error: any) {
  const codeValue = String(error?.code ?? '');
  const code = /^(?:P\d{4}|\d{5}|PGRST\d{3}|unexpected_failure|email_exists|user_already_exists|email_already_exists|email_address_invalid|weak_password|validation_failed|over_request_rate_limit|NoSuchBucket)$/.test(codeValue) ? codeValue : 'UNKNOWN';
  const status = Number(error?.status ?? error?.statusCode);
  const message = diagnosticMessage(error);
  console.error('[waiter-admin]', action, stage, code, Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined, message.slice(0, 200));
}

function diagnosticMessage(error: any): string {
  const message = String(error?.message ?? '');
  if (/database error (?:creating|saving) new user/i.test(message)) return 'Database error creating new user';
  if (/LEGAL_ACCEPTANCE_REQUIRED/i.test(message)) return 'LEGAL_ACCEPTANCE_REQUIRED';
  if (isDuplicateIdentity(error)) return 'Auth identity already exists';
  if (/bucket.*not found|bucket.*does not exist/i.test(message)) return 'Photo bucket unavailable';
  if (/^PHOTO_(?:INVALID|TOO_LARGE|UPLOAD_FAILED|BUCKET_MISSING)$/.test(message)) return message;
  if (/TOOL_DISABLED/.test(message)) return 'TOOL_DISABLED';
  return 'Server operation failed';
}

function isDuplicateIdentity(error: any): boolean {
  return /^(?:email_exists|user_already_exists|email_already_exists)$/.test(String(error?.code ?? ''))
    || /already.*(?:registered|exists)|duplicate/i.test(String(error?.message ?? ''));
}

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, code, message, ...extra }, status);
}

function decodePhoto(dataUrl: string): { bytes: Uint8Array; contentType: string; ext: string } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('PHOTO_INVALID');
  // Reject oversized input before allocating its decoded representation.
  if (m[2].length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4) throw new Error('PHOTO_TOO_LARGE');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); } catch { throw new Error('PHOTO_INVALID'); }
  if (!bytes.byteLength) throw new Error('PHOTO_INVALID');
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error('PHOTO_TOO_LARGE');
  const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
  return { bytes, contentType: m[1], ext };
}

async function uploadPhoto(admin: any, tenantId: string, userId: string, dataUrl: string): Promise<{ url: string; path: string }> {
  const { bytes, contentType, ext } = decodePhoto(dataUrl);
  const path = `${tenantId}/${userId}-${Date.now()}.${ext}`;
  try {
    const { error } = await admin.storage.from('waiter-photos').upload(path, bytes, { contentType, upsert: true });
    if (error) throw error;
    return { url: admin.storage.from('waiter-photos').getPublicUrl(path).data.publicUrl as string, path };
  } catch (error: any) {
    const message = /bucket.*not found|bucket.*does not exist/i.test(String(error?.message ?? '')) || error?.code === 'NoSuchBucket'
      ? 'PHOTO_BUCKET_MISSING' : 'PHOTO_UPLOAD_FAILED';
    throw Object.assign(new Error(message), { code: error?.code, status: error?.status ?? error?.statusCode });
  }
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

    let stage: Stage = 'username_state';
    try {
      const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
      const { data: who } = await caller.auth.getUser();
      if (!who?.user) return fail(401, 'UNAUTHENTICATED', 'Sessão expirada. Entre novamente.');
      const { data: allowed, error: permissionError } = await caller.rpc('is_tenant_owner_or_manager', { p_tenant_id: tenantId });
      if (permissionError) return serverError(permissionError, action, stage);
      if (allowed !== true) return fail(403, 'FORBIDDEN', 'Apenas o dono ou o gerente podem gerenciar garçons.');
      const { data: canManageTeam, error: teamPermissionError } = await caller.rpc('has_store_permission', { p_tenant: tenantId, p_perm: 'manage_team' });
      if (teamPermissionError) return serverError(teamPermissionError, action, stage);
      if (canManageTeam !== true) return fail(403, 'FORBIDDEN', 'Você não tem permissão para gerenciar a equipe desta loja.');

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
        stage = 'photo';
        // Validate before creating/resetting any identity. The upload still happens
        // below, once we have the scoped Auth ID.
        if (typeof body?.photoDataUrl === 'string' && body.photoDataUrl) decodePhoto(body.photoDataUrl);
        stage = 'username_state';
        const { data: state, error: stateError } = await admin.rpc('waiter_username_state', { p_tenant: tenantId, p_username: username });
        if (stateError) return serverError(stateError, action, stage);
        if (state?.state === 'ACTIVE') {
          return fail(409, 'USERNAME_ACTIVE', `O usuário "${username}" já faz parte da equipe desta loja. Escolha outro usuário ou edite o garçom existente.`, { stage });
        }
        if (state?.state === 'INACTIVE') {
          return fail(409, 'USERNAME_INACTIVE', `O usuário "${username}" já existe, mas está desativado. Deseja reativá-lo?`, { userId: state.user_id, canReactivate: true, stage });
        }
        const email = waiterSyntheticEmail(username, tenant.slug);
        stage = 'auth_create';
        const created = await admin.auth.admin.createUser({
          email, password: String(body.password), email_confirm: true,
          user_metadata: { name, waiter: true }, app_metadata: { waiter_tenant_id: tenantId },
        });
        let newId = created.data?.user?.id as string | undefined;
        let newlyCreated = !created.error && !!newId;
        if (created.error || !newId) {
          if (!isDuplicateIdentity(created.error)) return serverError(created.error, action, stage);
          logError(action, stage, created.error);
          // This SECURITY DEFINER RPC is service-role-only and resolves the
          // exact synthetic identity of THIS store. It rejects foreign or
          // privileged memberships and never searches/list Auth users globally.
          stage = 'username_state';
          const { data: reusableId, error: reuseError } = await admin.rpc('waiter_reusable_identity', { p_tenant: tenantId, p_username: username });
          if (reuseError) return serverError(reuseError, action, stage);
          if (typeof reusableId !== 'string' || !validId(reusableId)) {
            return fail(409, 'USERNAME_TAKEN', 'O usuário já existe. Tente outro nome de usuário.', { stage });
          }
          newId = reusableId;
          newlyCreated = false;
        }
        let photoUrl: string | null = null;
        let photoPath: string | null = null;
        try {
          stage = 'photo';
          if (typeof body?.photoDataUrl === 'string' && body.photoDataUrl) {
            const photo = await uploadPhoto(admin, tenantId, newId, body.photoDataUrl);
            photoUrl = photo.url;
            photoPath = photo.path;
          }
          if (!newlyCreated) {
            stage = 'auth_create';
            const { error: resetError } = await admin.auth.admin.updateUserById(newId, {
              password: String(body.password), ban_duration: 'none', app_metadata: { waiter_tenant_id: tenantId },
            });
            if (resetError) throw resetError;
          }
          stage = 'provision';
          const { error } = await admin.rpc('waiter_provision', {
            p_tenant: tenantId, p_user: newId, p_name: name, p_phone: phone, p_username: username,
            p_synthetic_email: email, p_contact_email: contactEmail,
            p_photo_url: photoUrl, p_created_by: who.user.id,
          });
          if (error) throw error;
        } catch (e) {
          // Never delete a reused Auth identity: it predates this request.
          // Rollback errors are logged separately without replacing the cause.
          if (newlyCreated) {
            try {
              const rollback = await admin.auth.admin.deleteUser(newId);
              if (rollback.error) logError(action, 'rollback', rollback.error);
            } catch (rollbackError) { logError(action, 'rollback', rollbackError); }
          }
          if (photoPath) {
            try {
              const rollback = await admin.storage.from('waiter-photos').remove([photoPath]);
              if (rollback.error) logError(action, 'rollback', rollback.error);
            } catch (rollbackError) { logError(action, 'rollback', rollbackError); }
          }
          return serverError(e, action, stage);
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
        if (memberError) return serverError(memberError, action, stage);
        if (!membership) return fail(404, 'NOT_FOUND', 'Garçom não encontrado nesta loja.');
        const { error } = await caller.rpc('remove_team_member', { p_tenant_user_id: membership.id });
        if (error) return serverError(error, action, stage);
        return json({ ok: true });
      }
      // A historical waiter profile is not authority to mutate global Auth.
      // SQL also verifies the current WAITER membership and an exclusive,
      // trusted synthetic identity for this store before any side effect.
      const { data: member, error: assertError } = await admin.rpc('waiter_assert_member', { p_tenant: tenantId, p_user: userId });
      if (assertError) return serverError(assertError, action, stage);
      if (member !== true) return fail(403, 'IDENTITY_NOT_MANAGED', 'Esta conta não pode ser alterada pelo cadastro de garçons desta loja.');

      if (action === 'update') {
        const phone = cleanWaiterPhone(body?.phone);
        if (!phone) return fail(400, 'INVALID_INPUT', 'Informe um telefone válido com DDD.');
        let photoUrl: string | null = null;
        const setPhoto = typeof body?.photoDataUrl === 'string' || body?.removePhoto === true;
        stage = 'photo';
        if (typeof body?.photoDataUrl === 'string' && body.photoDataUrl) photoUrl = (await uploadPhoto(admin, tenantId, userId, body.photoDataUrl)).url;
        stage = 'provision';
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
          if (passwordError) return serverError(passwordError, action, stage);
        }
        const { error } = await admin.rpc('waiter_set_active', { p_tenant: tenantId, p_user: userId, p_active: active });
        if (error) return fail(400, 'INVALID_INPUT', 'Não foi possível alterar o garçom.');
        return json({ ok: true });
      }
      return fail(400, 'INVALID_INPUT', 'Ação desconhecida.');
    } catch (e) {
      return serverError(e, action, stage);
    }
  };
}

/** Exposes actionable causes, never SQL, tokens, stack traces or another store's data. */
function serverError(error: any, action: string, stage: Stage): Response {
  logError(action, stage, error);
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  const extra = { stage };
  if (['PGRST202', '42883'].includes(code) || /LEGAL_ACCEPTANCE_REQUIRED|database error (?:creating|saving) new user/i.test(message)) {
    return fail(503, 'WAITER_SETUP_REQUIRED', 'O cadastro de garçons precisa de uma atualização no servidor. Solicite a atualização ao suporte.', extra);
  }
  if (code === 'P0412' || code === '23505' || isDuplicateIdentity(error)) return fail(409, 'USERNAME_TAKEN', 'O usuário já existe nesta loja. Escolha outro nome de usuário.', extra);
  if (/TOOL_DISABLED/.test(message)) return fail(403, 'TOOL_DISABLED', 'A ferramenta Garçom está desativada. Peça ao dono da loja para ativá-la em Ferramentas.', extra);
  if (code === '42501') return fail(403, 'FORBIDDEN', 'Você não tem permissão para gerenciar garçons nesta loja.', extra);
  if (message === 'PHOTO_TOO_LARGE') return fail(400, 'PHOTO_TOO_LARGE', 'A foto deve ter até 256 KB. Escolha uma imagem menor.', extra);
  if (message === 'PHOTO_INVALID') return fail(400, 'PHOTO_INVALID', 'Foto inválida. Use uma imagem JPG, PNG ou WebP.', extra);
  if (message === 'PHOTO_BUCKET_MISSING') return fail(503, 'PHOTO_BUCKET_MISSING', 'O armazenamento de fotos precisa ser configurado. Solicite ao suporte ou cadastre sem foto.', extra);
  if (message === 'PHOTO_UPLOAD_FAILED') return fail(503, 'PHOTO_UPLOAD_FAILED', 'Não foi possível salvar a foto. Tente novamente ou cadastre sem foto.', extra);
  if (stage === 'auth_create' && (/weak_password/.test(code) || /password.*(?:weak|short|least|security|length|characters)|(?:weak|short).*password/i.test(message))) return fail(400, 'INVALID_INPUT', 'A senha não atende aos requisitos de segurança. Escolha uma senha mais forte.', extra);
  if (code === 'email_address_invalid') return fail(400, 'INVALID_INPUT', 'O identificador de acesso da loja é inválido. Verifique o endereço da loja.', extra);
  if (code === '23514' || code === '22001') return fail(400, 'INVALID_INPUT', 'Confira o nome, o telefone e o e-mail de contato do garçom.', extra);
  return fail(500, 'INTERNAL', 'Não foi possível concluir o cadastro. Tente novamente em instantes.', extra);
}
