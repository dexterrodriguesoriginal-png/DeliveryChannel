import { describe, it, expect } from 'vitest';
import { confirmedLogoUrl, isDraftLogoConfirmed, isLogoConfirmed, logoChangedAfterConfirmation, logoConfirmedUrlToSave } from '../logoConfirmation';

const A = 'https://cdn/x/logo-a.png';
const B = 'https://cdn/x/logo-b.png';
const t = (logoUrl?: string, logoConfirmedUrl?: string) => ({ logoUrl, tokens: logoConfirmedUrl === undefined ? {} : { meta: { logoConfirmedUrl } } });

describe('logo definitiva', () => {
  it('loja antiga (sem o campo) com logo: conta como confirmada; sem logo: não', () => {
    expect(isLogoConfirmed(t(A))).toBe(true);
    expect(isLogoConfirmed({ logoUrl: A })).toBe(true);
    expect(isLogoConfirmed(t(''))).toBe(false);
    expect(isLogoConfirmed(null)).toBe(false);
  });

  it('com o campo: só a logo confirmada libera', () => {
    expect(isLogoConfirmed(t(A, A))).toBe(true);
    expect(isLogoConfirmed(t(B, A))).toBe(false);
    expect(isLogoConfirmed(t(A, ''))).toBe(false);
    expect(confirmedLogoUrl(t(B, A))).toBe(A);
  });

  it('ao salvar: confirmação explícita vale; loja antiga grava a logo salva antes (trocar pede nova confirmação)', () => {
    expect(logoConfirmedUrlToSave(t(B, B), t(A))).toBe(B);
    expect(logoConfirmedUrlToSave(t(B), t(A))).toBe(A);
    expect(logoConfirmedUrlToSave(t(A), t(A))).toBe(A);
    expect(logoConfirmedUrlToSave(t(A), t(''))).toBe('');
    expect(isDraftLogoConfirmed(t(B), t(A))).toBe(false);
    expect(isDraftLogoConfirmed(t(A), t(A))).toBe(true);
    expect(isDraftLogoConfirmed(t(B, B), t(A))).toBe(true);
  });

  it('aviso de troca só quando havia logo confirmada e ela mudou', () => {
    expect(logoChangedAfterConfirmation(t(B), t(A))).toBe(true);
    expect(logoChangedAfterConfirmation(t(B), t(A, A))).toBe(true);
    expect(logoChangedAfterConfirmation(t(A), t(A))).toBe(false);
    expect(logoChangedAfterConfirmation(t(A), t(''))).toBe(false);
    expect(logoChangedAfterConfirmation(t(A), t(A, ''))).toBe(false);
  });
});
