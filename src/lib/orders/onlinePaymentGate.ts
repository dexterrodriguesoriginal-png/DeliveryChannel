/** Shared by staff lists, counts, dispatch and alerts. RLS remains authoritative. */
export function isOrderVisibleToStaff(order: { awaitingOnlinePayment?: boolean; awaiting_online_payment?: boolean }): boolean {
  return order.awaitingOnlinePayment !== true && order.awaiting_online_payment !== true;
}
export function visibleStaffOrders<T extends { awaitingOnlinePayment?: boolean; awaiting_online_payment?: boolean }>(orders: readonly T[]): T[] {
  return orders.filter(isOrderVisibleToStaff);
}
