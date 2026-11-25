import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { versionedStoreScope } from '../../lib/pwa/appIdentity';
import type { StoreIdentityInput } from '../../lib/pwa/storeManifest';
import { detectPlatform, isStandalone, getDeferredPrompt, subscribeInstall, wasAppInstalledEvent, clearDeferredPrompt } from '../../lib/pwa/installState';
import { markPendingInstall } from '../../lib/pwa/installSession';
import { Button } from '../ui/Button';

export const ICON_UPDATE_TEXT = 'Atualize para a nova versão';
export const ICON_INTENT_FALLBACK_MS = 1500;
export type UpdateOpenMode = 'window' | 'chrome-component' | 'googlechrome-scheme';
export const UPDATE_OPEN_MODE_KEY = 'dc:update-open-mode';

export const UPDATE_OPEN_MODE_PARAM = 'modo';
export const ICON_UPDATE_CHROME_HINT = 'Toque em ⋮ e em Abrir no Chrome';
export const ICON_UPDATE_INSTALLED_TEXT = 'Pronto. Abra o novo app na tela do seu celular.';

export function getUpdateOpenMode(storage?: Pick<Storage, 'getItem'>): UpdateOpenMode {
  let value: string | null = null;
  try { value = (storage || window.localStorage).getItem(UPDATE_OPEN_MODE_KEY); } catch { /* armazenamento bloqueado */ }
  return value === 'chrome-component' || value === 'googlechrome-scheme' ? value : 'window';
}

/** ?modo=window|chrome-component|googlechrome-scheme grava a chave de teste na origem atual. */
export function applyUpdateOpenModeFromSearch(
  search: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): UpdateOpenMode | null {
  const raw = new URLSearchParams(String(search || '').replace(/^\?/, '')).get(UPDATE_OPEN_MODE_PARAM);
  if (raw !== 'window' && raw !== 'chrome-component' && raw !== 'googlechrome-scheme') return null;
  try { (storage || window.localStorage).setItem(UPDATE_OPEN_MODE_KEY, raw); } catch { /* armazenamento bloqueado */ }
  return raw;
}

/** Aplica ?modo= e o retira do endereço, para o parâmetro não ficar no compartilhamento. */
export function consumeUpdateOpenModeParam(w: Window = window): UpdateOpenMode | null {
  const mode = applyUpdateOpenModeFromSearch(w.location.search);
  if (!mode) return null;
  try {
    const url = new URL(w.location.href, w.location.origin || 'http://localhost');
    if (url.searchParams.has(UPDATE_OPEN_MODE_PARAM)) {
      url.searchParams.delete(UPDATE_OPEN_MODE_PARAM);
      const next = url.pathname + url.search + url.hash;
      w.history.replaceState(w.history.state, '', next);
    }
  } catch { /* URL ou history indisponíveis */ }
  return mode;
}

/** URL da instalação oficial atual, sem caminhos ou parâmetros de reinstalação. */
export function storeIconUpdateUrl(slug: string, identity: string, origin: string): string {
  const base = new URL(origin);
  base.protocol = 'https:';
  return base.origin + versionedStoreScope(slug, identity) + '?instalar=1';
}
/** Experimentos opcionais; o modo padrão abre a URL HTTPS em nova janela. */
export function experimentalUpdateUrl(mode: Exclude<UpdateOpenMode, 'window'>, installUrl: string): string {
  if (mode === 'googlechrome-scheme') return `googlechrome://navigate?url=${encodeURIComponent(installUrl)}`;
  const url = new URL(installUrl);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;component=com.android.chrome/com.google.android.apps.chrome.Main;launchFlags=0x10000000;S.browser_fallback_url=${encodeURIComponent(installUrl)};end`;
}
/** Mantém nome para código de diagnóstico anterior; não é a estratégia padrão. */
export const chromeIconUpdateIntent = (slug: string, identity: string, origin: string) =>
  experimentalUpdateUrl('chrome-component', storeIconUpdateUrl(slug, identity, origin));

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
  const [busy, setBusy] = useState(false);
  const deferred = useSyncExternalStore(subscribeInstall, getDeferredPrompt, () => null);
  const installDone = useSyncExternalStore(subscribeInstall, wasAppInstalledEvent, () => false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const left = useRef(false);

  useLayoutEffect(() => { consumeUpdateOpenModeParam(); }, []);
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
  // iPhone: Safari não usa ?instalar=1 (a instalação é pelo menu Compartilhar).
  const iosUrl = url.replace(/\?instalar=1$/, '');
  const armFallback = (immediate = false) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const reveal = () => {
      if (!left.current && document.visibilityState === 'visible' && isStandalone(window)) setShowFallback(true);
    };
    if (immediate) { reveal(); return; }
    timer.current = setTimeout(() => { timer.current = null; reveal(); }, ICON_INTENT_FALLBACK_MS);
  };
  const installNewVersion = async () => {
    const prompt = getDeferredPrompt();
    if (!prompt || busy) return;
    markPendingInstall(slug);
    setBusy(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
      clearDeferredPrompt();
    } catch {
      // Sem prompt, o aviso mostra a dica mínima do menu ⋮.
    } finally {
      setBusy(false);
    }
  };
  const onAndroidClick = () => {
    const mode = getUpdateOpenMode();
    // Executar diretamente no gesto do usuário: popups disparados por timers são bloqueados.
    markPendingInstall(slug);
    left.current = false;
    setShowFallback(isBlockingWebview(ua));
    if (mode === 'window') {
      try {
        // Sem 'noopener' na lista de recursos: com ele window.open devolve null sempre e a janela atual também navegaria.
        const opened = window.open(url, '_blank');
        if (opened) { try { opened.opener = null; } catch { /* outra origem */ } }
        // Não navegar a janela atual: isso impediria o fallback Instalar no app antigo.
        armFallback(!opened);
      } catch {
        armFallback(true);
      }
      return;
    }
    armFallback(isBlockingWebview(ua));
    const experimentalUrl = experimentalUpdateUrl(mode, url);
    if (onNavigate) { onNavigate(experimentalUrl); return; }
    const anchor = document.createElement('a');
    anchor.href = experimentalUrl;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  };
  const copy = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(ios ? iosUrl : url);
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
            <Button type="button" variant="primary" size="sm"
              data-testid="icon-update-open-chrome" onClick={onAndroidClick}>Atualizar</Button>
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
                  <p className="select-text break-all">{iosUrl}</p>
                </div>
              )}
            </>
          )}
          {android && showFallback && (
            <div data-testid="icon-update-fallback" role="region" aria-label="Instalar a nova versão"
              className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              {installDone ? (
                <p data-testid="icon-update-install-success" className="text-xs text-gray-800">{ICON_UPDATE_INSTALLED_TEXT}</p>
              ) : deferred ? (
                <Button type="button" variant="primary" size="sm" disabled={busy} isLoading={busy}
                  data-testid="icon-update-install-button" onClick={() => void installNewVersion()}>Instalar</Button>
              ) : (
                <>
                  <p data-testid="icon-update-no-prompt" className="text-xs text-gray-800">{ICON_UPDATE_CHROME_HINT}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void copy()}
                    data-testid="icon-update-copy-link"
                    leftIcon={<Copy className="h-3.5 w-3.5" />}>{copied ? 'Link copiado' : 'Copiar link'}</Button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
