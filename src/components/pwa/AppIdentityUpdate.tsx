import React, { useMemo, useState } from 'react';
import { APP_IDENTITY_META, APP_IDENTITY_RE, splitStoreSegment, storeSegmentFromPath } from '../../lib/pwa/appIdentity';
import { detectPlatform, isStandalone } from '../../lib/pwa/installState';

/** Leitura de compatibilidade; o HTML canônico não injeta mais esta meta. */
export function readAppIdentityMeta(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): string | null {
  const v = doc?.querySelector(`meta[name="${APP_IDENTITY_META}"]`)?.getAttribute('content') || '';
  return APP_IDENTITY_RE.test(v) ? v : null;
}

/** Banner discreto somente em WebAPKs legados; oferece o app canônico, nunca um novo hash. */
export function AppIdentityUpdate({ slug, storeName }: { slug: string; storeName: string }) {
  const [dismissed, setDismissed] = useState(false);
  const legacy = useMemo(() => {
    const parsed = splitStoreSegment(storeSegmentFromPath(window.location.pathname) || '');
    return parsed.slug === slug && parsed.identity !== null;
  }, [slug]);
  const standalone = useMemo(() => isStandalone(window), []);
  const android = useMemo(() => detectPlatform(navigator.userAgent || '').startsWith('android'), []);

  if (!legacy || !standalone || !android || dismissed) return null;

  const canonical = `${window.location.origin}/app/${encodeURIComponent(slug)}/`;
  const openCanonical = () => {
    let opened: Window | null = null;
    try { opened = window.open(canonical, '_blank'); } catch { /* popup bloqueado */ }
    if (!opened) window.location.assign(canonical);
  };

  return (
    <div data-testid="identity-legacy-banner" role="status"
      style={{ position: 'fixed', left: 12, right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        zIndex: 2147482000, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 14px',
        borderRadius: 999, background: 'var(--dc-bg-card-color)', color: 'var(--dc-text-main)',
        border: '1px solid var(--dc-border)', boxShadow: '0 8px 20px rgba(0,0,0,.12)' }}>
      <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>Há uma versão oficial deste app</span>
      <button type="button" data-testid="identity-open-canonical" onClick={openCanonical}
        aria-label={`Abrir app atualizado de ${storeName}`}
        style={{ background: 'var(--dc-primary)', color: 'var(--dc-button-text)', border: 0,
          borderRadius: 999, padding: '9px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
        Abrir app atualizado
      </button>
      <button type="button" aria-label="Dispensar aviso" onClick={() => setDismissed(true)}
        style={{ background: 'transparent', border: 0, color: 'var(--dc-text-main)',
          cursor: 'pointer', fontSize: 18, padding: '2px 4px' }}>×</button>
    </div>
  );
}
