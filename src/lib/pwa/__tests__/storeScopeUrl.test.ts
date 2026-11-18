import { describe, it, expect } from 'vitest';
import { storeAppCanonicalPath } from '../storeScopeUrl';
import { resolvePwaScope } from '../registerSw';
import { buildStoreManifest } from '../storeManifest';

describe('storeAppCanonicalPath', () => {
  it('adiciona a barra final na raiz da loja e preserva a query', () => {
    expect(storeAppCanonicalPath('/app/adegasshow')).toBe('/app/adegasshow/');
    expect(storeAppCanonicalPath('/app/adegasshow', '?mesa=abc')).toBe('/app/adegasshow/?mesa=abc');
    expect(storeAppCanonicalPath('/app/adegasshow', '?preview=1&x=2')).toBe('/app/adegasshow/?preview=1&x=2');
    expect(storeAppCanonicalPath('/app/adegasshow', '?')).toBe('/app/adegasshow/');
    expect(storeAppCanonicalPath('/app/loja%20x', 'a=1')).toBe('/app/loja%20x/?a=1');
  });

  it('não mexe em caminhos já canônicos, subpáginas, arquivos ou outras rotas', () => {
    for (const p of ['/app/adegasshow/', '/app/adegasshow/?source=pwa', '/app/adegasshow/manifest.webmanifest',
      '/app/adegasshow/icons/icon-192.png', '/app/', '/app', '/app/sw.js', '/totem/adegasshow', '/', '/garcom', '/apps/x']) {
      expect(storeAppCanonicalPath(p)).toBeNull();
    }
  });

  it('o destino é sempre um caminho local (sem open redirect)', () => {
    for (const p of ['/app/%2F%2Fevil', '/app/\\evil', '/app/@evil', '/app/%2F%2Fevil.example']) {
      const t = storeAppCanonicalPath(p, '?next=https://evil.example');
      if (t !== null) {
        expect(t.startsWith('/app/')).toBe(true);
        expect(t.startsWith('//')).toBe(false);
      }
    }
  });

  it('o endereço canônico fica dentro do scope do manifesto e do Service Worker', () => {
    const target = storeAppCanonicalPath('/app/adegasshow', '?x=1')!;
    const manifest = buildStoreManifest({ id: 't1', slug: 'adegasshow', name: 'Adega' } as never, 'https://deliverychannel.ai.studio');
    const scopePath = new URL(manifest.scope, 'https://deliverychannel.ai.studio').pathname;
    expect(scopePath).toBe('/app/adegasshow/');
    expect(target.startsWith(scopePath)).toBe(true);
    expect(target.startsWith(resolvePwaScope('/app/adegasshow'))).toBe(true);
    // Sem barra, a página ficaria fora do scope (motivo do atalho em vez de WebAPK).
    expect('/app/adegasshow'.startsWith(scopePath)).toBe(false);
  });
});
