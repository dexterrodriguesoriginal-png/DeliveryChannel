import { describe, it, expect } from 'vitest';
import { isStaffPreview } from '../staffPreview';
describe('isStaffPreview', () => {
  it('cliente deslogado não vê a barra', () => expect(isStaffPreview(false, undefined, 't1')).toBe(false));
  it('logado sem tenant (cliente) não vê', () => expect(isStaffPreview(true, null, 't1')).toBe(false));
  it('equipe de outro tenant não vê', () => expect(isStaffPreview(true, 't2', 't1')).toBe(false));
  it('equipe do tenant vê', () => expect(isStaffPreview(true, 't1', 't1')).toBe(true));
});
