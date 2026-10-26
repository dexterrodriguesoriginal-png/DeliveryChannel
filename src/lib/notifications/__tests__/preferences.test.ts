import { describe, expect, it } from 'vitest';
import { preferenceKey, readPreferences, savePreferences } from '../preferences';
const memory = () => { const map = new Map<string,string>(); return { getItem: (k: string) => map.get(k) || null, setItem: (k: string,v: string) => { map.set(k,v); } }; };
describe('notification preferences per user and tenant', () => {
  it('persists balloon and sound preferences without leaking between accounts or stores', () => {
    const s = memory(); savePreferences(s,'A','owner1',{ balloon: false,sound: true });
    expect(readPreferences(s,'A','owner1')).toEqual({ balloon: false,sound: true });
    expect(readPreferences(s,'B','owner1')).toEqual({ balloon: true,sound: false });
    expect(readPreferences(s,'A','owner2')).toEqual({ balloon: true,sound: false });
  });
  it('handles malformed or unavailable local storage', () => {
    const s = memory(); s.setItem(preferenceKey('A','u'),'{bad');
    expect(readPreferences(s,'A','u')).toEqual({ balloon: true,sound: false });
    expect(() => savePreferences({ setItem: () => { throw Error(); } },'A','u',{ balloon: true,sound: false })).not.toThrow();
  });
});
