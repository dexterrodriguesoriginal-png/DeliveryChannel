/** The server rechecks both the session and PIX charges before reopening a tab. */
export function canReopenBill(status?: string, pixStatus?: string | null): boolean {
  return ['BILL_REQUESTED', 'WAITER_AUTHORIZED'].includes(status || '')
    && !['creating', 'pending', 'paid'].includes((pixStatus || '').toLowerCase());
}

