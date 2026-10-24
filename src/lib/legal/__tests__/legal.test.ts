import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGAL_VERSION,
  legalDocuments,
  legalSignupMetadata,
} from '../documents';
import { analyticsAllowed, COOKIE_KEY, readCookieChoice } from '../cookies';
import { defaultKV } from '../../customer/localStore';
import { campaignRepository } from '../../../repositories/campaignRepository';
import { localCustomerData } from '../../../components/legal/MyDataPage';
vi.mock('../../../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
  isSupabaseConfigured: true,
}));
import { supabase } from '../../supabase';
afterEach(() => {
  defaultKV().removeItem(COOKIE_KEY);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('legal acceptance', () => {
  it('requires affirmative consent, separately for owner and customer, without marketing opt-in', () => {
    expect(() => legalSignupMetadata(false, 'customer')).toThrow();
    expect(legalSignupMetadata(true, 'owner')).toEqual({
      legal_accepted: true,
      legal_version: LEGAL_VERSION,
      legal_audience: 'owner',
    });
    expect(legalSignupMetadata(true, 'customer')).not.toHaveProperty(
      'contact_consent',
    );
  });
  it('provides four public documents', () => {
    expect(Object.keys(legalDocuments)).toEqual([
      'terms-owner',
      'terms-customer',
      'privacy',
      'cookies',
    ]);
  });
});
describe('cookie consent and analytics', () => {
  it('defaults to essentials and rejects corrupt or old preferences', () => {
    expect(analyticsAllowed()).toBe(false);
    for (const value of [
      'bad',
      '{}',
      '{"version":0,"analytics":true}',
      '{"version":1,"analytics":"true"}',
    ]) {
      defaultKV().setItem(COOKIE_KEY, value);
      expect(readCookieChoice()).toBeNull();
      expect(analyticsAllowed()).toBe(false);
    }
  });
  it('permits explicit opt-in and permits revoking it', () => {
    defaultKV().setItem(
      COOKIE_KEY,
      JSON.stringify({ version: 1, analytics: true }),
    );
    expect(analyticsAllowed()).toBe(true);
    defaultKV().setItem(
      COOKIE_KEY,
      JSON.stringify({ version: 1, analytics: false }),
    );
    expect(analyticsAllowed()).toBe(false);
  });
  it('never sends optional campaign analytics before opt-in', async () => {
    await campaignRepository.trackEvent({
      storeSlug: 'store-a',
      eventType: 'CARD_CLICK',
      sessionId: 'session',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
describe('local data export', () => {
  it('only includes allowed preferences in the signed-in customer namespace', () => {
    const values = new Map<string, string>([
      ['dc_cust:me:addresses', '{"items":[]}'],
      ['dc_cust:me:fav:store-a', '["product"]'],
      ['dc_cust:me:search', '["water"]'],
      ['dc_cust:me:notif_prefs', '{"orderStatus":true}'],
      ['dc_cust:me:notif_seen:store-a', '123'],
      ['dc_cust:other:addresses', '{"private":"address"}'],
      ['sb-access-token', 'secret'],
      ['dc_cust:me:auth', '"secret"'],
    ]);
    const kv = {
      get length() {
        return values.size;
      },
      key: (i: number) => [...values.keys()][i],
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    };
    vi.stubGlobal('window', { localStorage: kv });
    vi.stubGlobal('localStorage', kv);
    expect(localCustomerData('me')).toEqual({
      addresses: { items: [] },
      'fav:store-a': ['product'],
      search: ['water'],
      notif_prefs: { orderStatus: true },
      'notif_seen:store-a': 123,
    });
  });
});
