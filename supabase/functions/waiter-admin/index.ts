// Edge Function `waiter-admin` — gestão de garçons com login simples (usuário + senha).
// A SERVICE ROLE vive só aqui (servidor). A senha nunca é gravada em tabela própria nem registrada em log.
// Ações: create | reactivate | update | reset_password | set_active | delete
// Quem chama precisa ser OWNER/MANAGER da loja (validado com o JWT do chamador via is_tenant_owner_or_manager).
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return fail(401, 'UNAUTHENTICATED', 'Entre na sua conta para continuar.');

  let body: any;
  try { body = await req.json(); } catch { return fail(400, 'INVALID_INPUT', 'Requisição inválida.'); }
  const action = String(body?.action ?? '');
  const tenantId = String(body?.tenantId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return fail(400, 'INVALID_INPUT', 'Loja inválida.');

  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: who } = await caller.auth.getUser();
  if (!who?.user) return fail(401, 'UNAUTHENTICATED', 'Sessão expirada. Entre novamente.');
  const { data: allowed } = await caller.rpc('is_tenant_owner_or_manager', { p_tenant_id: tenantId });
  if (allowed !== true) return fail(403, 'FORBIDDEN', 'Apenas o dono ou o gerente podem gerenciar garçons.');

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: tenant } = await admin.from('tenants').select('slug').eq('id', tenantId).maybeSingle();
  if (!tenant?.slug) return fail(404, 'NOT_FOUND', 'Loja não encontrada.');
  const userId = String(body?.userId ?? '');

  try {
    if (action === 'create') {
      const username = normalizeWaiterUsername(body?.username);
      const phone = cleanWaiterPhone(body?.phone);
      const name = String(body?.name ?? '').trim();
      if (name.length < 2) return fail(400, 'INVALID_INPUT', 'Informe o nome do garçom.');
      if (!phone) return fail(400, 'INVALID_INPUT', 'Informe um telefone válido com DDD.');
      if (!isValidWaiterUsername(username)) return fail(400, 'INVALID_INPUT', 'Usuário: 3 a 24 caracteres (letras, números ou _).');
      if (!isValidWaiterPassword(body?.password)) return fail(400, 'INVALID_INPUT', 'A senha precisa ter pelo menos 6 caracteres.');

      const { data: state } = await admin.rpc('waiter_username_state', { p_tenant: tenantId, p_username: username });
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
      if (created.error || !created.data.user) return fail(409, 'USERNAME_TAKEN', 'Não foi possível criar este usuário. Tente outro nome de usuário.');
      const newId = created.data.user.id;
      let photoUrl: string | null = null;
      try {
        if (typeof body?.photoDataUrl === 'string' && body.photoDataUrl) photoUrl = await uploadPhoto(admin, tenantId, newId, body.photoDataUrl);
        const { error } = await admin.rpc('waiter_provision', {
          p_tenant: tenantId, p_user: newId, p_name: name, p_phone: phone, p_username: username,
          p_synthetic_email: email, p_contact_email: body?.contactEmail ? String(body.contactEmail).trim().toLowerCase() : null,
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
        return fail(500, 'INTERNAL', 'Não foi possível cadastrar o garçom. Tente novamente.');
      }
      return json({ ok: true, userId: newId, username });
    }

    // Demais ações operam sobre um garçom existente DESTA loja.
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return fail(400, 'INVALID_INPUT', 'Garçom inválido.');
    const { data: member } = await admin.rpc('waiter_assert_member', { p_tenant: tenantId, p_user: userId });
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
      await admin.auth.admin.signOut(userId, 'global').catch(() => undefined); // derruba sessões antigas
      return json({ ok: true });
    }
    if (action === 'set_active' || action === 'reactivate') {
      const active = action === 'reactivate' ? true : body?.active === true;
      const { error } = await admin.rpc('waiter_set_active', { p_tenant: tenantId, p_user: userId, p_active: active });
      if (error) return fail(400, 'INVALID_INPUT', 'Não foi possível alterar o garçom.');
      await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '87600h' });
      if (!active) await admin.auth.admin.signOut(userId, 'global').catch(() => undefined);
      if (action === 'reactivate' && isValidWaiterPassword(body?.password)) {
        await admin.auth.admin.updateUserById(userId, { password: String(body.password) });
      }
      return json({ ok: true });
    }
    if (action === 'delete') {
      const { error } = await admin.auth.admin.deleteUser(userId); // cascata remove perfil/vínculo; histórico fica com waiter_id nulo
      if (error) return fail(500, 'INTERNAL', 'Não foi possível excluir o garçom.');
      return json({ ok: true });
    }
    return fail(400, 'INVALID_INPUT', 'Ação desconhecida.');
  } catch {
    return fail(500, 'INTERNAL', 'Erro inesperado. Tente novamente.');
  }
});
