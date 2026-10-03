import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { AuditLog } from '../types';
import { dataStore } from '../services/dataStore';
import { SecurityContext } from '../services/securityEngine';
import { isValidUuid } from '../lib/uuid';

function mapRowToAuditLog(row: any): AuditLog {
  return {
    id: row.id,
    timestamp: row.created_at,
    userId: row.user_id,
    userName: row.user_name,
    userRole: row.user_role,
    tenantId: row.tenant_id || undefined,
    tenantName: row.tenant_name || undefined,
    action: row.action,
    resource: row.resource,
    resourceId: row.resource_id || undefined,
    details: row.details,
    previousValue: row.previous_value || undefined,
    newValue: row.new_value || undefined,
    ipAddress: row.ip_address || '127.0.0.1',
    isCeoSupport: Boolean(row.is_ceo_support),
  };
}

export const auditLogRepository = {
  async getAuditLogs(context: SecurityContext, tenantId?: string): Promise<AuditLog[]> {
    if (tenantId && !isValidUuid(tenantId)) {
      return dataStore.getAuditLogs(context, tenantId);
    }

    if (isSupabaseConfigured) {
      try {
        let query = supabase
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false });

        if (tenantId && isValidUuid(tenantId)) {
          query = query.eq('tenant_id', tenantId);
        }

        const { data, error } = await query;
        if (!error && data && data.length > 0) {
          return data.map(mapRowToAuditLog);
        }
      } catch (err) {
        console.warn('[auditLogRepository] Fallback para dataStore:', err);
      }
    }
    return dataStore.getAuditLogs(context, tenantId);
  },

  async log(entry: Omit<AuditLog, 'id' | 'timestamp'>): Promise<void> {
    // Audit logs no banco são estritamente gerados por procedimentos do servidor e operações transacionais autenticadas
    // Mantemos a gravação no dataStore local e tentamos gravar apenas se o usuário for autenticado com permissão
    if (isSupabaseConfigured) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) {
          await supabase
            .from('audit_logs')
            .insert({
              user_id: sessionData.session.user.id,
              user_name: entry.userName || 'Staff',
              user_role: entry.userRole || 'STAFF',
              tenant_id: entry.tenantId || null,
              tenant_name: entry.tenantName || null,
              action: entry.action,
              resource: entry.resource,
              resource_id: entry.resourceId || null,
              details: entry.details,
              previous_value: entry.previousValue || null,
              new_value: entry.newValue || null,
              ip_address: entry.ipAddress || null,
              is_ceo_support: Boolean(entry.isCeoSupport),
            });
        }
      } catch (err) {
        // Falhas em auditoria no cliente são silenciosas para não interromper a UX
      }
    }
    dataStore.addAuditLog(entry);
  }
};
