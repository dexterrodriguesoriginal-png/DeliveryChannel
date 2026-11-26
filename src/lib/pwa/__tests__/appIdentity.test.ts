import { describe, it, expect } from 'vitest';
import {
  chromeIntentUrl, identityStatus, isOwnManifestHref, reinstallUrl, splitStoreSegment, storeSlugFromAppPath,
  versionedAppId, versionedManifestPath, versionedStartUrl, versionedStoreScope, versionedStoreRedirect,
} from '../appIdentity';
import { extractStoreSlugFromPath, resolvePwaScope } from '../registerSw';
import { emailRedirectUrl } from '../../auth/authRedirect';
import { storeAppIdentity, storeIconVersion, type StoreIdentityInput } from '../storeManifest';
import { appBaseNavColorToSave, isVersionedStoreApp } from '../appVersionMode';

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
  it('WebAPK antigo abre Custom Tab na vitrine oficial com atualizar=1, sem instalação', () => {
    const original = {
      slug: 'loja', currentIdentity: 'bbbbbbbbbb', runningIdentity: 'aaaaaaaaaa',
      standalone: true, previewMode: false, search: '?origem=qr', hash: '#produtos',
      isLoadingStore: false, storeLoaded: true, reloadUnsafe: false,
      alreadyRedirected: false,
    };
    expect(versionedStoreRedirect(original)).toBe('/app/loja~bbbbbbbbbb/?origem=qr&atualizar=1#produtos');
    expect(versionedStoreRedirect({ ...original, runningIdentity: null }))
      .toBe('/app/loja~bbbbbbbbbb/?origem=qr&atualizar=1#produtos');
    expect(versionedStoreRedirect({ ...original, reloadUnsafe: true })).toBeNull();
    expect(versionedStoreRedirect({ ...original, alreadyRedirected: true })).toBeNull();
    expect(versionedStoreRedirect({ ...original, isLoadingStore: true })).toBeNull();
    expect(versionedStoreRedirect({ ...original, storeLoaded: false })).toBeNull();
    expect(versionedStoreRedirect({ ...original, currentIdentity: null })).toBeNull();
    expect(versionedStoreRedirect({ ...original, runningIdentity: 'bbbbbbbbbb' })).toBeNull();
    expect(versionedStoreRedirect({ ...original, previewMode: true })).toBeNull();
    expect(versionedStoreRedirect({ ...original, search: '?mesa=abc' })).toBeNull();
    expect(versionedStoreRedirect({ ...original, search: '?preview=1' })).toBeNull();
    expect(versionedStoreRedirect({ ...original, search: '?instalar=1&origem=qr' }))
      .toBe('/app/loja~bbbbbbbbbb/?origem=qr&atualizar=1#produtos');
    expect(versionedStoreRedirect({ ...original, search: '?atualizar=1', runningIdentity: 'bbbbbbbbbb' }))
      .toBeNull();
  });
  it('visitante do Chrome chega ao scope oficial SEM sessão atualizar', () => {
    const browser = {
      slug: 'loja', currentIdentity: 'bbbbbbbbbb', runningIdentity: null,
      standalone: false, previewMode: false, search: '?origem=qr', hash: '',
      isLoadingStore: false, storeLoaded: true, reloadUnsafe: false,
      alreadyRedirected: false,
    };
    expect(versionedStoreRedirect(browser)).toBe('/app/loja~bbbbbbbbbb/?origem=qr');
    expect(versionedStoreRedirect({ ...browser, runningIdentity: 'aaaaaaaaaa' })).toBeNull();
    expect(versionedStoreRedirect({ ...browser, search: '?mesa=mesa1' })).toBeNull();
  });

  it('manifesto da própria loja', () => {
    expect(isOwnManifestHref('/app/a/manifest.webmanifest', 'a')).toBe(true);
    expect(isOwnManifestHref('/app/a~0123456789/manifest.webmanifest', 'a')).toBe(true);
    expect(isOwnManifestHref('/app/b~0123456789/manifest.webmanifest', 'a')).toBe(false);
    expect(isOwnManifestHref('/app/a~bad/manifest.webmanifest', 'a')).toBe(false);
  });
});

