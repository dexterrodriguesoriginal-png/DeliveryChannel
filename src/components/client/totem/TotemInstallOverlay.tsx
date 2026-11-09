import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Download, MonitorSmartphone, Share, Smartphone } from 'lucide-react';
import { InstallProgress } from '../../pwa/InstallProgress';
import {
  persistInstallStart,
  readPersistedInstallStart,
  remainingSecondsAt,
} from '../../../lib/pwa/installProgress';
import { openInstalledApp, rememberOpenAttempt } from '../../../lib/pwa/openInstalledApp';
import { totemStartUrl } from '../../../lib/pwa/totemManifest';
import {
  clearDeferredPrompt,
  detectPlatform,
  getDeferredPrompt,
  isStandalone,
  subscribeInstall,
  supportsNativeInstall,
  wasAppInstalledEvent,
} from '../../../lib/pwa/installState';
import './totemInstallOverlay.css';

export const TOTEM_CONTINUE_KEY = (slug: string) => `dc_totem_continue_browser_${slug}`;
export const TOTEM_INSTALL_APP_ID = (tenantId: string) => `totem:${tenantId}`;

export type TotemInstallForcePhase = 'prompt' | 'installing' | 'opening' | 'done';

export interface TotemInstallOverlayProps {
  slug: string;
  tenantId: string;
  storeName: string;
  logoUrl?: string;
  accent?: string;
  /** Força um estado (prévia e testes). */
  forcePhase?: TotemInstallForcePhase | null;
  search?: string;
}

function readContinued(slug: string): boolean {
  try { return sessionStorage.getItem(TOTEM_CONTINUE_KEY(slug)) === '1'; } catch { return false; }
}

function markContinued(slug: string): void {
  try { sessionStorage.setItem(TOTEM_CONTINUE_KEY(slug), '1'); } catch { /* ignore */ }
}

function installQuery(search: string): boolean {
  try { return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('install') === '1'; } catch { return false; }
}

/** Fora de produção, ?pwa_test_phase= ajuda nas capturas. */
function testPhaseFromSearch(search: string): TotemInstallForcePhase | null {
  if (import.meta.env.PROD) return null;
  try {
    const v = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('pwa_test_phase');
    return v === 'prompt' || v === 'installing' || v === 'opening' || v === 'done' ? v : null;
  } catch {
    return null;
  }
}

