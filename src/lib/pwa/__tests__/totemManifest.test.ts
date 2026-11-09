import { describe, expect, it } from 'vitest';
import { buildTotemManifest, injectTotemHead, isTotemRoute, totemAppId, totemInstallPath, totemSlugFromPath } from '../totemManifest';

describe('totem PWA manifest', () => {
  it('uses display fullscreen and a /totem start URL', () => {
    const manifest = buildTotemManifest({
      id: 'tn', slug: 'cafe-da-praca', name: 'Café da Praça',
      theme: { storeName: 'Café da Praça', primaryColor: '#1D4ED8' },
    }, 'https://app.example');
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.start_url).toBe('https://app.example/totem/cafe-da-praca/?source=pwa');
    expect(manifest.scope).toBe('https://app.example/totem/cafe-da-praca/');
    expect(manifest.id).toBe('https://app.example/totem-id/tn');
    expect(manifest.id).not.toContain('/app-id/');
    expect(manifest.related_applications).toEqual([
      { platform: 'webapp', url: 'https://app.example/totem/cafe-da-praca/manifest.webmanifest' },
    ]);
  });

  it('builds an install path and a distinct app id', () => {
    expect(totemInstallPath('cafe-da-praca')).toBe('/totem/cafe-da-praca/?install=1');
    expect(totemAppId('tn')).toBe('/totem-id/tn');
  });

  it('detects the totem route and injects the manifest link', () => {
    expect(isTotemRoute('/totem/cafe-da-praca')).toBe(true);
    expect(totemSlugFromPath('/totem/cafe-da-praca/')).toBe('cafe-da-praca');
    expect(isTotemRoute('/mesa/abc')).toBe(false);
    const html = injectTotemHead('<html><head><title>x</title><link rel="manifest" href="/manifest.json" /></head><body></body></html>', 'cafe-da-praca', 'Café — Totem');
    expect(html).toContain('/totem/cafe-da-praca/manifest.webmanifest');
    expect(html).not.toContain('/manifest.json');
    expect(html).toContain('<title>Café — Totem</title>');
    const withStore = injectTotemHead('<html><head><title>x</title></head><body></body></html>', 'cafe-da-praca', 'Café — Totem', {
      id: 'tn', slug: 'cafe-da-praca', name: 'Café da Praça', theme: { storeName: 'Café da Praça', logoUrl: 'https://cdn.example/logo.png' },
    });
    expect(withStore).toContain('rel="apple-touch-icon"');
    expect(withStore).toContain('/app/cafe-da-praca/icons/icon-192.png?v=');
    expect(withStore).toContain('data-server-injected="1"');
  });
});
