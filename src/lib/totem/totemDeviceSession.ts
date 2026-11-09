export const TOTEM_DEVICE_STORAGE_KEY = (slug: string) => `dc_totem_device_${slug}`;

export interface TotemDeviceSession {
  token: string;
  deviceId: string;
  label: string;
}

function storage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function readTotemDeviceSession(slug: string): TotemDeviceSession | null {
  const raw = storage()?.getItem(TOTEM_DEVICE_STORAGE_KEY(slug));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TotemDeviceSession>;
    if (typeof parsed.token === 'string' && /^[0-9a-f]{64}$/i.test(parsed.token) && typeof parsed.deviceId === 'string') {
      return { token: parsed.token.toLowerCase(), deviceId: parsed.deviceId, label: typeof parsed.label === 'string' ? parsed.label : 'Totem' };
    }
  } catch { /* ignore */ }
  return null;
}

export function writeTotemDeviceSession(slug: string, session: TotemDeviceSession): void {
  try { storage()?.setItem(TOTEM_DEVICE_STORAGE_KEY(slug), JSON.stringify(session)); } catch { /* ignore */ }
}

export function clearTotemDeviceSession(slug: string): void {
  try { storage()?.removeItem(TOTEM_DEVICE_STORAGE_KEY(slug)); } catch { /* ignore */ }
}
