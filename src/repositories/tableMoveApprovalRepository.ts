import { supabase } from '../lib/supabase';

export type TableMoveRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export interface TableMoveRequest {
  id: string;
  tabId: string;
  fromTableId: string;
  fromLabel: string;
  toTableId: string;
  toLabel: string;
  status: TableMoveRequestStatus;
  requestedAt: string;
  resolvedAt?: string | null;
}
const rows = (data: unknown): TableMoveRequest[] => Array.isArray(data) ? data as TableMoveRequest[] : [];

export const tableMoveApprovalRepository = {
  async waiterEnabled(tenantId: string): Promise<boolean> {
    const { data, error } = await supabase.from('waiter_service_settings')
      .select('allow_waiter_table_move_approval').eq('tenant_id', tenantId).maybeSingle();
    if (error) throw new Error('Não foi possível verificar a permissão de mudança de mesa.');
    return data?.allow_waiter_table_move_approval === true;
  },
  async pending(tenantId: string): Promise<TableMoveRequest[]> {
    const { data, error } = await supabase.rpc('list_table_move_requests', { p_tenant: tenantId });
    if (error && ['PGRST202', '42883'].includes(error.code)) return [];
    if (error) throw new Error('Não foi possível atualizar as solicitações de mudança de mesa.');
    return rows(data).filter(row => row.status === 'PENDING');
  },
  async resolve(requestId: string, approve: boolean): Promise<void> {
    const { error } = await supabase.rpc('resolve_table_move_request', { p_request_id: requestId, p_approve: approve });
    if (error) throw new Error(error.message || 'Não foi possível responder à solicitação.');
  },
  async mine(sessionId: string): Promise<TableMoveRequest[]> {
    const { data, error } = await supabase.rpc('list_my_table_move_requests', { p_session_id: sessionId });
    if (error) throw new Error('Não foi possível acompanhar a solicitação de mudança de mesa.');
    return rows(data);
  },
};
