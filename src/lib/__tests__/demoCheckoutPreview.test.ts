import { describe, it, expect } from 'vitest';
import { canPreviewCheckoutWithoutLogin } from '../demoCheckoutPreview';

describe('canPreviewCheckoutWithoutLogin', () => {
  it('true apenas em demo local sem Supabase', () => {
    expect(canPreviewCheckoutWithoutLogin(false, 'true')).toBe(true);
    expect(canPreviewCheckoutWithoutLogin(false, true)).toBe(true);
  });
  it('false com Supabase configurado, mesmo com demo ligado', () => {
    expect(canPreviewCheckoutWithoutLogin(true, 'true')).toBe(false);
    expect(canPreviewCheckoutWithoutLogin(true, true)).toBe(false);
    expect(canPreviewCheckoutWithoutLogin(true, undefined)).toBe(false);
  });
  it('false sem flag de demo', () => {
    expect(canPreviewCheckoutWithoutLogin(false, undefined)).toBe(false);
    expect(canPreviewCheckoutWithoutLogin(false, 'false')).toBe(false);
    expect(canPreviewCheckoutWithoutLogin(false, '')).toBe(false);
    expect(canPreviewCheckoutWithoutLogin(false, '1')).toBe(false);
  });
});
