import { describe, expect, it } from 'vitest';
import { detectInstalledWebApp } from '../installedWebApp';

describe('detectInstalledWebApp', () => {
  const manifestUrl = 'https://deliverychannel.ai.studio/totem/adegasshow/manifest.webmanifest';
  const manifestId = '/totem-id/27b1aaec-eb02-4a1a-93bb-eed4f2b1d0df';

  it('is true in standalone/fullscreen even without the related-apps API', async () => {
    expect(await detectInstalledWebApp({ standalone: true })).toBe(true);
  });

  it('matches the totem by manifest id or url (absolute or relative)', async () => {
    expect(await detectInstalledWebApp({
      manifestUrl, manifestId,
      getInstalledRelatedApps: async () => [{ platform: 'webapp', id: manifestId, url: manifestUrl }],
    })).toBe(true);
    expect(await detectInstalledWebApp({
      manifestUrl, manifestId,
      getInstalledRelatedApps: async () => [{ platform: 'webapp', url: '/totem/adegasshow/manifest.webmanifest' }],
    })).toBe(true);
  });

  it('ignores a different app installed on the same origin', async () => {
    expect(await detectInstalledWebApp({
      manifestUrl, manifestId,
      getInstalledRelatedApps: async () => [
        { platform: 'webapp', id: '/app-id/other', url: '/app/adegasshow/manifest.webmanifest' },
      ],
    })).toBe(false);
  });

  it('is false when the API is missing, empty, or throws', async () => {
    expect(await detectInstalledWebApp({ manifestUrl, manifestId })).toBe(false);
    expect(await detectInstalledWebApp({
      manifestUrl, manifestId,
      getInstalledRelatedApps: async () => [],
    })).toBe(false);
    expect(await detectInstalledWebApp({
      manifestUrl, manifestId,
      getInstalledRelatedApps: async () => { throw new Error('denied'); },
    })).toBe(false);
  });
});
