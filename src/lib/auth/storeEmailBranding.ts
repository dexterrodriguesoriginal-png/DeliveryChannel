/** Public store label only. Never contains invitation tokens or personal data. */
export const AUTH_STORE_KEY = 'dc:auth-store-name';
export function storeEmailData(storeName?: string | null): { store_name: string } {
  return { store_name: (storeName || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100) || 'Delivery Channel' };
}
export function rememberAuthStore(storage: Pick<Storage, 'setItem'>, name?: string) {
  try { storage.setItem(AUTH_STORE_KEY, storeEmailData(name).store_name); } catch { /* storage unavailable */ }
}
