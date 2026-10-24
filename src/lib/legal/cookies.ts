import { defaultKV } from '../customer/localStore';
export const COOKIE_KEY = 'dc_cookie_choice_v1';
export type CookieChoice = { version: 1; analytics: boolean };
export function readCookieChoice(): CookieChoice | null {
  try {
    const c = JSON.parse(defaultKV().getItem(COOKIE_KEY) || 'null');
    return c?.version === 1 && typeof c.analytics === 'boolean' ? c : null;
  } catch {
    return null;
  }
}
export function analyticsAllowed() {
  return readCookieChoice()?.analytics === true;
}
export function openCookiePreferences() {
  window.dispatchEvent(new Event('dc-cookie-preferences'));
}
