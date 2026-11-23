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

import fs from 'node:fs';
import path from 'node:path';
describe('ClientApp: convite "Instalar app"', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/client/ClientApp.tsx'), 'utf8');
  it('só aparece com a logo definitiva confirmada', () => {
    expect(src).toMatch(/\{!previewMode && isLogoConfirmed\(theme\) && <InstallStoreAppHint/);
  });
  it('o convite Instalar app não aponta para um manifesto versionado', () => {
    expect(src).not.toMatch(/versionedStartUrl/);
    expect(src).not.toMatch(/startPath=\{appIdentity/);
    const start = src.indexOf('<InstallStoreAppHint');
    const end = src.indexOf('/>', start);
    expect(start).toBeGreaterThan(-1);
    expect(src.slice(start, end + 2)).not.toMatch(/startPath/);
  });
  it('aviso visual interno não aparece junto do banner legado', () => {
    expect(src).toMatch(/\{!previewMode && !legacyIdentity && !iconNoticeVisible && <StoreVisualUpdateNotice/);
  });
});
