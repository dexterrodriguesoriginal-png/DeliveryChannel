import React, { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { clearDeferredPrompt, detectPlatform, getDeferredPrompt, isStandalone, subscribeInstall } from '../../lib/pwa/installState';

const DISMISS_KEY = 'dc_waiter_install_dismissed';

/** Convite para instalar o App do Garçom na tela inicial (sem service worker: só manifesto + atalho). */
export const WaiterInstallCard: React.FC<{ alwaysShow?: boolean }> = ({ alwaysShow }) => {
  const [, tick] = useState(0);
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } });
  useEffect(() => subscribeInstall(() => tick(n => n + 1)), []);
  if (typeof window === 'undefined' || isStandalone(window)) return null;
  if (dismissed && !alwaysShow) return null;
  const platform = detectPlatform(navigator.userAgent);
  const prompt = getDeferredPrompt();
  const install = async () => {
    if (!prompt) return;
    try { await prompt.prompt(); await prompt.userChoice; } catch { /* cancelled */ }
    clearDeferredPrompt();
  };
  const dismiss = () => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } };
  return (
    <section data-testid="waiter-install" className="relative rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-50">
      {!alwaysShow && <button type="button" onClick={dismiss} aria-label="Dispensar" className="absolute right-2 top-2 rounded-full p-1.5 text-emerald-200 hover:bg-white/10"><X className="h-4 w-4" /></button>}
      <p className="flex items-center gap-2 font-black"><Smartphone className="h-4 w-4" />Instale o Garçom no seu celular</p>
      <p className="mt-1 text-xs text-emerald-100/80">Abre em tela cheia, com ícone próprio, e fica a um toque.</p>
      {prompt
        ? <button type="button" onClick={() => void install()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-black text-slate-950"><Download className="h-4 w-4" />Instalar agora</button>
        : platform === 'ios-safari'
          ? <p className="mt-2 flex items-start gap-1.5 text-xs"><Share className="mt-0.5 h-3.5 w-3.5 shrink-0" />Toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</p>
          : platform === 'ios-other'
            ? <p className="mt-2 text-xs">Abra este endereço no <b>Safari</b> para adicionar à Tela de Início.</p>
            : <p className="mt-2 text-xs">No menu do navegador (⋮), escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</p>}
    </section>
  );
};
