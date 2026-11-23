import React, { useEffect, useRef, useState } from 'react';
import { Copy, RefreshCw, X } from 'lucide-react';
import { publicStoreRepository } from '../../repositories/publicStoreRepository';
import { offerUpdatedApp } from '../../lib/pwa/appBaseLogo';
import { storeIconVersion, type StoreIdentityInput } from '../../lib/pwa/storeManifest';
import { detectPlatform, isStandalone } from '../../lib/pwa/installState';

import { Button } from '../ui/Button';

export const ICON_UPDATE_TEXT = 'A loja atualizou o ícone do app. Para ver o novo ícone na tela inicial, desinstale e instale o app de novo.';
export const iconUpdateDismissKey = (tenantId: string, version: string) => `dc:icon-update:${tenantId}:${version}`;

export function storeIconUpdateUrl(slug: string, origin: string): string {
  return `${origin}/atualizar-icone/${encodeURIComponent(slug)}`;
}

/** For Chrome intents, the fallback MUST be an absolute HTTPS URL. */
export function secureIconUpdateUrl(slug: string, origin: string): string {
  const source = new URL(origin);
  source.protocol = 'https:';
  return storeIconUpdateUrl(slug, source.origin);
}

export function chromeIconUpdateIntent(slug: string, origin: string): string {
  const url = secureIconUpdateUrl(slug, origin);
  const target = new URL(url);
  return `intent://${target.host}${target.pathname}#Intent;scheme=https;package=com.android.chrome;launchFlags=0x10000000;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

/** Single source for the two existing notices and the global service-worker toast. */
let iconNoticeVisible = false;
const iconNoticeListeners = new Set<() => void>();
export const subscribeIconNotice = (listener: () => void) => {
  iconNoticeListeners.add(listener);
  return () => { iconNoticeListeners.delete(listener); };
};
export const getIconNoticeVisible = () => iconNoticeVisible;
function setIconNoticeVisible(value: boolean) {
  if (iconNoticeVisible === value) return;
  iconNoticeVisible = value;
  iconNoticeListeners.forEach(listener => listener());
}

const standalone = () => typeof window !== 'undefined' && isStandalone(window);
const isBlockingWebview = (ua: string) => /;\s*wv[);]|FBAN|FBAV|Instagram|WhatsApp|\bWebView\b/i.test(ua);
export const ICON_INTENT_FALLBACK_MS = 1500;

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
  const platform = detectPlatform(ua);
  const android = platform === 'android-chrome' || platform === 'android-other';
  const ios = platform === 'ios-safari' || platform === 'ios-other';
  const version = storeIconVersion(store);
  const key = iconUpdateDismissKey(store.id, version);
  const kv = storage !== undefined ? storage : (typeof window !== 'undefined' ? window.localStorage : null);
  const eligible = isInstalled && offerUpdatedApp(store) && (android || ios);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLeave = useRef(false);

  useEffect(() => {
    const noteLeft = () => {
      didLeave.current = true;
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
    };
    const onVisibility = () => { if (document.visibilityState !== 'visible') noteLeft(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', noteLeft);
    return () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', noteLeft);
    };
  }, []);

  useEffect(() => {
    if (!eligible) return;
    try { setDismissed(kv?.getItem(key) === '1'); }
    catch { setDismissed(false); }
  }, [eligible, kv, key]);

  useEffect(() => {
    const visible = eligible && !dismissed;
    setIconNoticeVisible(visible);
    return () => setIconNoticeVisible(false);
  }, [eligible, dismissed]);

  if (!eligible || dismissed) return null;
  const dismiss = () => {
    try { kv?.setItem(key, '1'); } catch { /* armazenamento bloqueado */ }
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    setDismissed(true);
  };
  const openChrome = () => {
    didLeave.current = false;
    setShowFallback(false);
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    const target = chromeIconUpdateIntent(store.slug, window.location.origin);
    // Some embedded Android webviews reject intents immediately. Keep an escape hatch.
    if (isBlockingWebview(ua)) setShowFallback(true);
    fallbackTimer.current = setTimeout(() => {
      fallbackTimer.current = null;
      if (!didLeave.current && document.visibilityState === 'visible' && isStandalone(window)) {
        setShowFallback(true);
      }
    }, ICON_INTENT_FALLBACK_MS);
    try {
      if (onNavigate) onNavigate(target);
    } catch {
      if (!didLeave.current) setShowFallback(true);
    }
  };
  const copyLink = async (includeQuery = false) => {
    try { await navigator.clipboard.writeText(includeQuery ? secureIconUpdateUrl(store.slug, window.location.origin)
      : `${window.location.origin}/app/${encodeURIComponent(store.slug)}/`); setCopied(true); }
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
            <a href={chromeIconUpdateIntent(store.slug, window.location.origin)}
              target="_blank" rel="noopener noreferrer"
              data-testid="icon-update-open-chrome" onClick={openChrome}
              className="inline-flex items-center justify-center rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">
              Atualizar ícone
            </a>
          ) : (
            <>
              <p className="text-xs text-gray-600">Abra no Safari, toque em Compartilhar e depois Adicionar à Tela de Início.</p>
              <Button type="button" variant="primary" size="sm"
                leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copyLink()}>
                {copied ? 'Link copiado' : 'Copiar link'}
              </Button>
            </>
          )}
          {android && showFallback && (
            <div data-testid="icon-update-fallback" role="region" aria-label="Abrir no navegador"
              className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-2">
              <p className="text-xs text-gray-800">
                <strong>Abrir no navegador:</strong> toque em ⋮ e depois "Abrir no Chrome".
              </p>
              <Button type="button" variant="outline" size="sm"
                onClick={() => void copyLink(true)}
                leftIcon={<Copy className="h-3.5 w-3.5" />}>
                {copied ? 'Link copiado' : 'Copiar link'}
              </Button>
            </div>
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

export function IconUpdateBrowserGuide({ slug, storeName, logoUrl }: {
  slug: string; storeName?: string; logoUrl?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const storeUrl = `/app/${encodeURIComponent(slug)}/`;

  return (
    <section data-testid="icon-update-guide" role="region" aria-label="Atualizar ícone do aplicativo"
      className="mx-auto w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-5 text-gray-900 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Atualize o ícone da loja</h2>
        <button type="button" aria-label="Fechar guia" onClick={() => setDismissed(true)}
          className="rounded-full p-1 text-gray-600 hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>
      {logoUrl && <img src={logoUrl} alt={`Logo de ${storeName || 'loja'}`}
        className="mx-auto my-4 h-20 w-20 rounded-xl object-contain" />}
      {storeName && <p className="mt-2 text-center text-sm font-semibold">{storeName}</p>}
      <div className="mt-3 space-y-2 text-xs leading-relaxed">
        <p><strong>Passo 1.</strong> Remova o ícone antigo da sua tela inicial (segure o ícone e toque em Desinstalar/Remover).</p>
        <p><strong>Passo 2.</strong> Toque em Instalar aplicativo abaixo para baixar o ícone com a nova logo.</p>
      </div>
      <p className="my-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
        Se aparecer Abrir em vez de Instalar, apague o ícone antigo e volte para esta aba.
      </p>
      {/* O guia fica fora do scope da loja: um prompt nativo aqui instalaria o app GLOBAL.
          Sempre levar o cliente ao scope correto para instalar o WebAPK da loja. */}
      <a href={storeUrl} data-testid="icon-update-install-link"
        className="inline-flex rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800">
        Instalar aplicativo
      </a>
      <p className="mt-2 text-xs text-gray-500">
        Se não aparecer a instalação, abra a loja no Chrome e use ⋮ → Instalar app depois de remover o ícone antigo.
      </p>
    </section>
  );
}

/** Página independente do scope WebAPK, mantida no SPA sem links capturados pelo app. */
export function IconUpdateGuidePage({ slug }: { slug: string }) {
  const [info, setInfo] = useState<{ name: string; logoUrl?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void publicStoreRepository.loadPublicStore(slug).then(result => {
      if (!alive || result.status !== 'ok') return;
      setInfo({ name: result.data.theme?.storeName || result.data.tenant.name,
        logoUrl: result.data.theme?.logoUrl });
    });
    return () => { alive = false; };
  }, [slug]);
  return (
    <main data-testid="icon-update-guide-page"
      className="min-h-screen bg-gray-50 px-4 py-12 text-gray-900">
      <IconUpdateBrowserGuide slug={slug} storeName={info?.name} logoUrl={info?.logoUrl} />
    </main>
  );
}
