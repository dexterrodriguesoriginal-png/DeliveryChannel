import { PaymentError } from './types';
export type Transport = typeof fetch;
export async function providerRequest(fetcher: Transport, url: string, init: RequestInit = {}): Promise<any> {
  // No caller-controlled destinations and no redirects carrying credentials to another host.
  try {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new PaymentError('PROVIDER_UNAVAILABLE', 502, 'O provedor não concluiu a solicitação. Tente novamente.');
    if (response.status === 204) return {};
    return await response.json();
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError('PROVIDER_UNAVAILABLE', 502, 'O provedor está indisponível. Tente novamente.');
  }
}
export function jsonHeaders(token?: string, extra = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}
export function checkoutUrl(value: unknown, domains: string[]): string {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'https:' && !url.username && !url.password && domains.some(d => url.hostname === d || url.hostname.endsWith('.' + d))) return url.href;
  } catch { /* fail closed */ }
  throw new PaymentError('INVALID_CHECKOUT_URL', 502);
}
