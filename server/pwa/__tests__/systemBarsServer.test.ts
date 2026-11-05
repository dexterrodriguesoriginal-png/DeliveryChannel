// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createPwaRouter, serverManifest, identityVersion, iconVersion } from '../routes';
import { identityFromPayload } from '../storeSource';
import { injectStoreHead } from '../storeHtml';

const payload = (bars?: Record<string, string>) => ({
  tenant: { id: 't1', slug: 'adegashow', name: 'AdegaShow' },
  theme: {
    store_name: 'AdegaShow', primary_color: '#b91c1c', background_color: '#0b0b0f', logo_url: '/logo.png',
    theme_tokens: { version: 1, palette: { bgHeader: '#111827', primary: '#d4a017' }, meta: bars ? { systemBars: bars } : {} },
  },
});
const html = '<html><head><title>x</title><meta name="theme-color" content="#b91c1c" /><link rel="manifest" href="/manifest.json" /></head></html>';

describe('barras do sistema no servidor (manifesto + HTML de /app/<slug>)', () => {
  it('extrai cabeçalho e barras escolhidas do payload público', () => {
    const s = identityFromPayload(payload({ statusBarColor: '#D4A017', navBarColor: '#0b0b0f' }), 'adegashow')!;
    expect(s.theme).toMatchObject({ headerColor: '#111827', statusBarColor: '#D4A017', navBarColor: '#0b0b0f' });
  });
  it('padrão = cor do cabeçalho (não o vermelho da cor primária antiga)', () => {
    const s = identityFromPayload(payload(), 'adegashow')!;
    const m = serverManifest(s);
    expect(m.theme_color).toBe('#111827');
    expect(m.background_color).toBe('#111827');
  });
  it('cores escolhidas vão para theme_color (status) e background_color (navegação)', () => {
    const s = identityFromPayload(payload({ statusBarColor: '#d4a017', navBarColor: '#0b0b0f' }), 'adegashow')!;
    const m = serverManifest(s);
    expect(m.theme_color).toBe('#d4a017');
    expect(m.background_color).toBe('#0b0b0f');
  });
  it('cor inválida é ignorada (sem injeção) e cai no cabeçalho', () => {
    const s = identityFromPayload(payload({ statusBarColor: 'red;}</style>', navBarColor: 'url(x)' }), 'adegashow')!;
    const m = serverManifest(s);
    expect(m.theme_color).toBe('#111827');
    expect(m.background_color).toBe('#111827');
  });
  it('HTML renderizado no servidor já sai com theme-color, color-scheme, manifesto estável e ícone versionado', () => {
    const s = identityFromPayload(payload({ statusBarColor: '#d4a017', navBarColor: '#0b0b0f' }), 'adegashow')!;
    const out = injectStoreHead(html, 'adegashow', s);
    expect(out).toContain('<meta name="theme-color" content="#d4a017" />');
    expect(out).toContain('<meta name="color-scheme" content="dark" />');
    expect(out).toContain('href="/app/adegashow/manifest.webmanifest"');
    expect(out).not.toContain('manifest.webmanifest?v=');
    expect(out).toMatch(/icon-192\.png\?v=[0-9a-f]{10}"/);
    expect((out.match(/name="theme-color"/g) || []).length).toBe(1);
  });
  it('a versão da identidade muda quando a loja troca a cor da barra', () => {
    const a = identityFromPayload(payload({ statusBarColor: '#d4a017' }), 'adegashow')!;
    const b = identityFromPayload(payload({ statusBarColor: '#ffffff' }), 'adegashow')!;
    expect(identityVersion(a)).not.toBe(identityVersion(b));
  });
  it('manifesto, ícone sem versão e fallback nunca ficam em cache longo; ícone real com ?v= atual é immutable', async () => {
    const app = express();
    const s = identityFromPayload({
      ...payload(),
      theme: { ...payload().theme, logo_url: 'https://cdn.example/logo.svg' },
    }, 'adegashow')!;
    const validSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#15803d"/></svg>');
    let shouldFail = true;
    app.use(createPwaRouter({
      resolveStore: async () => ({ status: 'ok', store: s }),
      publicDir: '/nonexistent',
      fetchLogo: async () => {
        if (shouldFail) throw new Error('x');
        return { bytes: validSvg, contentType: 'image/svg+xml' };
      },
    }));
    const server = await new Promise<import('node:http').Server>((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const m = await fetch(`${base}/app/adegashow/manifest.webmanifest`);
      expect(m.headers.get('cache-control')).toBe('no-cache');
      const i = await fetch(`${base}/app/adegashow/icons/icon-192.png`);
      expect(i.headers.get('cache-control')).toBe('no-cache');
      const ivFallback = await fetch(`${base}/app/adegashow/icons/icon-192.png?v=${iconVersion(s)}`);
      expect(ivFallback.headers.get('cache-control')).toBe('no-cache');
      shouldFail = false;
      const ivWrongV = await fetch(`${base}/app/adegashow/icons/icon-192.png?v=errado`);
      expect(ivWrongV.headers.get('cache-control')).toBe('no-cache');
      const ivCurrent = await fetch(`${base}/app/adegashow/icons/icon-192.png?v=${iconVersion(s)}`);
      expect(ivCurrent.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    } finally { server.close(); }
  });
});

