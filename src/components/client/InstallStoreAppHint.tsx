import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Share, X, MoreVertical } from 'lucide-react';
import { StoreLogo } from './StoreLogo';
import {
  detectPlatform, isStandalone,
  isMarkedInstalled, markInstalled, getDeferredPrompt, clearDeferredPrompt, subscribeInstall, wasAppInstalledEvent,
  decideInvite, readInvite, recordInvite, recordAccepted, isEditableFocused, onInviteTrigger, activeKey,
  InviteKind, InviteTrigger, INVITE_ACTIVE_MS, inviteSurface,
} from '../../lib/pwa/installState';

interface Props { tenantId: string; storeName: string; color: string; logoUrl?: string; hidden?: boolean; busy?: boolean; }

/**
 * Convite de instalação do app da loja. Prioriza a instalação nativa do Chrome (evento beforeinstallprompt);
 * sem ele, card escuro compacto próprio com instruções. Volta nos momentos-chave até instalação real
 * (appinstalled / modo standalone). Nunca bloqueia a compra.
 */
export const InstallStoreAppHint: React.FC<Props> = ({ tenantId, storeName, color, logoUrl, hidden, busy }) => {
  const deferred = useSyncExternalStore(subscribeInstall, getDeferredPrompt, () => null);
  const appInstalledEvt = useSyncExternalStore(subscribeInstall, wasAppInstalledEvent, () => false);
  const [installed, setInstalled] = useState(() => isMarkedInstalled(localStorage, tenantId));
  const [invite, setInvite] = useState<{ kind: InviteKind; trigger: InviteTrigger } | null>(null);
  const [help, setHelp] = useState(false);
  const [barDismissed, setBarDismissed] = useState(false);
  const standalone = isStandalone(window);
  const platform = detectPlatform(navigator.userAgent);
  const blockedRef = useRef(false);
  blockedRef.current = !!hidden || !!busy;

  // Instalado só por appinstalled ou execução em modo standalone (nunca por clique/fechamento).
  useEffect(() => {
    if (standalone || appInstalledEvt) { markInstalled(localStorage, tenantId); setInstalled(true); }
  }, [standalone, appInstalledEvt, tenantId]);
  // Se o app foi removido do aparelho, o navegador volta a oferecer beforeinstallprompt: volta a convidar.
  useEffect(() => {
    if (deferred && installed && !standalone && !appInstalledEvt) {
      try { localStorage.removeItem(`deliverychannel_pwa_installed_${tenantId}`); } catch { /* ignora */ }
      setInstalled(false);
    }
  }, [deferred, installed, standalone, appInstalledEvt, tenantId]);

  const tryInvite = useCallback((trigger: InviteTrigger) => {
    const kind = decideInvite({
      now: Date.now(), trigger, record: readInvite(localStorage, tenantId),
      installed: isMarkedInstalled(localStorage, tenantId) || wasAppInstalledEvent(), standalone: isStandalone(window),
      busy: blockedRef.current || isEditableFocused(document),
    });
    if (!kind) return;
    recordInvite(localStorage, tenantId, Date.now());
    setHelp(false);
    setInvite({ kind, trigger });
  }, [tenantId]);

  useEffect(() => { tryInvite('visit'); }, [tryInvite]);
  useEffect(() => onInviteTrigger(tryInvite), [tryInvite]);
  // Fecha convites abertos se o checkout/form abrir.
  useEffect(() => { if (hidden || busy) setInvite(null); }, [hidden, busy]);

  // Navegação ativa: aba visível + interação nos últimos 30 s; a cada 3 min ativos, tenta convidar.
  useEffect(() => {
    if (installed || standalone) return;
    const key = activeKey(tenantId);
    let lastAct = Date.now();
    const act = () => { lastAct = Date.now(); };
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    evs.forEach(e => window.addEventListener(e, act, { passive: true }));
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || Date.now() - lastAct > 30000) return;
      let ms = 0;
      try { ms = Number(sessionStorage.getItem(key)) || 0; } catch { /* ignora */ }
      ms += 5000;
      if (ms >= INVITE_ACTIVE_MS) { ms = 0; tryInvite('active'); }
      try { sessionStorage.setItem(key, String(ms)); } catch { /* ignora */ }
    }, 5000);
    return () => { window.clearInterval(id); evs.forEach(e => window.removeEventListener(e, act)); };
  }, [installed, standalone, tenantId, tryInvite]);

  const surface = inviteSurface({ installed, standalone, hidden: !!hidden, inviteOpen: !!invite, nativeAvailable: !!deferred, barDismissed });
  if (surface === 'none') return null;

  const closeModal = () => { setInvite(null); setHelp(false); setBarDismissed(true); };
  const install = async () => {
    const ev = getDeferredPrompt();
    if (!ev) { setHelp(true); return; }
    clearDeferredPrompt(); // o evento só pode ser usado uma vez
    try { await ev.prompt(); } catch { setHelp(true); return; }
    const choice = await ev.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') recordAccepted(localStorage, tenantId, Date.now());
    closeModal();
  };

  const instructions = (
    <div data-testid="install-instructions" className="mt-3 rounded-xl bg-white/5 border border-white/10 p-3 text-[13px] leading-snug text-neutral-200 text-left space-y-1">
      {platform === 'ios-safari' && <p className="flex flex-wrap items-center gap-1">No Safari, toque em <Share className="inline h-4 w-4" /> <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</p>}
      {platform === 'ios-other' && <p>No iPhone, a instalação é feita pelo <b>Safari</b>. Abra este link no Safari, toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</p>}
      {platform === 'android-chrome' && <><p>O Chrome ainda não liberou a instalação automática nesta página.</p><p className="flex flex-wrap items-center gap-1">Toque no menu <MoreVertical className="inline h-4 w-4" /> e escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</p></>}
      {platform === 'android-other' && <p>Este navegador pode não permitir instalar apps. Para a melhor experiência, abra o link no <b>Google Chrome</b> e use o menu ⋮ → <b>Instalar app</b>.</p>}
      {platform === 'desktop' && <p>Abra este link no navegador do seu celular (Chrome no Android ou Safari no iPhone) para instalar o app da loja.</p>}
    </div>
  );

  const t = invite?.trigger;
  const line = t === 'order' ? 'Acompanhe seu pedido pelo app' : t === 'cart' ? 'Peça mais rápido da próxima vez' : 'Abra a loja com um toque na tela inicial';
  const card = surface !== 'fallback-bar';
  return (
    <div data-testid={card ? 'install-store-app-card' : 'install-store-app-banner'} data-surface={surface} data-trigger={t}
      role={card ? 'dialog' : 'region'} aria-label={`Instalar app ${storeName}`}
      className={`fixed inset-x-0 z-[120] px-3 pointer-events-none flex justify-center ${card ? 'bottom-3' : 'bottom-2'}`}>
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl bg-[#2b2b2e] text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] ring-1 ring-white/5 px-3 py-2.5">
        <div className="flex items-center gap-3">
          <StoreLogo logoUrl={logoUrl} name={storeName} color={color} className="w-10 h-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-tight break-words">{storeName}</p>
            <p className="text-xs text-neutral-400 leading-tight mt-0.5">{line}</p>
          </div>
          <button type="button" onClick={install} data-testid="install-primary"
            className="shrink-0 rounded-full bg-[#a8c7fa] text-[#062e6f] px-4 py-1.5 text-sm font-semibold hover:brightness-105">Instalar</button>
          <button type="button" aria-label="Fechar" data-testid="install-continue"
            onClick={() => { if (card) closeModal(); else { setBarDismissed(true); setHelp(false); } }}
            className="shrink-0 -mr-1 p-1 text-neutral-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        {help && instructions}
      </div>
    </div>
  );
};
