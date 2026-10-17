import { describe, it, expect } from 'vitest';
import { posSaleNotes, isMissingRpcSignature } from '../posSaleNotes';

describe('posSaleNotes (troco do PDV → p_notes)', () => {
  it('envia o troco como observação', () => {
    expect(posSaleNotes('Venda Balcão | Troco para: R$ 50.00')).toBe('Venda Balcão | Troco para: R$ 50.00');
  });
  it('omite observação vazia', () => {
    expect(posSaleNotes('')).toBeUndefined();
    expect(posSaleNotes('   ')).toBeUndefined();
    expect(posSaleNotes(undefined)).toBeUndefined();
  });
  it('limita a 500 caracteres (limite do servidor)', () => {
    expect(posSaleNotes('x'.repeat(600))?.length).toBe(500);
  });
  it('detecta banco sem a assinatura nova (PGRST202)', () => {
    expect(isMissingRpcSignature({ code: 'PGRST202' })).toBe(true);
    expect(isMissingRpcSignature({ code: 'P0001' })).toBe(false);
    expect(isMissingRpcSignature(null)).toBe(false);
  });
});
