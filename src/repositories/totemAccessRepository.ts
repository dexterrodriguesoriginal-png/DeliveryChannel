import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { requireBackend } from '../lib/backend';
import type { SecurityContext } from '../services/securityEngine';
import { canManageMenuTheme } from './menuThemeRepository';
import { mapPublicStorePayload, type PublicStoreData } from './publicStoreMapper';
import { mapN6PublicStore } from './publicStoreN6';
import { isN1N6Backend } from '../lib/backendSchema';
import { DEFAULT_TOTEM_WELCOME, normalizeTotemWelcome, type TotemWelcomeSettings } from '../lib/menu/totemWelcome';
import { DEFAULT_TOTEM_DESIGN, normalizeTotemDesign, type TotemDesign } from '../lib/menu/totemDesign';
import { clearTotemDeviceSession, readTotemDeviceSession, writeTotemDeviceSession, type TotemDeviceSession } from '../lib/totem/totemDeviceSession';

function authorize(context: SecurityContext, tenantId: string): void {
  if (!canManageMenuTheme(context, tenantId)) {
    throw new Error('Apenas o dono ou gerente desta loja gerencia os usuários do totem.');
  }
  requireBackend('Totem do salão');
}

export interface TotemLoginInfo {
  tenantId: string;
  slug: string;
  name: string;
  logoUrl?: string;
  accent?: string;
}

export interface TotemUserRow {
  id: string;
  label: string;
  username: string;
  isActive: boolean;
  createdAt?: string;
  activeDevice?: { id: string; label: string; lastSeenAt?: string | null; createdAt?: string } | null;
}

export interface TotemDeviceRow {
  id: string;
  label: string;
  kind: 'TOTEM_USER' | 'STAFF';
  userId?: string | null;
  userLabel?: string | null;
  username?: string | null;
  createdAt?: string;
  lastSeenAt?: string | null;
  revokedAt?: string | null;
  active: boolean;
}

export type TotemActivateResult =
  | { ok: true; token: string; deviceId: string; label: string; userLabel?: string; revokedDeviceId?: string | null; kind?: string }
  | { ok: false; reason: 'ACTIVE_DEVICE'; message: string; device: { id: string; label: string; lastSeenAt?: string | null } };

export interface TotemStoreLoad {
  data: PublicStoreData;
  design: TotemDesign;
  welcome: TotemWelcomeSettings;
}

const resolvePublicMedia = (bucket: 'marketing-public', path: string): string =>
  supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;

function mapStore(payload: unknown): PublicStoreData {
  return isN1N6Backend()
    ? mapN6PublicStore(payload, resolvePublicMedia, Date.now())
    : mapPublicStorePayload(payload, Date.now());
}

function rpcMessage(error: { message?: string } | null, fallback: string): string {
  const raw = error?.message || '';
  if (/RATE_LIMITED/i.test(raw)) return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
  if (/TOTEM_AUTH_FAILED/i.test(raw)) return 'Usuário ou senha inválidos.';
  if (/TOTEM_DEVICE_INVALID/i.test(raw)) return 'Este totem não está ativado ou foi desativado.';
  if (/TOTEM_USER_EXISTS/i.test(raw)) return 'Já existe um usuário do totem com esse nome.';
  if (/INVALID_TOTEM_PASSWORD/i.test(raw)) return 'Use uma senha de 8 a 72 caracteres.';
  if (/INVALID_TOTEM_USER/i.test(raw)) return 'O usuário deve ter 3 a 32 caracteres (letras, números, ponto, _ ou -).';
  if (/FORBIDDEN/i.test(raw)) return 'Somente o dono ou o gerente pode fazer isso.';
  if (/RATE_LIMITED.*pedido/i.test(raw)) return 'Muitos pedidos neste totem. Aguarde um pouco.';
  return fallback;
}

export interface TotemPaymentState {
  ok: boolean;
  orderId: string;
  total: number;
  paymentStatus: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'DECLINED';
  paymentLabel: string;
  pickupCode?: string;
  expiresAt?: string;
  autoPrint?: boolean;
  idempotent?: boolean;
}

