import { supabase } from '../lib/supabase';
import { parseTableEntry, type TabInvite, type TableEntry } from '../lib/customer/tableAccess';

export class TableAccessError extends Error {
  constructor(message: string, readonly raw = message) { super(message); this.name = 'TableAccessError'; }
}
const fail = (error: { message?: string } | null): never => { throw new TableAccessError(String(error?.message || 'Falha na operação.')); };

export interface InvitePreview {
  available: boolean;
  valid: boolean;
  purpose?: 'GUEST' | 'HOLDER';
  tenantSlug?: string;
  storeName?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  tableLabel?: string;
  responsibleName?: string;
}

/** Customer-side calls of the "Responsável / convidado" model (migration 20261027004700). Each call is tenant-scoped on the server. */
export const tableAccessRepository = {
  async resolveInvite(token: string, code: string): Promise<InvitePreview | null> {
    try {
      const { data, error } = await supabase.rpc('resolve_table_invite', { p_qr_token: token, p_code: code });
      if (error || !data || typeof data !== 'object') return null;
      const d = data as Record<string, unknown>;
      return {
        available: d.available === true,
        valid: d.valid === true,
        purpose: d.purpose === 'HOLDER' ? 'HOLDER' : 'GUEST',
        tenantSlug: typeof d.tenantSlug === 'string' ? d.tenantSlug : undefined,
        storeName: typeof d.storeName === 'string' ? d.storeName : undefined,
        logoUrl: typeof d.logoUrl === 'string' ? d.logoUrl : null,
        primaryColor: typeof d.primaryColor === 'string' ? d.primaryColor : null,
        tableLabel: typeof d.tableLabel === 'string' ? d.tableLabel : undefined,
        responsibleName: typeof d.responsibleName === 'string' ? d.responsibleName : undefined,
      };
    } catch {
      return null;
    }
  },
  async enterTable(token: string, name: string, device: string): Promise<TableEntry> {
    const { data, error } = await supabase.rpc('enter_table', { p_qr_token: token, p_display_name: name, p_device_id: device });
    if (error) fail(error);
    const entry = parseTableEntry(data);
    if (!entry) throw new TableAccessError('Resposta inesperada do servidor.');
    return entry;
  },

  /** Wrong/expired/revoked code → { state: 'INVALID_CODE' } (never an exception, so attempts are counted). */
  async joinWithCode(token: string, code: string, name: string, device: string): Promise<{ entry: TableEntry | null; invalid: boolean; free: boolean }> {
    const { data, error } = await supabase.rpc('join_with_code', { p_qr_token: token, p_code: code, p_display_name: name, p_device_id: device });
    if (error) fail(error);
    const state = (data as { state?: string } | null)?.state;
    if (state === 'INVALID_CODE') return { entry: null, invalid: true, free: false };
    if (state === 'FREE') return { entry: null, invalid: false, free: true };
    const entry = parseTableEntry(data);
    if (!entry) throw new TableAccessError('Resposta inesperada do servidor.');
    return { entry, invalid: false, free: false };
  },

  async createInvite(sessionId: string, ttlMinutes = 15): Promise<TabInvite> {
    const { data, error } = await supabase.rpc('create_tab_invite', { p_session_id: sessionId, p_ttl_minutes: ttlMinutes });
    if (error) fail(error);
    return data as TabInvite;
  },
  async getInvite(sessionId: string): Promise<TabInvite | null> {
    const { data, error } = await supabase.rpc('get_tab_invite', { p_session_id: sessionId });
    if (error) fail(error);
    return (data as TabInvite | null) || null;
  },
  async revokeInvite(sessionId: string): Promise<void> {
    const { error } = await supabase.rpc('revoke_tab_invite', { p_session_id: sessionId });
    if (error) fail(error);
  },
  async removeGuest(sessionId: string, targetSessionId: string): Promise<void> {
    const { error } = await supabase.rpc('remove_tab_guest', { p_session_id: sessionId, p_target_session_id: targetSessionId });
    if (error) fail(error);
  },
  async transferResponsibility(sessionId: string, targetSessionId: string): Promise<void> {
    const { error } = await supabase.rpc('transfer_tab_responsibility', { p_session_id: sessionId, p_target_session_id: targetSessionId });
    if (error) fail(error);
  },
  /** Fire-and-forget: tells the staff alert that this customer is waiting. Never throws. */
  async pingPending(sessionId: string): Promise<void> {
    try { await supabase.rpc('ping_pending_approval', { p_session_id: sessionId }); } catch { /* best effort */ }
  },
};
