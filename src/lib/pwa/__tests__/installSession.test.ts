import { afterEach, describe, expect, it } from 'vitest';
import {
  INSTALL_PARAM, PENDING_INSTALL_TTL_MS, applyInstallSessionFromLocation, clearAllPendingInstalls,
  clearPendingInstall, hasFreshPendingInstall, isInstallSession, markPendingInstall,
  pendingInstallKey, searchToAddInstallSession,
} from '../installSession';

function memory() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
}

afterEach(() => {
  try { localStorage.clear(); } catch { /* ok */ }
});

describe('installSession', () => {
  it('reconhece só ?instalar=1', () => {
    expect(isInstallSession('?instalar=1')).toBe(true);
    expect(isInstallSession('instalar=1&source=pwa')).toBe(true);
    expect(isInstallSession('?source=pwa')).toBe(false);
    expect(isInstallSession('?instalar=0')).toBe(false);
    expect(isInstallSession('')).toBe(false);
    expect(INSTALL_PARAM).toBe('instalar');
  });

  it('marca pendente com validade, identidade alvo e limpa', () => {
    const s = memory();
    const id = '0123456789';
    expect(hasFreshPendingInstall('loja', id, s, 1000)).toBe(false);
    markPendingInstall('loja', id, s, 1000);
    expect(JSON.parse(s.getItem(pendingInstallKey('loja')) || '')).toEqual({ at: 1000, identity: id });
    expect(hasFreshPendingInstall('loja', id, s, 1000 + PENDING_INSTALL_TTL_MS - 1)).toBe(true);
    expect(hasFreshPendingInstall('loja', id, s, 1000 + PENDING_INSTALL_TTL_MS)).toBe(false);
    expect(hasFreshPendingInstall('loja', 'aaaaaaaaaa', s, 1000)).toBe(false);
    expect(hasFreshPendingInstall('outra', id, s, 1000)).toBe(false);
    clearPendingInstall('loja', s);
    expect(hasFreshPendingInstall('loja', id, s, 1000)).toBe(false);
  });

  it('acrescenta ?instalar=1 só no start_url da identidade alvo', () => {
    const s = memory();
    const path = '/app/loja~0123456789/';
    expect(searchToAddInstallSession(path, '?source=pwa', s, 2000)).toBeNull();
    markPendingInstall('loja', '0123456789', s, 2000);
    expect(searchToAddInstallSession(path, '?source=pwa', s, 2000)).toBe('?source=pwa&instalar=1');
    expect(searchToAddInstallSession('/app/loja~aaaaaaaaaa/', '?source=pwa', s, 2000)).toBeNull();
    expect(searchToAddInstallSession(path, '?instalar=1&source=pwa', s, 2000)).toBeNull();
    expect(searchToAddInstallSession('/app/loja/', '?source=pwa', s, 2000)).toBeNull();
    expect(searchToAddInstallSession(path, '?source=pwa', s, 2000 + PENDING_INSTALL_TTL_MS)).toBeNull();
  });

  it('não altera o start_url estável nem path sem marca', () => {
    const s = memory();
    markPendingInstall('loja', '0123456789', s, 1);
    expect(searchToAddInstallSession('/app/loja/', '?source=pwa', s, 1)).toBeNull();
    expect(searchToAddInstallSession('/tv', '?source=pwa', s, 1)).toBeNull();
  });

  it('applyInstallSessionFromLocation grava a query sem recarregar', () => {
    const s = memory();
    markPendingInstall('loja', '0123456789', s, 5000);
    const loc = { pathname: '/app/loja~0123456789/', search: '?source=pwa', hash: '#x' };
    let stored = '';
    const w = {
      location: loc,
      history: {
        state: null,
        replaceState: (_s: unknown, _t: string, url: string) => {
          stored = url;
          const u = new URL(url, 'https://example.test');
          loc.pathname = u.pathname;
          loc.search = u.search;
          loc.hash = u.hash;
        },
      },
    } as unknown as Window;
    expect(applyInstallSessionFromLocation(w, s, 5000)).toBe(true);
    expect(stored).toBe('/app/loja~0123456789/?source=pwa&instalar=1#x');
    expect(loc.search).toContain('instalar=1');
    expect(applyInstallSessionFromLocation(w, s, 5000)).toBe(false);
  });

  it('clearAllPendingInstalls remove só as marcas de instalação', () => {
    const s = memory();
    s.setItem('dc:pending-install:a', '1');
    s.setItem('dc:pending-install:b', '2');
    s.setItem('dc:app-identity:a', '0123456789');
    clearAllPendingInstalls(s);
    expect(s.getItem('dc:pending-install:a')).toBeNull();
    expect(s.getItem('dc:pending-install:b')).toBeNull();
    expect(s.getItem('dc:app-identity:a')).toBe('0123456789');
  });
});