describe('identidade de instalação — ícone e barra de navegação', () => {
  const base: StoreIdentityInput = {
    id: 'tenant-1', slug: 'loja', name: 'Loja',
    iconContentHash: 'digest-1',
    theme: { storeName: 'Loja', logoUrl: '/logo.png', navBarColor: '#334455',
      statusBarColor: '#102030', headerColor: '#456789', primaryColor: '#445566' },
  };
  it('mesmos dados produzem exatamente 10 caracteres hexadecimais estáveis', () => {
    const version = storeAppIdentity(base);
    expect(version).toMatch(/^[0-9a-f]{10}$/);
    expect(storeAppIdentity({ ...base, theme: { ...base.theme } })).toBe(version);
  });
  it('muda só com a imagem, o digest ou a barra nav resolvida', () => {
    const before = storeAppIdentity(base);
    expect(storeAppIdentity({ ...base, theme: { ...base.theme, logoUrl: '/new.png' } })).not.toBe(before);
    expect(storeAppIdentity({ ...base, iconContentHash: 'digest-2' })).not.toBe(before);
    expect(storeAppIdentity({ ...base, theme: { ...base.theme, navBarColor: '#223344' } })).not.toBe(before);
    expect(storeAppIdentity({ ...base, theme: { ...base.theme, navBarColor: '#345' } }))
      .toBe(storeAppIdentity({ ...base, theme: { ...base.theme, navBarColor: '#334455' } }));
    expect(storeIconVersion({ ...base, theme: { ...base.theme, navBarColor: '#223344' } }))
      .toBe(storeIconVersion(base)); // PNG nunca muda só por causa da barra
  });
  it('não muda com nome, slogan, cores de status/primária/cabeçalho, nem timestamps com logo', () => {
    const other = {
      ...base, name: 'Outro nome', updatedAt: '2026-01-02',
      theme: {
        ...base.theme, storeName: 'Outro nome', shortName: 'Curto', tagline: 'Nova frase',
        primaryColor: '#eefecc', headerColor: '#112233', statusBarColor: '#ffffff',
        updatedAt: '2026-01-03',
      },
    };
    expect(storeAppIdentity(other)).toBe(storeAppIdentity(base));
  });
  it('sem logo, nome e cor das iniciais fazem parte do hash de instalação', () => {
    const noLogo: StoreIdentityInput = { ...base, theme: { storeName: 'Loja', navBarColor: '#334455' } };
    expect(storeAppIdentity({ ...noLogo, name: 'Outra', theme: { ...noLogo.theme, storeName: 'Outra' } }))
      .not.toBe(storeAppIdentity(noLogo));
  });
  it('não habilita versão antes da primeira mudança confirmada de logo ou nav', () => {
    expect(isVersionedStoreApp(base)).toBe(false);
    expect(isVersionedStoreApp({ ...base, appBaseLogoUrl: '/before.png', logoConfirmedUrl: '/different.png' })).toBe(false);
    expect(isVersionedStoreApp({ ...base, appBaseLogoUrl: '/before.png', logoConfirmedUrl: '/logo.png' })).toBe(true);
    expect(isVersionedStoreApp({ ...base, appBaseNavColor: '#334455' })).toBe(false);
    expect(isVersionedStoreApp({ ...base, appBaseNavColor: '#112233' })).toBe(true);
    expect(appBaseNavColorToSave(undefined, '#334455', '#334455')).toBeUndefined();
    expect(appBaseNavColorToSave(undefined, '#334455', '#112233')).toBe('#334455');
    expect(appBaseNavColorToSave('#334455', '#112233', '#223344')).toBe('#334455');
  });
});
