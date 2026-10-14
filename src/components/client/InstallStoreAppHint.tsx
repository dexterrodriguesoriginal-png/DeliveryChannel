import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, Share, X, MoreVertical, Smartphone } from 'lucide-react';
import { StoreLogo } from './StoreLogo';
import {
  detectPlatform, isStandalone,
  isMarkedInstalled, markInstalled, getDeferredPrompt, clearDeferredPrompt, subscribeInstall, wasAppInstalledEvent,
  decideInvite, readInvite, recordInvite, recordAccepted, isEditableFocused, onInviteTrigger, activeKey,
  InviteKind, InviteTrigger, INVITE_ACTIVE_MS,
} from '../../lib/pwa/installState';

interface Props { tenantId: string; storeName: string; color: string; logoUrl?: string; hidden?: boolean; busy?: boolean; }

/**
 * Promoção de instalação do app da loja: modal na 1ª visita (por loja) e banner fixo depois,
 * até a instalação ser confirmada (appinstalled / aceite / modo standalone). Nunca bloqueia a compra.
 */
export const InstallStoreAppHint: React.FC<Props> = ({ tenantId, storeName, color, logoUrl, hidden, busy }) => {
  const deferred = useSyncExternalStore(subscribeInstall, getDeferredPrompt, () => null);
  const appInstalledEvt = useSyncExternalStore(subscribeInstall, wasAppInstalledEvent, () => false);
  const [installed, setInstalled] = useState(() => isMarkedInstalled(localStorage, tenantId));
  const [invite, setInvite] = useState<{ kind: InviteKind; trigger: InviteTrigger } | null>(null);
  const [help, setHelp] = useState(false);
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

  if (installed || standalone) return null;
  const vis: 'modal' | 'sheet' | 'banner' | 'none' = hidden ? 'none' : invite ? invite.kind : 'banner';
  if (vis === 'none') return null;

  const closeModal = () => { setInvite(null); setHelp(false); };
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
    <div data-testid="install-instructions" className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700 text-left space-y-1">
      {platform === 'ios-safari' && <p className="flex flex-wrap items-center gap-1">No Safari, toque em <Share className="inline h-4 w-4" /> <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</p>}
      {platform === 'ios-other' && <p>No iPhone, a instalação é feita pelo <b>Safari</b>. Abra este link no Safari, toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</p>}
      {platform === 'android-chrome' && <><p>O Chrome ainda não liberou a instalação automática nesta página.</p><p className="flex flex-wrap items-center gap-1">Toque no menu <MoreVertical className="inline h-4 w-4" /> e escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</p></>}
      {platform === 'android-other' && <p>Este navegador pode não permitir instalar apps. Para a melhor experiência, abra o link no <b>Google Chrome</b> e use o menu ⋮ → <b>Instalar app</b>.</p>}
      {platform === 'desktop' && <p>Abra este link no navegador do seu celular (Chrome no Android ou Safari no iPhone) para instalar o app da loja.</p>}
    </div>
  );

  if (vis === 'modal') {
    return (
      <div data-testid="install-store-app-modal" role="dialog" aria-modal="true" aria-label={`Instalar app ${storeName}`}
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
        <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl text-center relative">
          <button type="button" aria-label="Fechar" onClick={closeModal} className="absolute right-4 top-4 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
          <div className="flex justify-center mb-3"><StoreLogo logoUrl={logoUrl} name={storeName} color={color} className="w-20 h-20" /></div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{storeName}</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">Tenha o app da {storeName} no seu celular</h2>
          <p className="mt-2 text-sm text-slate-600">Instale e volte à loja com um toque, direto pela tela inicial do seu aparelho.</p>
          {help && instructions}
          <button type="button" onClick={install} data-testid="install-primary"
            className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-white text-base font-bold shadow-lg"
            style={{ backgroundColor: color }}>
            <Download className="h-5 w-5" /> Instalar aplicativo
          </button>
          <button type="button" onClick={closeModal} data-testid="install-continue" className="mt-2 w-full rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">
            Continuar no navegador
          </button>
        </div>
      </div>
    );
  }

  if (vis === 'sheet') {
    const order = invite?.trigger === 'order';
    return (
      <div data-testid="install-store-app-sheet" data-trigger={invite?.trigger} role="dialog" aria-label={`Instalar app ${storeName}`}
        className="fixed inset-x-0 bottom-0 z-[120] p-3 sm:flex sm:justify-center pointer-events-none">
        <div className="pointer-events-auto w-full sm:max-w-sm bg-white rounded-2xl border border-slate-200 shadow-2xl p-4 relative">
          <button type="button" aria-label="Fechar" onClick={closeModal} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          <div className="flex items-center gap-3 pr-6">
            <StoreLogo logoUrl={logoUrl} name={storeName} color={color} className="w-12 h-12 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">{order ? 'Acompanhe seu pedido pelo app' : invite?.trigger === 'cart' ? 'Peça mais rápido da próxima vez' : `Tenha o app da ${storeName} no seu celular`}</p>
              <p className="text-xs text-slate-600">{order ? `Instale o app da ${storeName} e volte à loja com um toque.` : `Instale o app da ${storeName} e compre direto pela tela inicial.`}</p>
            </div>
          </div>
          {help && instructions}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={install} data-testid="install-sheet-primary" className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-white text-sm font-bold" style={{ backgroundColor: color }}>
              <Download className="h-4 w-4" /> Instalar aplicativo
            </button>
            <button type="button" onClick={closeModal} data-testid="install-sheet-continue" className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Agora não</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="install-store-app-banner" className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur px-3 py-2">
      <div className="flex items-center gap-2">
        <Smartphone className="h-4 w-4 shrink-0" style={{ color }} />
        <span className="flex-1 text-sm font-semibold text-slate-800 truncate">Instale o app da {storeName}</span>
        <button type="button" onClick={install} data-testid="install-banner-button" className="rounded-xl px-3 py-1.5 text-white text-xs font-bold" style={{ backgroundColor: color }}>Instalar</button>
      </div>
      {help && <div className="relative">{instructions}<button type="button" aria-label="Fechar instruções" onClick={() => setHelp(false)} className="absolute right-2 top-5 text-slate-400"><X className="h-4 w-4" /></button></div>}
    </div>
  );
};
