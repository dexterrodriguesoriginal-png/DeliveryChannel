import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AUTH_STORE_KEY, rememberAuthStore, storeEmailData } from '../storeEmailBranding';
describe('store branding in auth emails', () => {
  it('uses the store of the link/QR, with a bounded public label and fallback', () => {
    expect(storeEmailData('  ADEGASHOW\n')).toEqual({ store_name: 'ADEGASHOW' });
    expect(storeEmailData('')).toEqual({ store_name: 'Delivery Channel' });
    expect(storeEmailData('a'.repeat(110)).store_name).toHaveLength(100);
    const values = new Map(); rememberAuthStore({ setItem: (k,v) => { values.set(k,v); } },'Loja B');
    expect(values.get(AUTH_STORE_KEY)).toBe('Loja B');
  });
  it.each(['confirmation','magic_link','recovery'])('template %s preserves signed Supabase confirmation URL and brand', name => {
    const html = readFileSync(`supabase/templates/${name}.html`,'utf8');
    expect(html).toContain('{{ .Data.store_name }}'); expect(html).toContain('{{ .ConfirmationURL }}');
    expect(html).toContain('enviado por Delivery Channel'); expect(html).not.toContain('.Email');
  });
});
