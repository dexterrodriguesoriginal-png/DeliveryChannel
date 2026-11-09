import { describe, expect, it } from 'vitest';
import { buildTotemManifest, injectTotemHead, isTotemRoute, totemSlugFromPath } from '../totemManifest';

describe('totem PWA manifest', () => {
  it('uses display fullscreen and a /totem start URL', () => {
    const manifest = buildTotemManifest({
      id: 'tn', slug: 'cafe-da-praca', name: 'Café da Praça',
      theme: { storeName: 'Café da Praça', primaryColor: '#1D4ED8' },
    }, 'https://app.example');
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.start_url).toBe('https://app.example/totem/cafe-da-praca/?source=pwa');
    expect(manifest.scope).toBe('https://app.example/totem/cafe-da-praca/');
  });

  it('detects the totem route and injects the manifest link', () => {
    expect(isTotemRoute('/totem/cafe-da-praca')).toBe(true);
    expect(totemSlugFromPath('/totem/cafe-da-praca/')).toBe('cafe-da-praca');
    expect(isTotemRoute('/mesa/abc')).toBe(false);
    const html = injectTotemHead('<html><head><title>x</title><link rel="manifest" href="/manifest.json" /></head><body></body></html>', 'cafe-da-praca', 'Café — Totem');
    expect(html).toContain('/totem/cafe-da-praca/manifest.webmanifest');
    expect(html).not.toContain('/manifest.json');
    expect(html).toContain('<title>Café — Totem</title>');
  });
});
