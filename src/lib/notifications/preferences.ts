export interface NotificationPreferences { balloon: boolean; sound: boolean }
export const preferenceKey = (tenant: string, user: string) => `dc:notifications:${tenant}:${user}`;
export function readPreferences(storage: Pick<Storage, 'getItem'>, tenant: string, user: string): NotificationPreferences {
  try { const value = JSON.parse(storage.getItem(preferenceKey(tenant, user)) || '{}'); return { balloon: value.balloon !== false, sound: value.sound === true }; }
  catch { return { balloon: true, sound: false }; }
}
export function savePreferences(storage: Pick<Storage, 'setItem'>, tenant: string, user: string, prefs: NotificationPreferences) {
  try { storage.setItem(preferenceKey(tenant, user), JSON.stringify(prefs)); if (typeof window !== 'undefined') window.dispatchEvent(new Event('dc:notification-preferences')); } catch { /* browser storage unavailable */ }
}
