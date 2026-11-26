import React, { useState, useSyncExternalStore, useLayoutEffect } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '../ui/Button';
import { StoreLogo } from '../client/StoreLogo';
import { getDeferredPrompt, subscribeInstall, wasAppInstalledEvent, clearDeferredPrompt } from '../../lib/pwa/installState';
import { setIconNoticeVisible, setReplacedScreenVisible } from '../client/IconUpdateNotice';
import { isInstallSession } from '../../lib/pwa/installSession';

export const REINSTALL_PROMPT_WAIT_MS = 8000;
export const INSTALL_READY_TEXT = 'Pronto. Abra o novo app na tela do seu celular.';
export const INSTALL_NO_PROMPT_TEXT = 'Toque em ⋮ no canto de cima e depois em "Abrir no Chrome"';

export function shouldShowVersionInstallScreen(input: {
  standalone: boolean; runningIdentity: string | null;
  currentIdentity: string | null; search: string; previewMode: boolean;
}): boolean {
  // ?instalar=1 é sessão explícita: a Custom Tab do WebAPK antigo reporta display-mode
  // standalone, mas não é o app novo instalado.
  return !input.previewMode
    && !!input.currentIdentity && input.runningIdentity === input.currentIdentity
    && isInstallSession(input.search);
}

/** A tela pertence ao WebAPK DA LOJA, não ao manifesto global. */
export function VersionInstallScreen({ storeName, logoUrl }: { storeName: string; logoUrl?: string | null }) {
  const deferred = useSyncExternalStore(subscribeInstall, getDeferredPrompt, () => null);
  const installed = useSyncExternalStore(subscribeInstall, wasAppInstalledEvent, () => false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useLayoutEffect(() => {
    setIconNoticeVisible(true);
    setReplacedScreenVisible(true);
    return () => {
      setReplacedScreenVisible(false);
      setIconNoticeVisible(false);
    };
  }, []);

  const installUrl = () => (typeof window !== 'undefined' ? window.location.href : '');

  const install = async () => {
    const prompt = getDeferredPrompt();
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
      clearDeferredPrompt();
      // 'accepted' is not yet installed; wait for the appinstalled event.
    } catch {
      // Sem prompt, a orientação de abrir no Chrome já aparece abaixo.
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const url = installUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const shareLink = async () => {
    const url = installUrl();
    if (!url || typeof navigator.share !== 'function') return;
    try {
      await navigator.share({ title: storeName, url });
    } catch {
      // Usuário cancelou ou o compartilhamento falhou; o Copiar link permanece.
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
      ) : deferred ? (
        <Button type="button" variant="primary" size="lg" disabled={busy}
          isLoading={busy} onClick={() => void install()}
          data-testid="version-install-button">Instalar</Button>
      ) : (
        <>
          <p data-testid="version-install-no-prompt" className="text-sm"
            style={{ color: 'var(--dc-text-main)' }}>{INSTALL_NO_PROMPT_TEXT}</p>
          <div className="flex flex-col items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}
              data-testid="version-install-copy-link"
              leftIcon={<Copy className="h-3.5 w-3.5" />}>{copied ? 'Link copiado' : 'Copiar link'}</Button>
            {canShare && (
              <Button type="button" variant="outline" size="sm" onClick={() => void shareLink()}
                data-testid="version-install-share">Compartilhar</Button>
            )}
          </div>
        </>
      )}
    </main>
  );
}