export const totemAccessRepository = {
  async loadLogin(slug: string): Promise<TotemLoginInfo | null> {
    if (!isSupabaseConfigured || !slug) return null;
    const { data, error } = await supabase.rpc('get_public_totem_login', { p_slug: slug });
    if (error) throw new Error('Não foi possível carregar o totem.');
    if (!data || typeof data !== 'object') return null;
    const row = data as Record<string, unknown>;
    if (typeof row.tenantId !== 'string' && typeof row.slug !== 'string') return null;
    return {
      tenantId: String(row.tenantId || ''),
      slug: String(row.slug || slug),
      name: String(row.name || 'Totem'),
      logoUrl: typeof row.logoUrl === 'string' ? row.logoUrl : undefined,
      accent: typeof row.accent === 'string' ? row.accent : undefined,
    };
  },

  readSession(slug: string): TotemDeviceSession | null {
    return readTotemDeviceSession(slug);
  },

  saveSession(slug: string, session: TotemDeviceSession): void {
    writeTotemDeviceSession(slug, session);
  },

  clearSession(slug: string): void {
    clearTotemDeviceSession(slug);
  },

  async loadCurrent(token: string): Promise<{ ok: true; design: TotemDesign; welcome: TotemWelcomeSettings; name: string; logoUrl?: string; tenantId: string; label: string } | { ok: false }> {
    const { data, error } = await supabase.rpc('totem_current_device', { p_token: token });
    if (error || !data || (data as { ok?: boolean }).ok !== true) return { ok: false };
    const row = data as Record<string, unknown>;
    return {
      ok: true,
      design: normalizeTotemDesign(row.design),
      welcome: normalizeTotemWelcome(row.welcome ?? DEFAULT_TOTEM_WELCOME),
      name: String(row.name || 'Totem'),
      logoUrl: typeof row.logoUrl === 'string' ? row.logoUrl : undefined,
      tenantId: String(row.tenantId || ''),
      label: String(row.label || 'Totem'),
    };
  },

  async loadStore(token: string): Promise<{ status: 'ok'; store: TotemStoreLoad } | { status: 'invalid' } | { status: 'error'; message: string }> {
    const { data, error } = await supabase.rpc('get_totem_store', { p_token: token });
    if (error) {
      if (/TOTEM_DEVICE_INVALID/i.test(error.message)) return { status: 'invalid' };
      return { status: 'error', message: rpcMessage(error, 'Não foi possível carregar o cardápio do totem.') };
    }
    if (!data) return { status: 'invalid' };
    try {
      const row = data as Record<string, unknown>;
      const { totemDesign, totemWelcome, totemDeviceId, totemDeviceLabel, ...storePayload } = row;
      return {
        status: 'ok',
        store: {
          data: mapStore(storePayload),
          design: normalizeTotemDesign(totemDesign ?? DEFAULT_TOTEM_DESIGN),
          welcome: normalizeTotemWelcome(totemWelcome ?? DEFAULT_TOTEM_WELCOME),
        },
      };
    } catch (reason) {
      return { status: 'error', message: reason instanceof Error ? reason.message : 'Cardápio inválido.' };
    }
  },

  async activateUser(opts: {
    slug: string; username: string; password: string; deviceLabel: string; confirmRevoke?: boolean;
  }): Promise<TotemActivateResult> {
    const { data, error } = await supabase.rpc('totem_activate', {
      p_slug: opts.slug,
      p_username: opts.username,
      p_password: opts.password,
      p_device_label: opts.deviceLabel,
      p_confirm_revoke: Boolean(opts.confirmRevoke),
      p_ip_hash: null,
    });
    if (error) throw new Error(rpcMessage(error, 'Não foi possível ativar o totem.'));
    const row = data as TotemActivateResult;
    if (row && row.ok === false && row.reason === 'ACTIVE_DEVICE') return row;
    if (!row || row.ok !== true || !row.token) throw new Error('Não foi possível ativar o totem.');
    return row;
  },

  async activateAsStaff(slug: string, deviceLabel: string, email: string, password: string): Promise<TotemActivateResult> {
    const { error: signError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signError) throw new Error('E-mail ou senha do dono/gerente inválidos.');
    try {
      const { data, error } = await supabase.rpc('totem_activate_as_staff', { p_slug: slug, p_device_label: deviceLabel });
      if (error) throw new Error(rpcMessage(error, 'Não foi possível ativar o totem com esta conta.'));
      const row = data as TotemActivateResult;
      if (!row || row.ok !== true || !row.token) throw new Error('Não foi possível ativar o totem.');
      return row;
    } finally {
      await supabase.auth.signOut();
    }
  },

  async createOrder(token: string, items: Array<{ productId: string; quantity: number; notes?: string }>, idempotencyKey: string): Promise<TotemPaymentState> {
    const { data, error } = await supabase.rpc('create_totem_order', {
      p_token: token,
      p_items: items,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(rpcMessage(error, 'Não foi possível registrar o pedido.'));
    const row = data as TotemPaymentState;
    if (!row?.ok || !row.orderId) throw new Error('Não foi possível registrar o pedido.');
    return row;
  },

  async getPaymentStatus(token: string, orderId: string): Promise<TotemPaymentState> {
    const { data, error } = await supabase.rpc('get_totem_payment_status', {
      p_token: token, p_order_id: orderId,
    });
    if (error) throw new Error(rpcMessage(error, 'Não foi possível consultar o pagamento.'));
    return data as TotemPaymentState;
  },

  async cancelPayment(token: string, orderId: string): Promise<void> {
    const { error } = await supabase.rpc('cancel_totem_payment', { p_token: token, p_order_id: orderId });
    if (error) throw new Error(rpcMessage(error, 'Não foi possível cancelar o pedido.'));
  },

  async confirmManualPayment(orderId: string): Promise<void> {
    const { error } = await supabase.rpc('confirm_manual_totem_payment', { p_order_id: orderId });
    if (error) throw new Error('Não foi possível confirmar o pagamento deste pedido.');
  },

  async listUsers(context: SecurityContext, tenantId: string): Promise<TotemUserRow[]> {
    authorize(context, tenantId);
    const { data, error } = await supabase.rpc('admin_list_totem_users', { p_tenant: tenantId });
    if (error) throw new Error(rpcMessage(error, 'Não foi possível listar os usuários do totem.'));
    return Array.isArray(data) ? data as TotemUserRow[] : [];
  },

  async createUser(context: SecurityContext, tenantId: string, input: { label: string; username: string; password: string }): Promise<TotemUserRow> {
    authorize(context, tenantId);
    const { data, error } = await supabase.rpc('admin_create_totem_user', {
      p_tenant: tenantId, p_label: input.label, p_username: input.username, p_password: input.password,
    });
    if (error) throw new Error(rpcMessage(error, 'Não foi possível criar o usuário do totem.'));
    return data as TotemUserRow;
  },

  async setUserPassword(context: SecurityContext, tenantId: string, userId: string, password: string): Promise<void> {
    authorize(context, tenantId);
    const { error } = await supabase.rpc('admin_set_totem_user_password', { p_tenant: tenantId, p_user: userId, p_password: password });
    if (error) throw new Error(rpcMessage(error, 'Não foi possível trocar a senha.'));
  },

  async setUserActive(context: SecurityContext, tenantId: string, userId: string, active: boolean): Promise<void> {
    authorize(context, tenantId);
    const { error } = await supabase.rpc('admin_set_totem_user_active', { p_tenant: tenantId, p_user: userId, p_active: active });
    if (error) throw new Error(rpcMessage(error, 'Não foi possível atualizar o usuário.'));
  },

  async listDevices(context: SecurityContext, tenantId: string): Promise<TotemDeviceRow[]> {
    authorize(context, tenantId);
    const { data, error } = await supabase.rpc('admin_list_totem_devices', { p_tenant: tenantId });
    if (error) throw new Error(rpcMessage(error, 'Não foi possível listar os dispositivos.'));
    return Array.isArray(data) ? data as TotemDeviceRow[] : [];
  },

  async revokeDevice(context: SecurityContext, tenantId: string, deviceId: string): Promise<void> {
    authorize(context, tenantId);
    const { error } = await supabase.rpc('admin_revoke_totem_device', { p_tenant: tenantId, p_device: deviceId });
    if (error) throw new Error(rpcMessage(error, 'Não foi possível desativar o dispositivo.'));
  },
};
