// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearTotemDeviceSession, readTotemDeviceSession, writeTotemDeviceSession } from '../totemDeviceSession';

const token = 'a'.repeat(64);

describe('totemDeviceSession', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('persists and clears a valid device token', () => {
    expect(readTotemDeviceSession('loja')).toBeNull();
    writeTotemDeviceSession('loja', { token, deviceId: 'd1', label: 'Caixa 1' });
    expect(readTotemDeviceSession('loja')).toEqual({ token, deviceId: 'd1', label: 'Caixa 1' });
    clearTotemDeviceSession('loja');
    expect(readTotemDeviceSession('loja')).toBeNull();
  });

  it('ignores a malformed token', () => {
    localStorage.setItem('dc_totem_device_loja', JSON.stringify({ token: 'short', deviceId: 'd1' }));
    expect(readTotemDeviceSession('loja')).toBeNull();
  });
});
