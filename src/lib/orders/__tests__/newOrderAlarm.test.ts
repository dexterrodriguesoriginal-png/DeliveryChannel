import { describe, it, expect } from 'vitest';
import { shouldBeep, readSoundPref, writeSoundPref, SOUND_PREF_KEY, BEEP_INTERVAL_MS } from '../newOrderAlarm';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('alarme de pedido novo', () => {
  it('toca só com som ligado, após interação e com pedido em Novo', () => {
    expect(shouldBeep({ enabled: true, unlocked: true, pendingCount: 1 })).toBe(true);
    expect(shouldBeep({ enabled: true, unlocked: true, pendingCount: 0 })).toBe(false);
    expect(shouldBeep({ enabled: true, unlocked: false, pendingCount: 3 })).toBe(false);
    expect(shouldBeep({ enabled: false, unlocked: true, pendingCount: 3 })).toBe(false);
    expect(BEEP_INTERVAL_MS).toBe(5000);
  });
  it('preferência salva no navegador (padrão ligado)', () => {
    const s = mem();
    expect(readSoundPref(s)).toBe(true);
    writeSoundPref(s, false);
    expect(s.getItem(SOUND_PREF_KEY)).toBe('0');
    expect(readSoundPref(s)).toBe(false);
    writeSoundPref(s, true);
    expect(readSoundPref(s)).toBe(true);
  });
});
