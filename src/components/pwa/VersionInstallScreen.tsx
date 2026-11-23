import React, { useEffect, useState, useSyncExternalStore, useLayoutEffect } from 'react';
import { Button } from '../ui/Button';
import { StoreLogo } from '../client/StoreLogo';
import { getDeferredPrompt, subscribeInstall, wasAppInstalledEvent, isStandalone, clearDeferredPrompt } from '../../lib/pwa/installState';
import { setIconNoticeVisible, setReplacedScreenVisible } from '../client/IconUpdateNotice';

export const REINSTALL_PROMPT_WAIT_MS = 8000;
export const INSTALL_READY_TEXT = 'Pronto. Abra o novo app na tela do seu celular.';
export const INSTALL_NO_PROMPT_TEXT = 'Toque em ⋮ e em Abrir no Chrome';

export function shouldShowVersionInstallScreen(input: {
  standalone: boolean; runningIdentity: string | null;
  currentIdentity: string | null; search: string; previewMode: boolean;
}): boolean {
  return !input.previewMode && !input.standalone
    && !!input.currentIdentity && input.runningIdentity === input.currentIdentity
    && new URLSearchParams(input.search).get('instalar') === '1';
}

/** A tela pertence ao WebAPK DA LOJA, não ao manifesto global. */
export function VersionInstallScreen({ storeName, logoUrl }: { storeName: string; logoUrl?: string | null }) {
  const deferred = useSyncExternalStore(subscribeInstall, getDeferredPrompt, () => null);
  const installed = useSyncExternalStore(subscribeInstall, wasAppInstalledEvent, () => false);
  const [noPrompt, setNoPrompt] = useState(false);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    setIconNoticeVisible(true);
    setReplacedScreenVisible(true);
    return () => {
      setReplacedScreenVisible(false);
      setIconNoticeVisible(false);
    };
  }, []);

  useEffect(() => {
    if (installed || deferred) { setNoPrompt(false); return; }
    const timer = window.setTimeout(() => setNoPrompt(true), REINSTALL_PROMPT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [installed, deferred]);

  const install = async () => {
    const prompt = getDeferredPrompt();
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      clearDeferredPrompt();
      if (choice.outcome === 'dismissed') setNoPrompt(true);
      // 'accepted' is not yet installed; wait for the appinstalled event.
    } catch {
      setNoPrompt(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main role="main" data-testid="version-install-screen"
      className="fixed inset-0 z-[2147483000] flex flex-col items-center justify-center gap-5 p-6 text-center"
      style={{
        background: 'var(--dc-bg-card-color)', color: 'var(--dc-text-main)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
      }}>
      <StoreLogo logoUrl={logoUrl || undefined} name={storeName} color="var(--dc-primary)" className="h-20 w-20" />
      <h1 className="text-xl font-bold">{storeName}</h1>
      {installed ? (
        <p data-testid="version-install-success" className="text-sm">{INSTALL_READY_TEXT}</p>
      ) : (
        <>
          <Button type="button" variant="primary" size="lg" disabled={!deferred || busy}
            isLoading={busy} onClick={() => void install()}
            data-testid="version-install-button">Instalar</Button>
          {noPrompt && <p data-testid="version-install-no-prompt" className="text-sm">{INSTALL_NO_PROMPT_TEXT}</p>}
        </>
      )}
    </main>
  );
}
