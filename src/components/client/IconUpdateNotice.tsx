import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { chromeIntentUrl, versionedStoreScope } from '../../lib/pwa/appIdentity';
import type { StoreIdentityInput } from '../../lib/pwa/storeManifest';
import { detectPlatform, isStandalone } from '../../lib/pwa/installState';
import { Button } from '../ui/Button';

export const ICON_UPDATE_TEXT = 'Atualize para a nova versão';
export const ICON_INTENT_FALLBACK_MS = 1500;

/** URL da instalação oficial atual, sem caminhos ou parâmetros de reinstalação. */
export function storeIconUpdateUrl(slug: string, identity: string, origin: string): string {
  const base = new URL(origin);
  base.protocol = 'https:';
  return base.origin + versionedStoreScope(slug, identity);
}
export const chromeIconUpdateIntent = (slug: string, identity: string, origin: string) =>
  chromeIntentUrl(storeIconUpdateUrl(slug, identity, origin), { android: true });

let iconNoticeVisible = false;
const iconNoticeListeners = new Set<() => void>();
export const subscribeIconNotice = (listener: () => void) => {
  iconNoticeListeners.add(listener);
  return () => { iconNoticeListeners.delete(listener); };
};
export const getIconNoticeVisible = () => iconNoticeVisible;
export function setIconNoticeVisible(value: boolean) {
  if (iconNoticeVisible === value) return;
  iconNoticeVisible = value;
  iconNoticeListeners.forEach(listener => listener());
}

/** Only the full-screen replaced-app view may suppress the global cookie banner. */
let replacedScreenVisible = false;
const replacedScreenListeners = new Set<() => void>();
export const subscribeReplacedScreen = (listener: () => void) => {
  replacedScreenListeners.add(listener);
  return () => { replacedScreenListeners.delete(listener); };
};
export const getReplacedScreenVisible = () => replacedScreenVisible;
export function setReplacedScreenVisible(value: boolean) {
  if (replacedScreenVisible === value) return;
  replacedScreenVisible = value;
  replacedScreenListeners.forEach(listener => listener());
}

const isBlockingWebview = (ua: string) => /;\s*wv[);]|FBAN|FBAV|Instagram|WhatsApp|\bWebView\b/i.test(ua);
interface NoticeProps {
  store: StoreIdentityInput;
  currentIdentity: string;
  /** Deterministic fixtures; production derives the platform from the real device. */
  installed?: boolean;
  userAgent?: string;
  onNavigate?: (url: string) => void;
}

export function IconUpdateNotice({ store, currentIdentity, installed, userAgent, onNavigate }: NoticeProps) {
  const slug = store.slug;
  const standalone = installed ?? (typeof window !== 'undefined' && isStandalone(window));
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const platform = detectPlatform(ua);
  const android = platform === 'android-chrome' || platform === 'android-other';
  const ios = platform === 'ios-safari' || platform === 'ios-other';
  const visible = standalone && (android || ios);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const left = useRef(false);

  useLayoutEffect(() => {
    setIconNoticeVisible(visible);
    return () => setIconNoticeVisible(false);
  }, [visible]);
  useEffect(() => {
    const noteLeft = () => {
      left.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    const checkVisibility = () => { if (document.visibilityState !== 'visible') noteLeft(); };
    document.addEventListener('visibilitychange', checkVisibility);
    window.addEventListener('pagehide', noteLeft);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', checkVisibility);
      window.removeEventListener('pagehide', noteLeft);
    };
  }, []);
  if (!visible) return null;

  const url = storeIconUpdateUrl(slug, currentIdentity, window.location.origin);
  const onAndroidClick = () => {
    left.current = false;
    setShowFallback(isBlockingWebview(ua));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!left.current && document.visibilityState === 'visible' && isStandalone(window)) {
        setShowFallback(true);
      }
    }, ICON_INTENT_FALLBACK_MS);
    if (onNavigate) onNavigate(chromeIconUpdateIntent(slug, currentIdentity, window.location.origin));
  };
  const copy = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <aside data-testid="icon-update-notice" role="status" aria-live="polite"
      className="fixed inset-x-3 bottom-20 z-[135] mx-auto max-w-md rounded-xl border border-amber-200 bg-white p-3 text-gray-900 shadow-xl">
      <div className="flex items-center gap-3">
        <RefreshCw aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-bold">{ICON_UPDATE_TEXT}</p>
          {android ? (
            <a href={chromeIconUpdateIntent(slug, currentIdentity, window.location.origin)}
              target="_blank" rel="noopener noreferrer" data-testid="icon-update-open-chrome"
              onClick={(event) => { if (onNavigate) event.preventDefault(); onAndroidClick(); }}
              className="inline-flex items-center justify-center rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">
              Atualizar
            </a>
          ) : (
            <>
              <Button type="button" variant="primary" size="sm" onClick={() => void copy()}
                leftIcon={<Copy className="h-3.5 w-3.5" />}>Atualizar</Button>
              {copied && (
                <p className="text-xs text-gray-700" role="status">
                  Link copiado. Abra no Safari para instalar a nova versão.
                </p>
              )}
              {copyFailed && (
                <div className="space-y-1 text-xs text-gray-700" role="status">
                  <p>Abra este endereço no Safari para instalar a nova versão.</p>
                  <p className="select-text break-all">{url}</p>
                </div>
              )}
            </>
          )}
          {android && showFallback && (
            <div data-testid="icon-update-fallback" role="region" aria-label="Atualização pelo navegador"
              className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <p className="text-xs text-gray-800">Para atualizar, abra este link no Chrome. Toque em ⋮ e depois "Abrir no Chrome".</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void copy()}
                leftIcon={<Copy className="h-3.5 w-3.5" />}>{copied ? 'Link copiado' : 'Copiar link'}</Button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
