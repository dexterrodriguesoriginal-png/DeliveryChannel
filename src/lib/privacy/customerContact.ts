/** Customer contact display for staff. Contact actions keep their existing authorized destination. */
export function maskCustomerPhone(value?: string | null): string {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `•••• ${digits.slice(-2)}` : '';
}

