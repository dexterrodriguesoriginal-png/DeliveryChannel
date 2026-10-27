import { describe, expect, it } from 'vitest';
import { injectStoreHead, storeSlugFromPath, withTimeout } from '../storeHtml';

const html = `<html><head><title>ADEGAFOOD</title><meta name="theme-color" content="#15803d" /><meta name="apple-mobile-web-app-title" content="AdegaFood" /><link rel="manifest" href="/manifest.json" /></head><body></body></html>`;
const store = { id: 'tid-1', slug: 'adega-premium', name: 'Adega Premium', theme: { storeName: 'Adega <Premium> & "Co"', primaryColor: '#7c2d12' } } as any;

describe('HTML da vitrine com manifesto da loja', () => {
  it('troca o manifesto global pelo da loja e escapa os valores', () => {
    const out = injectStoreHead(html, 'adega-premium', store);
    expect(out).not.toContain('/manifest.json');
    expect(out).toContain('<link rel="manifest" href="/app/adega-premium/manifest.webmanifest?v=');
    expect(out).toContain('&lt;Premium&gt; &amp; &quot;Co&quot;');
    expect(out).not.toContain('AdegaFood');
    expect(out).toContain('content="#7c2d12"');
    expect(out).toMatch(/apple-touch-icon" href="\/app\/adega-premium\/icons\/icon-192\.png\?v=/);
    expect((out.match(/rel="manifest"/g) || []).length).toBe(1);
  });
  it('sem loja resolvida ainda injeta o manifesto da loja (nunca o global)', () => {
    const out = injectStoreHead(html, 'padaria-do-joao', null);
    expect(out).not.toContain('/manifest.json');
    expect(out).toContain('/app/padaria-do-joao/manifest.webmanifest');
  });
  it('extrai slug só de rotas de loja', () => {
    expect(storeSlugFromPath('/app/adega-premium')).toBe('adega-premium');
    expect(storeSlugFromPath('/app/adega-premium/produto/1')).toBe('adega-premium');
    expect(storeSlugFromPath('/')).toBeNull();
    expect(storeSlugFromPath('/admin')).toBeNull();
  });
  it('timeout devolve o fallback', async () => {
    expect(await withTimeout(new Promise(() => {}), 10, null)).toBeNull();
  });
});
