import { BackendSchema, currentBackendSchema } from './backendSchema';
/**
 * Colunas legíveis de tenant_settings por esquema de backend.
 * - n1n6: pix_key NÃO tem SELECT para anon/authenticated (N1) e existe default_prep_time_minutes;
 *   nunca usar select('*').
 * - legacy-020: não existe default_prep_time_minutes (era a 021, em quarentena); pix_key existe.
 */
export function tenantSettingsColumns(schema: BackendSchema = currentBackendSchema()): string {
  const base =
    'id, tenant_id, is_open, min_order_value, delivery_fee, free_delivery_threshold, estimated_delivery_time, address, city, phone_whatsapp, created_at, updated_at';
  return schema === 'n1n6' ? `${base}, default_prep_time_minutes` : `${base}, pix_key`;
}

export const TENANT_SETTINGS_COLUMNS = tenantSettingsColumns();
