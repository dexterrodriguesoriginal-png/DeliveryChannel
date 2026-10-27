import { describe, expect, it } from 'vitest';
import { bulkTableNames, friendlyTableError, isValidTableToken, nextTableName, qrFileName, readMesaParam, tableAppUrl, validateTableName } from '../tableQr';

describe('table name rule (3–15)', () => {
  it.each([['ab', false], ['abc', true], ['Mesa 01', true], ['Varanda externa', true], ['Varanda externa!', false], ['  ab  ', false], ['   abc   ', true], ['', false]] as const)('%j → %s', (name, ok) => {
    expect(validateTableName(name) === null).toBe(ok);
  });
  it('rejects duplicates case-insensitively but allows keeping its own name', () => {
    expect(validateTableName('mesa 01', ['Mesa 01', 'Mesa 02'])).toMatch(/Já existe/);
    expect(validateTableName('Mesa 03', ['Mesa 01', 'Mesa 02'])).toBeNull();
  });
  it('rejects markup characters', () => {
    expect(validateTableName('<b>mesa</b>')).toMatch(/letras/);
  });
});

describe('opaque token and link', () => {
  it('accepts only well-formed opaque tokens', () => {
    expect(isValidTableToken('a'.repeat(48))).toBe(true);
    for (const bad of ['', 'short', 'a b c d e f g h', "x'; drop table", '<script>alert(1)</script>', 'a'.repeat(129), null, undefined, 42]) expect(isValidTableToken(bad)).toBe(false);
  });
  it('builds /app/<slug>?mesa=<token> and refuses unusable input', () => {
    const token = 'ab12cd34'.repeat(6);
    expect(tableAppUrl('https://app.exemplo.com/', 'adega-do-ze', token)).toBe(`https://app.exemplo.com/app/adega-do-ze?mesa=${token}`);
    expect(tableAppUrl('https://x.com', 'Adega-Do-Ze', token)).toContain('/app/adega-do-ze?mesa=');
    expect(tableAppUrl('https://x.com', '../admin', token)).toBe('');
    expect(tableAppUrl('https://x.com', 'loja', 'bad token')).toBe('');
    expect(tableAppUrl('https://x.com', '', token)).toBe('');
  });
  it('reads ?mesa= safely', () => {
    expect(readMesaParam('?mesa=' + 'a'.repeat(48))).toBe('a'.repeat(48));
    expect(readMesaParam('?foo=1&mesa=' + 'b'.repeat(20))).toBe('b'.repeat(20));
    expect(readMesaParam('?mesa=<script>')).toBeNull();
    expect(readMesaParam('?mesa=1')).toBeNull();
    expect(readMesaParam('')).toBeNull();
    expect(readMesaParam('?mesa=' + 'a'.repeat(500))).toBeNull();
  });
});

describe('naming', () => {
  it('suggests the next free name and bulk names skipping existing ones', () => {
    expect(nextTableName([])).toBe('Mesa 01');
    expect(nextTableName(['Mesa 01', 'mesa 02'])).toBe('Mesa 03');
    expect(bulkTableNames(3, ['Mesa 02'])).toEqual(['Mesa 01', 'Mesa 03', 'Mesa 04']);
    expect(bulkTableNames(0, [])).toEqual([]);
    expect(bulkTableNames(20, []).every(name => validateTableName(name) === null)).toBe(true);
  });
  it('file names are safe', () => {
    expect(qrFileName('Área Vip/Sul', 'Adega-X')).toBe('qr-adega-x-area-vip-sul.png');
    expect(qrFileName('???', '')).toBe('qr-loja-mesa.png');
  });
  it('friendly errors for abuse rejections', () => {
    expect(friendlyTableError('QR_PAUSED: x')).toMatch(/pausado/);
    expect(friendlyTableError('RATE_LIMITED: x')).toMatch(/Muitas tentativas/);
    expect(friendlyTableError('TAB_PAYMENT_IN_PROGRESS: x')).toMatch(/sendo paga/);
    expect(friendlyTableError('outra coisa')).toBe('outra coisa');
  });
});