export function TotemInstallOverlay({
  slug,
  tenantId,
  storeName,
  logoUrl,
  accent = '#176444',
  forcePhase = null,
  search,
}: TotemInstallOverlayProps) {
  const currentSearch = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const forced = forcePhase ?? testPhaseFromSearch(currentSearch);
  const appId = TOTEM_INSTALL_APP_ID(tenantId || slug);
  const startPath = totemStartUrl(slug);
  const deferred = useSyncExternalStore(subscribeInstall, getDeferredPrompt, () => null);
  const appInstalledEvt = useSyncExternalStore(subscribeInstall, wasAppInstalledEvent, () => false);
  const [continued, setContinued] = useState(() => forced ? false : readContinued(slug));
  const [phase, setPhase] = useState<'prompt' | 'installing' | 'opening' | 'done'>(() => {
    if (forced) return forced;
    if (typeof sessionStorage !== 'undefined' && readPersistedInstallStart(sessionStorage, appId)) return 'installing';
    return 'prompt';
  });
  const [installStart, setInstallStart] = useState<number | null>(() =>
    typeof sessionStorage !== 'undefined' ? readPersistedInstallStart(sessionStorage, appId) : null,
  );
  const [openHelp, setOpenHelp] = useState(false);
  const [waitingPrompt, setWaitingPrompt] = useState(false);
  const [nativeNotice, setNativeNotice] = useState(false);
  const [tick, setTick] = useState(0);
  const prompting = useRef(false);
  const didAutoOpen = useRef(false);
  const platform = typeof navigator !== 'undefined' ? detectPlatform(navigator.userAgent) : 'desktop';
  const standalone = typeof window !== 'undefined' && isStandalone(window);
  const wantInstall = installQuery(currentSearch);

  const hideForSession = continued && !wantInstall && !forced;
  const visible = Boolean(forced) || (!standalone && !hideForSession);

  const elapsed = installStart != null ? Date.now() - installStart : 0;
  const installingTitle = `Instalando… ~${remainingSecondsAt(elapsed)}s`;
  void tick;

  useEffect(() => {
    if (phase !== 'installing' || forced) return;
    const id = window.setInterval(() => setTick(n => n + 1), 250);
    return () => window.clearInterval(id);
  }, [phase, forced]);

  const openTotem = useCallback(() => {
    if (typeof sessionStorage !== 'undefined') rememberOpenAttempt(sessionStorage, appId);
    openInstalledApp(startPath, {
      location: window.location,
      document,
      userAgent: navigator.userAgent,
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      onStillVisible: () => {
        setOpenHelp(true);
        setPhase('done');
      },
    });
  }, [appId, startPath]);

  useEffect(() => {
    if (!visible) return;
    if (forced) return;
    if (!appInstalledEvt) return;
    setPhase(current => (current === 'done' ? 'done' : 'opening'));
    const start = persistInstallStart(typeof sessionStorage !== 'undefined' ? sessionStorage : null, appId, Date.now());
    setInstallStart(s => s ?? start);
    if (!didAutoOpen.current) {
      didAutoOpen.current = true;
      window.setTimeout(() => openTotem(), 400);
    }
  }, [appInstalledEvt, visible, forced, appId, openTotem]);

  const runPrompt = async (ev: NonNullable<ReturnType<typeof getDeferredPrompt>>) => {
    if (prompting.current) return;
    prompting.current = true;
    setNativeNotice(false);
    let choice: { outcome: 'accepted' | 'dismissed' } | undefined;
    try {
      const result = ev.prompt();
      clearDeferredPrompt();
      await result;
      choice = await ev.userChoice;
    } catch {
      clearDeferredPrompt();
      setNativeNotice(true);
      return;
    } finally {
      prompting.current = false;
      setWaitingPrompt(false);
    }
    if (choice?.outcome === 'accepted') {
      const start = persistInstallStart(typeof sessionStorage !== 'undefined' ? sessionStorage : null, appId, Date.now());
      setInstallStart(start);
      setPhase('installing');
    }
  };

  const install = async () => {
    if (prompting.current) return;
    const ev = getDeferredPrompt();
    if (!ev) {
      if (!supportsNativeInstall(window)) {
        setNativeNotice(true);
        return;
      }
      setNativeNotice(false);
      setWaitingPrompt(true);
      return;
    }
    return runPrompt(ev);
  };

  useEffect(() => {
    if (!waitingPrompt || !deferred) return;
    setWaitingPrompt(false);
    void runPrompt(deferred);
  }, [waitingPrompt, deferred]);

  useEffect(() => {
    if (!waitingPrompt) return;
    const id = window.setTimeout(() => { setWaitingPrompt(false); setNativeNotice(true); }, 8000);
    return () => window.clearTimeout(id);
  }, [waitingPrompt]);

  const continueInBrowser = () => {
    markContinued(slug);
    setContinued(true);
  };

  const activePhase = forced ?? phase;
  const progressTitle = useMemo(() => {
    if (activePhase === 'opening') return 'Pronto! Abrindo o totem…';
    if (activePhase === 'done') return 'Pronto! O totem está na tela inicial';
    if (forced === 'installing') return 'Instalando… ~45s';
    return installingTitle;
  }, [activePhase, forced, installingTitle]);

  if (!visible) return null;

  const showProgress = activePhase === 'installing' || activePhase === 'opening' || activePhase === 'done';
  const ios = platform === 'ios-safari' || platform === 'ios-other';

  return (
    <div
      className="dc-totem-install"
      data-testid="totem-install-overlay"
      data-phase={activePhase}
      role="dialog"
      aria-label="Instalar totem"
    >
      <div className="dc-totem-install-card">
        {logoUrl
          ? <img className="dc-totem-install-logo" src={logoUrl} alt="" />
          : (
            <div className="dc-totem-install-logo dc-totem-install-logo--fallback" style={{ background: accent }}>
              <MonitorSmartphone aria-hidden="true" />
            </div>
          )}
        <p className="dc-totem-install-kicker">{storeName}</p>
        <h1>Instalar totem</h1>
        <p className="dc-totem-install-lead">
          Instale como app neste aparelho. Ele abre em tela cheia, na capa, sem a barra do navegador e sem o aviso do Chrome.
        </p>

        {showProgress ? (
          <div className="dc-totem-install-progress">
            <InstallProgress
              appId={appId}
              appName={`${storeName} — Totem`}
              startPath={startPath}
              startedAt={installStart ?? (forced === 'installing' ? Date.now() - 15_000 : Date.now())}
              forceElapsedMs={forced === 'installing' ? 15_000 : forced === 'opening' || forced === 'done' ? 60_000 : null}
              title={progressTitle}
              doneTitle={activePhase === 'opening' ? 'Pronto! Abrindo o totem…' : 'Pronto! O totem está na tela inicial'}
              openLabel="Abrir totem"
              variant="inline"
            />
            {(activePhase === 'done' || openHelp) && (
              <>
                <button type="button" className="dc-totem-install-open" data-testid="totem-install-open" onClick={openTotem}>
                  <Smartphone aria-hidden="true" />Abrir totem
                </button>
                <p className="dc-totem-install-hint" data-testid="totem-install-open-hint">
                  Se não abrir sozinho, toque no novo ícone <strong>Totem</strong> na tela inicial.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            {platform === 'ios-safari' && (
              <p className="dc-totem-install-ios" data-testid="totem-install-ios">
                <Share aria-hidden="true" />No Safari, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.
              </p>
            )}
            {platform === 'ios-other' && (
              <p className="dc-totem-install-ios" data-testid="totem-install-ios">
                No iPhone e no iPad, abra este link no <strong>Safari</strong>, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.
              </p>
            )}
            {!ios && (
              <button
                type="button"
                className="dc-totem-install-cta"
                data-testid="totem-install-cta"
                style={{ background: accent }}
                onClick={() => void install()}
              >
                <Download aria-hidden="true" />Instalar totem
              </button>
            )}
            {waitingPrompt && (
              <p className="dc-totem-install-hint" data-testid="totem-install-waiting" role="status">Preparando a instalação…</p>
            )}
            {nativeNotice && (
              <p className="dc-totem-install-hint" data-testid="totem-install-notice" role="status">
                {typeof window !== 'undefined' && supportsNativeInstall(window)
                  ? 'Não foi possível iniciar a instalação automática. No menu do Chrome, toque em Instalar app.'
                  : 'Neste navegador, use o menu para Instalar app ou Adicionar à tela inicial.'}
              </p>
            )}
            {!ios && !deferred && platform === 'desktop' && !forced && (
              <p className="dc-totem-install-hint">
                No Chrome deste computador, use o menu para instalar o app, ou inicie em modo kiosk após instalar.
              </p>
            )}
            <button type="button" className="dc-totem-install-continue" data-testid="totem-install-continue" onClick={continueInBrowser}>
              Continuar no navegador
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default TotemInstallOverlay;
