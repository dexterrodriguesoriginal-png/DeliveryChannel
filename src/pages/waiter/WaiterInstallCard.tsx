import React, { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { InstallProgress } from '../../components/pwa/InstallProgress';
import { persistInstallStart, readPersistedInstallStart } from '../../lib/pwa/installProgress';
import { clearDeferredPrompt, detectPlatform, getDeferredPrompt, isStandalone, subscribeInstall, wasAppInstalledEvent } from '../../lib/pwa/installState';
import { WAITER_APP_NAME, WAITER_START_PATH } from '../../lib/pwa/waiterManifest';

const DISMISS_KEY = 'dc_waiter_install_dismissed';

export interface WaiterInstallCardProps {
  alwaysShow?: boolean;
  appId?: string;
  appName?: string;
  startPath?: string;
}

/** Convite para instalar o App do Garçom (ou Cozinha/equipe) na tela inicial, com barra de 60 s após aceite. */
export const WaiterInstallCard: React.FC<WaiterInstallCardProps> = ({
  alwaysShow,
  appId = 'waiter-app',
  appName = WAITER_APP_NAME,
  startPath = WAITER_START_PATH,
}) => {
  const [, tick] = useState(0);
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } });
  const [installStart, setInstallStart] = useState<number | null>(() =>
    typeof sessionStorage !== 'undefined' ? readPersistedInstallStart(sessionStorage, appId) : null,
  );
  useEffect(() => subscribeInstall(() => {
    if (wasAppInstalledEvent() && typeof sessionStorage !== 'undefined') {
      setInstallStart(s => s ?? persistInstallStart(sessionStorage, appId, Date.now()));
    }
    tick(n => n + 1);
  }), [appId]);
  if (typeof window === 'undefined' || isStandalone(window)) return null;
  if (dismissed && !alwaysShow && installStart == null) return null;
  const platform = detectPlatform(navigator.userAgent);
  const prompt = getDeferredPrompt();
  const install = async () => {
    if (!prompt) return;
    let choice: { outcome: 'accepted' | 'dismissed' } | undefined;
    try {
      const res = prompt.prompt();
      clearDeferredPrompt();
      await res;
      choice = await prompt.userChoice;
    } catch {
      clearDeferredPrompt();
      return;
    }
    if (choice?.outcome === 'accepted') {
      const start = persistInstallStart(typeof sessionStorage !== 'undefined' ? sessionStorage : null, appId, Date.now());
      setInstallStart(start);
    }
  };
  const dismiss = () => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } };
  const activeStart = installStart ?? (wasAppInstalledEvent() && typeof sessionStorage !== 'undefined' ? persistInstallStart(sessionStorage, appId, Date.now()) : null);
  return (
    <section data-testid="waiter-install" className="relative rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-50">
      {!alwaysShow && activeStart == null && <button type="button" onClick={dismiss} aria-label="Dispensar" className="absolute right-2 top-2 rounded-full p-1.5 text-emerald-200 hover:bg-white/10"><X className="h-4 w-4" /></button>}
      <p className="flex items-center gap-2 font-black"><Smartphone className="h-4 w-4" />Instale o {appName} no seu celular</p>
      <p className="mt-1 text-xs text-emerald-100/80">Abre em tela cheia, com ícone próprio, e fica a um toque.</p>
      {activeStart != null ? (
        <InstallProgress
          appId={appId}
          appName={appName}
          startPath={startPath}
          startedAt={activeStart}
          variant="inline"
          className="mt-3"
        />
      ) : prompt
        ? <button type="button" onClick={() => void install()} data-testid="waiter-install-btn" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-black text-slate-950"><Download className="h-4 w-4" />Instalar agora</button>
        : platform === 'ios-safari'
          ? <p className="mt-2 flex items-start gap-1.5 text-xs"><Share className="mt-0.5 h-3.5 w-3.5 shrink-0" />Toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</p>
          : platform === 'ios-other'
            ? <p className="mt-2 text-xs">Abra este endereço no <b>Safari</b> para adicionar à Tela de Início.</p>
            : <p className="mt-2 text-xs">No menu do navegador (⋮), escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</p>}
    </section>
  );
};

