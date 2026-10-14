/**
 * Conta entregas por motorista. orders.driver_id referencia o auth user id
 * do motorista (drivers.user_id), não drivers.id.
 */
export function buildDeliveryCountByUserId(
  deliveries: Array<{ driver_id?: string | null }> | null | undefined,
): Record<string, number> {
  const map: Record<string, number> = {};
  (deliveries || []).forEach((d) => {
    if (d && d.driver_id) map[d.driver_id] = (map[d.driver_id] || 0) + 1;
  });
  return map;
}

export function deliveryCountForDriver(
  map: Record<string, number>,
  row: { user_id?: string | null },
): number {
  return row.user_id ? map[row.user_id] || 0 : 0;
}
