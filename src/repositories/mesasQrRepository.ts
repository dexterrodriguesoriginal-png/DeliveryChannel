import { supabase } from '../lib/supabase';
import { toBackendError } from '../lib/backend';

/** What the connected database supports. Everything new is hidden until the migration 20261027004600 is applied. */
export interface MesasQrCapabilities { available: boolean; qrPause: boolean; tabPix: boolean }
export const NO_CAPABILITIES: MesasQrCapabilities = { available: false, qrPause: false, tabPix: false };

export const isMissingSchemaError = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code || '') ||
    /could not find the (table|function)|does not exist|schema cache/i.test(error.message || ''));

export function parseCapabilities(data: unknown): MesasQrCapabilities {
  if (!data || typeof data !== 'object') return NO_CAPABILITIES;
  const d = data as Record<string, unknown>;
  if (Number(d.version) < 1) return NO_CAPABILITIES;
  return { available: true, qrPause: d.qr_pause === true, tabPix: d.tab_pix === true };
}

export interface QrPauses { storeWide: boolean; tableIds: string[] }

export const mesasQrRepository = {
  /** Never throws: any failure (missing function, network, permission) means "feature off". */
  async capabilities(): Promise<MesasQrCapabilities> {
    try {
      const { data, error } = await supabase.rpc('mesas_qr_capabilities');
      if (error) return NO_CAPABILITIES;
      return parseCapabilities(data);
    } catch { return NO_CAPABILITIES; }
  },

  async pauses(tenantId: string): Promise<QrPauses> {
    const { data, error } = await supabase.from('dining_qr_pauses').select('table_id').eq('tenant_id', tenantId);
    if (error) {
      if (isMissingSchemaError(error)) return { storeWide: false, tableIds: [] };
      throw toBackendError(error, 'Não foi possível carregar o estado do QR.');
    }
    const rows = (data || []) as Array<{ table_id: string | null }>;
    return { storeWide: rows.some(r => r.table_id === null), tableIds: rows.filter(r => r.table_id).map(r => String(r.table_id)) };
  },

  async setPause(tenantId: string, tableId: string | null, paused: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_dining_qr_pause', { p_tenant: tenantId, p_table: tableId, p_paused: paused });
    if (error) throw toBackendError(error, paused ? 'Não foi possível pausar o QR.' : 'Não foi possível retomar o QR.');
  },

  /** Tabs closed/awaiting review by a PIX that needs a human look (money received but the total moved). */
  async pixReviews(tenantId: string, tabIds: string[]): Promise<Set<string>> {
    if (!tabIds.length) return new Set();
    const { data, error } = await supabase.from('tab_pix_charges').select('tab_id').eq('tenant_id', tenantId).eq('needs_review', true).in('tab_id', tabIds);
    if (error) return new Set();
    return new Set(((data || []) as Array<{ tab_id: string }>).map(r => r.tab_id));
  },
};
