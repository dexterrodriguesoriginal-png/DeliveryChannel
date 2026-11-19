import { describe, it, expect } from 'vitest';
import { appBaseLogoUrlToSave, hasAppBaseLogo, logoChangedSinceBaseApp } from '../appBaseLogo';
import { identityFromPayload } from '../../../../server/pwa/storeSource';

describe('logo do app instalado sem versão', () => {
  it('ausente = loja nunca trocou: nada muda', () => {
    expect(hasAppBaseLogo({ theme: { logoUrl: 'a' } })).toBe(false);
    expect(logoChangedSinceBaseApp({ theme: { logoUrl: 'a' } })).toBe(false);
  });
  it('compara com a logo atual', () => {
    expect(logoChangedSinceBaseApp({ appBaseLogoUrl: 'a', theme: { logoUrl: 'a' } })).toBe(false);
    expect(logoChangedSinceBaseApp({ appBaseLogoUrl: 'a', theme: { logoUrl: 'b' } })).toBe(true);
    expect(logoChangedSinceBaseApp({ appBaseLogoUrl: '', theme: {} })).toBe(false);
    expect(logoChangedSinceBaseApp({ appBaseLogoUrl: '', theme: { logoUrl: 'b' } })).toBe(true);
  });
  it('salvar: mantém o existente; grava a logo salva só na 1ª troca', () => {
    expect(appBaseLogoUrlToSave(undefined, 'a', 'a')).toBeUndefined();
    expect(appBaseLogoUrlToSave(undefined, 'a', 'b')).toBe('a');
    expect(appBaseLogoUrlToSave(undefined, '', 'b')).toBe('');
    expect(appBaseLogoUrlToSave('a', 'b', 'c')).toBe('a');
  });
  it('servidor lê theme_tokens.meta.appBaseLogoUrl do get_public_store (ausente fica ausente)', () => {
    const p = (meta: object) => ({ tenant: { id: 't', slug: 's', name: 'S' }, theme: { logo_url: 'b', theme_tokens: { meta } } });
    expect(identityFromPayload(p({ appBaseLogoUrl: ' a ' }), 's')!.appBaseLogoUrl).toBe('a');
    expect('appBaseLogoUrl' in identityFromPayload(p({}), 's')!).toBe(false);
  });
});
