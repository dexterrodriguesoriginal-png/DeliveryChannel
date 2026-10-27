// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createPwaRouter, serverManifest, identityVersion } from '../routes';
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
  it('HTML renderizado no servidor já sai com theme-color, color-scheme e manifesto versionado', () => {
    const s = identityFromPayload(payload({ statusBarColor: '#d4a017', navBarColor: '#0b0b0f' }), 'adegashow')!;
    const out = injectStoreHead(html, 'adegashow', s);
    expect(out).toContain('<meta name="theme-color" content="#d4a017" />');
    expect(out).toContain('<meta name="color-scheme" content="dark" />');
    expect(out).toMatch(/manifest\.webmanifest\?v=[0-9a-f]{10}"/);
    expect((out.match(/name="theme-color"/g) || []).length).toBe(1);
  });
  it('a versão do manifesto muda quando a loja troca a cor da barra', () => {
    const a = identityFromPayload(payload({ statusBarColor: '#d4a017' }), 'adegashow')!;
    const b = identityFromPayload(payload({ statusBarColor: '#ffffff' }), 'adegashow')!;
    expect(identityVersion(a)).not.toBe(identityVersion(b));
  });
  it('manifesto e ícone sem versão nunca ficam em cache longo', async () => {
    const app = express();
    const s = identityFromPayload(payload(), 'adegashow')!;
    app.use(createPwaRouter({ resolveStore: async () => ({ status: 'ok', store: s }), publicDir: '/nonexistent', fetchLogo: async () => { throw new Error('x'); } }));
    const server = await new Promise<import('node:http').Server>((r) => { const sv = app.listen(0, '127.0.0.1', () => r(sv)); });
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const m = await fetch(`${base}/app/adegashow/manifest.webmanifest`);
      expect(m.headers.get('cache-control')).toBe('no-cache');
      const i = await fetch(`${base}/app/adegashow/icons/icon-192.png`);
      expect(i.headers.get('cache-control')).toBe('no-cache');
      const iv = await fetch(`${base}/app/adegashow/icons/icon-192.png?v=abc`);
      expect(iv.headers.get('cache-control')).toContain('max-age=86400');
    } finally { server.close(); }
  });
});
