import React, { useLayoutEffect } from 'react';
import { setIconNoticeVisible } from '../client/IconUpdateNotice';
import { versionedStartUrl } from '../../lib/pwa/appIdentity';

/** Bloqueia totalmente a interface da instalação substituída. */
export function AppIdentityUpdate({ slug, currentIdentity }: { slug: string; currentIdentity: string }) {
  useLayoutEffect(() => {
    setIconNoticeVisible(true);
    return () => setIconNoticeVisible(false);
  }, []);
  const nextUrl = versionedStartUrl(slug, currentIdentity);
  return (
    <main data-testid="identity-replaced-screen" role="main"
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483000,
        background: 'var(--dc-bg-card-color)', color: 'var(--dc-text-main)',
        padding: 'calc(env(safe-area-inset-top, 0px) + 24px) 20px calc(env(safe-area-inset-bottom, 0px) + 24px)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 22,
      }}>
      <p style={{ maxWidth: 340, textAlign: 'center', lineHeight: 1.6, fontWeight: 600 }}>
        Esta versão foi substituída. A nova versão já está instalada no seu celular. Remova esta versão e abra a nova.
      </p>
      <a href={nextUrl} data-testid="identity-open-new-version"
        style={{
          background: 'var(--dc-primary)', color: 'var(--dc-button-text)',
          border: '1px solid var(--dc-border)', borderRadius: 12,
          padding: '12px 20px', fontWeight: 700, textDecoration: 'none',
        }}>
        Abrir nova versão
      </a>
    </main>
  );
}
