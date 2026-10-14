import { describe, it, expect } from 'vitest';
import { isUsableLogoUrl } from '../storeLogo';
import { storeInitials } from '../storeManifest';
describe('fallback do logo da loja', () => {
  it('rejeita URLs vazias/inválidas', () => {
    for (const u of [undefined, null, '', '   ', 'logo.png', 'javascript:alert(1)', 'ftp://x/y.png']) expect(isUsableLogoUrl(u as any)).toBe(false);
  });
  it('aceita http(s), data:image e caminho absoluto', () => {
    for (const u of ['https://x/l.png', 'http://x/l.png', 'data:image/png;base64,AA', '/demo/l.svg']) expect(isUsableLogoUrl(u)).toBe(true);
  });
  it('iniciais da loja', () => {
    expect(storeInitials('Mercadinho Bom Preço')).toBe('MB');
    expect(storeInitials('Padaria do João')).toBe('PJ');
  });
});
