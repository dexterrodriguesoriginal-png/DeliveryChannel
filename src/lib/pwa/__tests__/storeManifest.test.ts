import { describe, it, expect } from 'vitest';
import { buildStoreManifest, cartStorageKey, deriveShortName, manifestDataUrl, storeInitials } from '../storeManifest';

const O = 'https://exemplo.app';
const adega = { id: 'tenant-adega-01', slug: 'adega-premium', name: 'Adega Premium Jardins', theme: { storeName: 'Adega Premium Jardins', primaryColor: '#15803d', backgroundColor: '#f8fafc', logoUrl: 'https://x/logo.png' } };
const padaria = { id: 'tenant-padaria-04', slug: 'padaria-do-joao', name: 'Padaria do João', theme: { storeName: 'Padaria do João', primaryColor: '#b45309', backgroundColor: '#fffbeb' } };
const png = [{ src: 'data:image/png;base64,AAA', sizes: '192x192', type: 'image/png', purpose: 'any' as const }];

describe('manifesto PWA por loja', () => {
  it('duas lojas geram manifestos distintos com nome, id, start_url e scope próprios', () => {
    const a = buildStoreManifest(adega, O, png);
    const p = buildStoreManifest(padaria, O);
    expect(a.name).toBe('Adega Premium Jardins');
    expect(p.name).toBe('Padaria do João');
    expect(a.start_url).toBe('https://exemplo.app/app/adega-premium/?source=pwa');
    expect(p.start_url).toBe('https://exemplo.app/app/padaria-do-joao/?source=pwa');
    expect(a.scope).toBe('https://exemplo.app/app/adega-premium/');
    expect(a.start_url.startsWith(a.scope)).toBe(true);
    expect(a.id).toBe('https://exemplo.app/app-id/tenant-adega-01');
    expect(a.id).not.toBe(p.id);
    expect(a.theme_color).toBe('#15803d');
    expect(p.background_color).toBe('#fffbeb');
    expect(a.display).toBe('standalone');
    expect(a.icons).toBe(png);
  });

  it('id é estável: muda o nome, não muda o id', () => {
    const r = buildStoreManifest({ ...adega, name: 'Outro', theme: { ...adega.theme, storeName: 'Outro' } }, O);
    expect(r.id).toBe(buildStoreManifest(adega, O).id);
  });

  it('fallback sem logo: ícones 192/512/maskable com iniciais e cor da loja', () => {
    const p = buildStoreManifest(padaria, O);
    expect(p.icons.map(i => `${i.sizes}:${i.purpose}`)).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
    const svg = decodeURIComponent(p.icons[0].src);
    expect(svg).toContain('#b45309');
    expect(svg).toContain('>PJ<');
    expect(storeInitials('Mercadinho Bom Preço')).toBe('MB');
  });

  it('cor inválida cai no padrão neutro', () => {
    expect(buildStoreManifest({ ...padaria, theme: { primaryColor: 'red;}' } }, O).theme_color).toBe('#334155');
  });

  it('nunca contém o nome da plataforma', () => {
    for (const s of [adega, padaria]) {
      const txt = decodeURIComponent(manifestDataUrl(buildStoreManifest(s, O))).toLowerCase();
      expect(txt).not.toMatch(/adegafood|deliverychannel|delivery channel/);
    }
  });

  it('short_name = nome completo (ou nome curto configurado), sem truncar', () => {
    expect(deriveShortName('Adega Premium')).toBe('Adega Premium');
    expect(deriveShortName('Adega Premium Jardins')).toBe('Adega Premium Jardins');
    expect(deriveShortName('Padaria do João')).toBe('Padaria do João');
    expect(deriveShortName('X', 'Explicito Muito Longo')).toBe('Explicito Muito Longo');
  });
});

describe('isolamento do carrinho por loja', () => {
  it('chaves distintas por tenantId e recusa tenant vazio', () => {
    expect(cartStorageKey('tenant-adega-01')).not.toBe(cartStorageKey('tenant-padaria-04'));
    expect(cartStorageKey('tenant-adega-01')).toBe('adegafood_cart_tenant-adega-01');
    expect(() => cartStorageKey('')).toThrow();
  });
});
