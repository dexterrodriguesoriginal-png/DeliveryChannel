import { supabase } from '../lib/supabase';
import { requireBackend, toBackendError } from '../lib/backend';

export interface DiningTable {
  id: string;
  label: string;
  area: string | null;
  seats: number;
  qrToken: string;
  active: boolean;
}

export interface DiningTableInput {
  label: string;
  area?: string;
  seats: number;
}

function mapTable(row: any): DiningTable {
  return {
    id: row.id,
    label: row.label,
    area: row.area || null,
    seats: Number(row.seats),
    qrToken: row.qr_token,
    active: Boolean(row.active),
  };
}

const columns = 'id, label, area, seats, qr_token, active';

export const diningTableRepository = {
  async list(tenantId: string): Promise<DiningTable[]> {
    requireBackend('mesas do salão');
    const { data, error } = await supabase
      .from('dining_tables')
      .select(columns)
      .eq('tenant_id', tenantId)
      .order('label', { ascending: true });
    if (error) throw toBackendError(error, 'Falha ao carregar as mesas.');
    return (data || []).map(mapTable);
  },

  async create(tenantId: string, input: DiningTableInput): Promise<DiningTable> {
    requireBackend('mesas do salão');
    const { data, error } = await supabase
      .from('dining_tables')
      .insert({
        tenant_id: tenantId,
        label: input.label.trim(),
        area: input.area?.trim() || null,
        seats: input.seats,
      })
      .select(columns)
      .single();
    if (error) throw toBackendError(error, 'Falha ao criar a mesa.');
    return mapTable(data);
  },

  async createMany(tenantId: string, inputs: DiningTableInput[]): Promise<DiningTable[]> {
    requireBackend('mesas do salão');
    if (!inputs.length) return [];
    const { data, error } = await supabase
      .from('dining_tables')
      .insert(inputs.map(input => ({
        tenant_id: tenantId,
        label: input.label.trim(),
        area: input.area?.trim() || null,
        seats: input.seats,
      })))
      .select(columns);
    if (error) throw toBackendError(error, 'Falha ao criar as mesas.');
    return (data || []).map(mapTable);
  },

  async update(tenantId: string, tableId: string, input: DiningTableInput): Promise<DiningTable> {
    requireBackend('mesas do salão');
    const { data, error } = await supabase
      .from('dining_tables')
      .update({
        label: input.label.trim(),
        area: input.area?.trim() || null,
        seats: input.seats,
      })
      .eq('tenant_id', tenantId)
      .eq('id', tableId)
      .select(columns)
      .single();
    if (error) throw toBackendError(error, 'Falha ao atualizar a mesa.');
    return mapTable(data);
  },

  async remove(tenantId: string, tableId: string): Promise<void> {
    requireBackend('mesas do salão');
    const { error } = await supabase
      .from('dining_tables')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', tableId);
    if (error) throw toBackendError(error, 'Falha ao excluir a mesa. Mesas com comandas vinculadas não podem ser excluídas.');
  },

  async regenerateQr(tenantId: string, tableId: string): Promise<string> {
    requireBackend('QR das mesas');
    const { data, error } = await supabase.rpc('regenerate_dining_table_qr', { p_table_id: tableId });
    if (error) throw toBackendError(error, 'Falha ao gerar um novo QR para a mesa.');
    return String(data);
  },
};
