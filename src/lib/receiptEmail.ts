/** One ordinary mailbox, never a display-name/address list or header value. */
export function isValidReceiptEmail(value: unknown): value is string {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return false;
  const email = value.trim();
  if (!email || email.length > 254) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local.length <= 64 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
    && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
    && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(domain);
}

