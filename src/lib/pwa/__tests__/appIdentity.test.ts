import { describe, it, expect } from 'vitest';
import {
  chromeIntentUrl, identityStatus, isOwnManifestHref, reinstallUrl, splitStoreSegment, storeSlugFromAppPath,
  versionedAppId, versionedManifestPath, versionedStartUrl, versionedStoreScope,
} from '../appIdentity';
import { extractStoreSlugFromPath, resolvePwaScope } from '../registerSw';
import { emailRedirectUrl } from '../../auth/authRedirect';

describe('appIdentity', () => {
  it('separa slug e versão', () => {
    expect(splitStoreSegment('mercado-teste-dc~0123456789')).toEqual({ slug: 'mercado-teste-dc', identity: '0123456789' });
    expect(splitStoreSegment('mercado-teste-dc')).toEqual({ slug: 'mercado-teste-dc', identity: null });
    expect(splitStoreSegment('x~ZZ')).toEqual({ slug: 'x~ZZ', identity: null });
    expect(storeSlugFromAppPath('/app/mercado-teste-dc~0123456789/produto/1')).toBe('mercado-teste-dc');
    expect(storeSlugFromAppPath('/app/loja/')).toBe('loja');
    expect(extractStoreSlugFromPath('/app/loja~0123456789/')).toBe('loja');
    expect(extractStoreSlugFromPath('/totem/loja/')).toBe('loja');
    expect(resolvePwaScope('/app/loja~0123456789/')).toBe('/app/loja~0123456789/');
    expect(emailRedirectUrl({ origin: 'https://x.com', pathname: '/app/mercado-teste-dc~bbbbbbbbbb/' })).toBe('https://x.com/app/mercado-teste-dc');
  });
  it('endereços da versão', () => {
    expect(versionedStoreScope('a', '0123456789')).toBe('/app/a~0123456789/');
    expect(versionedStartUrl('a', '0123456789')).toBe('/app/a~0123456789/?source=pwa');
    expect(versionedManifestPath('a', '0123456789')).toBe('/app/a~0123456789/manifest.webmanifest');
    expect(versionedAppId('t1', '0123456789')).toBe('/app-id/t1/0123456789');
    expect(reinstallUrl('https://x.com/', 'a', '0123456789')).toBe('https://x.com/app/a~0123456789/?reinstall=1');
  });
  it('status', () => {
    const base = { standalone: true, runningIdentity: null, currentIdentity: 'bbbbbbbbbb', newestLaunched: null, reinstallRequested: false };
    expect(identityStatus(base)).toBe('update-available');
    expect(identityStatus({ ...base, newestLaunched: 'bbbbbbbbbb' })).toBe('old-icon');
    expect(identityStatus({ ...base, runningIdentity: 'aaaaaaaaaa', newestLaunched: 'aaaaaaaaaa' })).toBe('update-available');
    expect(identityStatus({ ...base, runningIdentity: 'bbbbbbbbbb' })).toBe('current');
    expect(identityStatus({ ...base, standalone: false })).toBe('current');
    expect(identityStatus({ ...base, standalone: false, reinstallRequested: true })).toBe('reinstall');
  });
  it('intent do Chrome', () => {
    const u = 'https://x.com/app/a~0123456789/?reinstall=1';
    expect(chromeIntentUrl(u, { android: true })).toBe(`intent://x.com/app/a~0123456789/?reinstall=1#Intent;scheme=https;package=com.android.chrome;launchFlags=0x10000000;S.browser_fallback_url=${encodeURIComponent(u)};end`);
    expect(chromeIntentUrl(u, { android: true, package: null })).not.toContain('package=');
    expect(chromeIntentUrl(u, { android: true })).toContain('launchFlags=0x10000000');
    expect(chromeIntentUrl(u, { android: false })).toBe(u);
    expect(chromeIntentUrl('http://x.com/', { android: true })).toBe('http://x.com/');
  });
  it('manifesto da própria loja', () => {
    expect(isOwnManifestHref('/app/a/manifest.webmanifest', 'a')).toBe(true);
    expect(isOwnManifestHref('/app/a~0123456789/manifest.webmanifest', 'a')).toBe(true);
    expect(isOwnManifestHref('/app/b~0123456789/manifest.webmanifest', 'a')).toBe(false);
    expect(isOwnManifestHref('/app/a~bad/manifest.webmanifest', 'a')).toBe(false);
  });
});
