import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { versionedStoreScope } from '../../lib/pwa/appIdentity';
import { Button } from '../ui/Button';
import { clearDeferredPrompt, getDeferredPrompt, subscribeInstall, isStandalone, detectPlatform } from '../../lib/pwa/installState';
import { SAFE_TOP } from '../../lib/pwa/edgeToEdge';
import { isVisualUpdateSession } from '../../lib/pwa/installSession';

export const STORE_UPDATE_BAR_HEIGHT = '3.5rem';

export const UPDATE_GUIDE_STEP_1_TAB = 'Toque nos 3 pontinhos (⋮) no canto de cima e depois em "Abrir no Chrome".';
export const UPDATE_GUIDE_STEP_1_CHROME = 'Toque nos 3 pontinhos (⋮) no canto de cima.';
export const UPDATE_GUIDE_STEP_2 = 'Depois toque em "Instalar aplicativo" ou "Adicionar à tela inicial".';

/** Detecta interfaces que se identificam explicitamente como Chrome Custom Tab. */
export function likelyCustomTab(ua: string): boolean {
  return /;\s*wv[);]|\bCustomTab\b|\bCustom Tabs\b/i.test(ua);
}

/** O guia é sempre opcional: o catálogo e o checkout seguem disponíveis. */
export function StoreUpdateGuide({ slug, currentIdentity }: { slug: string; currentIdentity: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const deferred = useSyncExternalStore(subscribeInstall, getDeferredPrompt, () => null);
  const isIos = typeof navigator !== 'undefined' && (
    detectPlatform(navigator.userAgent).startsWith('ios') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
  const customTab = typeof window !== 'undefined' && isStandalone(window)
    || (typeof navigator !== 'undefined' && likelyCustomTab(navigator.userAgent));
  const enabled = !!slug && !!currentIdentity && typeof window !== 'undefined'
    && isVisualUpdateSession(window.location.search);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);

  if (!enabled) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + versionedStoreScope(slug, currentIdentity));
      setCopied(true);
    } catch { setCopied(false); }
  };

  const install = async () => {
    const prompt = getDeferredPrompt();
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
      clearDeferredPrompt();
    } catch {
      // O guia do menu ⋮ permanece disponível se o prompt for bloqueado.
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div data-testid="store-update-bar" className="sticky z-[45] flex items-center px-3"
        style={{ top: SAFE_TOP, height: STORE_UPDATE_BAR_HEIGHT, backgroundColor: 'var(--dc-bg-card-color)' }}>
        <Button type="button" variant="primary" size="lg" className="w-full font-bold"
          style={{ backgroundColor: 'var(--dc-primary)', color: 'var(--dc-button-text)', borderColor: 'var(--dc-border)' }}
          data-testid="store-update-open-guide" onClick={() => setOpen(true)}>Atualizar</Button>
      </div>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          data-testid="store-update-guide-backdrop" onMouseDown={event => {
            if (event.target === event.currentTarget) setOpen(false);
          }}>
          <div className="absolute inset-0 bg-black/60" aria-hidden="true" onMouseDown={() => setOpen(false)} />
          <section role="dialog" aria-modal="true" aria-label="Como atualizar o aplicativo"
            data-testid="store-update-guide"
            className="relative z-10 w-full max-w-md rounded-2xl p-5 shadow-xl space-y-4"
            style={{
              background: 'var(--dc-bg-card-color)', color: 'var(--dc-text-main)',
              border: '1px solid var(--dc-border)',
            }}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold">Como atualizar</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar guia"
                className="rounded-lg p-2" style={{ color: 'var(--dc-text-main)' }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {isIos ? (
              <>
                <p className="text-sm">Abra o link no Safari, toque no botão Compartilhar e depois em "Adicionar à Tela de Início".</p>
                <Button type="button" variant="outline" size="sm"
                  data-testid="store-update-copy-link" onClick={() => void copyLink()}>
                  {copied ? 'Link copiado' : 'Copiar link'}
                </Button>
              </>
            ) : (
              <>
              <div className="flex justify-end">
                <ArrowUpRight data-testid="store-update-arrow" aria-hidden="true"
                  className="h-10 w-10 motion-safe:animate-bounce motion-reduce:animate-none"
                  style={{ color: 'var(--dc-primary)' }} />
              </div>
              <ol className="space-y-3 text-sm list-decimal pl-5">
                <li>{customTab ? UPDATE_GUIDE_STEP_1_TAB : UPDATE_GUIDE_STEP_1_CHROME}</li>
                <li>{UPDATE_GUIDE_STEP_2}</li>
              </ol>
              <p className="rounded-lg p-3 text-sm" style={{
                background: 'var(--dc-bg-general-color)', border: '1px solid var(--dc-border)',
              }}>
                Vão aparecer duas opções: Instalar ou Criar atalho. Toque em <strong>Instalar</strong>.
              </p>
              {deferred && (
                <Button type="button" variant="primary" size="md" disabled={busy}
                  data-testid="store-update-native-install" isLoading={busy}
                  onClick={() => void install()}>Instalar</Button>
              )}
                </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
