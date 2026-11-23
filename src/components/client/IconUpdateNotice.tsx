import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Copy, RefreshCw, X } from 'lucide-react';
import { offerUpdatedApp } from '../../lib/pwa/appBaseLogo';
import { storeIconVersion, type StoreIdentityInput } from '../../lib/pwa/storeManifest';
import { clearDeferredPrompt, getDeferredPrompt, subscribeInstall } from '../../lib/pwa/installState';
import { Button } from '../ui/Button';

export const ICON_UPDATE_TEXT = 'A loja atualizou o ícone do app. Para ver o novo ícone na tela inicial, desinstale e instale o app de novo.';
export const iconUpdateDismissKey = (tenantId: string, version: string) => `dc:icon-update:${tenantId}:${version}`;

export function storeIconUpdateUrl(slug: string, origin: string): string {
  return `${origin}/app/${encodeURIComponent(slug)}/?atualizar_icone=1`;
}

export function chromeIconUpdateIntent(slug: string, origin: string): string {
  const url = new URL(storeIconUpdateUrl(slug, origin));
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;end`;
}

const standalone = () => typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(display-mode: standalone)').matches);

interface NoticeProps {
  store: StoreIdentityInput;
  /** Injetáveis em testes; no aplicativo são derivados do navegador. */
  installed?: boolean;
  userAgent?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  onNavigate?: (target: string) => void;
}

export function IconUpdateNotice({ store, installed, userAgent, storage, onNavigate }: NoticeProps) {
  const isInstalled = installed ?? standalone();
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const android = /android/i.test(ua);
  const ios = /iphone|ipad|ipod/i.test(ua);
  const version = storeIconVersion(store);
  const key = iconUpdateDismissKey(store.id, version);
  const kv = storage !== undefined ? storage : (typeof window !== 'undefined' ? window.localStorage : null);
  const eligible = isInstalled && offerUpdatedApp(store) && (android || ios);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!eligible) return;
    try { setDismissed(kv?.getItem(key) === '1'); }
    catch { setDismissed(false); }
  }, [eligible, kv, key]);

  if (!eligible || dismissed) return null;
  const url = storeIconUpdateUrl(store.slug, window.location.origin);
  const dismiss = () => {
    try { kv?.setItem(key, '1'); } catch { /* armazenamento bloqueado */ }
    setDismissed(true);
  };
  const openChrome = () => {
    const target = chromeIconUpdateIntent(store.slug, window.location.origin);
    if (onNavigate) onNavigate(target);
    else window.location.href = target;
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { setCopied(false); }
  };

  return (
    <aside data-testid="icon-update-notice" role="status" aria-live="polite"
      className="fixed inset-x-3 bottom-20 z-[135] mx-auto max-w-md rounded-xl border border-amber-200 bg-white p-3 text-gray-900 shadow-xl">
      <div className="flex items-start gap-2.5">
        <RefreshCw aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs leading-relaxed">{ICON_UPDATE_TEXT}</p>
          {android ? (
            <Button type="button" variant="primary" size="sm" onClick={openChrome}>Atualizar ícone</Button>
          ) : (
            <>
              <p className="text-xs text-gray-600">Abra no Safari, toque em Compartilhar e depois Adicionar à Tela de Início.</p>
              <Button type="button" variant="primary" size="sm"
                leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copyLink()}>
                {copied ? 'Link copiado' : 'Copiar link'}
              </Button>
            </>
          )}
        </div>
        <button type="button" aria-label="Dispensar aviso" data-testid="icon-update-dismiss"
          onClick={dismiss} className="rounded-full p-1 text-gray-500 hover:bg-gray-100">
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

export function IconUpdateBrowserGuide() {
  const prompt = useSyncExternalStore(subscribeInstall, getDeferredPrompt, () => null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAndroidChrome = /android/i.test(navigator.userAgent) && /chrome\//i.test(navigator.userAgent);
  const active = !standalone() && isAndroidChrome &&
    new URLSearchParams(window.location.search).get('atualizar_icone') === '1';

  if (!active || dismissed) return null;
  const install = async () => {
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await prompt.prompt();
      clearDeferredPrompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setDismissed(true);
    } catch { /* o botão continua disponível quando surgir novo prompt */ }
    finally { setBusy(false); }
  };
  return (
    <section data-testid="icon-update-guide" role="region" aria-label="Atualizar ícone do aplicativo"
      className="fixed top-[calc(env(safe-area-inset-top,0px)+0.75rem)] inset-x-3 z-[145] mx-auto max-w-lg rounded-2xl border border-emerald-200 bg-white p-4 text-gray-900 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Atualize o ícone da loja</h2>
        <button type="button" aria-label="Fechar guia" onClick={() => setDismissed(true)}
          className="rounded-full p-1 text-gray-600 hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-3 space-y-2 text-xs leading-relaxed">
        <p><strong>Passo 1.</strong> Remova o ícone antigo da sua tela inicial (segure o ícone e toque em Desinstalar/Remover).</p>
        <p><strong>Passo 2.</strong> Toque em Instalar aplicativo abaixo para baixar o ícone com a nova logo.</p>
      </div>
      <p className="my-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
        Se aparecer Abrir em vez de Instalar, apague o ícone antigo e volte para esta aba.
      </p>
      <Button type="button" variant="primary" size="md" disabled={!prompt || busy}
        isLoading={busy} onClick={() => void install()}>Instalar aplicativo</Button>
      {!prompt && <p className="mt-2 text-xs text-gray-500">Se o Chrome não oferecer a instalação, use ⋮ e selecione Instalar app depois de remover o ícone antigo.</p>}
    </section>
  );
}
