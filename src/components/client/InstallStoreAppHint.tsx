import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Share, X, MoreVertical, Download, CheckCircle2 } from 'lucide-react';
import { StoreLogo } from './StoreLogo';
import { openInstalledApp, detectInstalledApp } from '../../lib/pwa/openInstalledApp';
import { storeStartUrl } from '../../lib/pwa/storeManifest';
import {
  detectPlatform, isStandalone,
  isMarkedInstalled, markInstalled, getDeferredPrompt, clearDeferredPrompt, subscribeInstall, wasAppInstalledEvent,
  decideInvite, readInvite, recordInvite, recordAccepted, isEditableFocused, onInviteTrigger, activeKey,
  InviteKind, InviteTrigger, INVITE_ACTIVE_MS, inviteSurface,
  InstallPhase, INSTALL_SLOW_MS, installPhaseCopy, nextInstallPhase, estimatedInstallPercent,
} from '../../lib/pwa/installState';

interface Props { tenantId: string; storeName: string; color: string; logoUrl?: string; hidden?: boolean; busy?: boolean; }

/**
 * Convite de instalação do app da loja. Prioriza a instalação nativa do Chrome (evento beforeinstallprompt);
 * sem ele, card escuro compacto próprio com instruções. Volta nos momentos-chave até instalação real
 * (appinstalled / modo standalone). Nunca bloqueia a compra.
 */
/** URL inicial da loja atual (/app/<slug>/?source=pwa), usada pelo botão "Abrir app". */
function currentStartPath(): string {
  const m = window.location.pathname.match(/^\/app\/([^/]+)/);
  return m ? storeStartUrl(decodeURIComponent(m[1])) : '/';
}
/** Somente fora de produção: ?pwa_test_phase=open força a barra "Abrir app" (capturas). */
function testOpenBar(): boolean {
  if (import.meta.env.PROD) return false;
  try { return new URLSearchParams(window.location.search).get('pwa_test_phase') === 'open'; } catch { return false; }
}
/** Somente para capturas/testes fora de produção: ?pwa_test_phase=installing|slow|finishing|done. */
function testPhase(): InstallPhase | null {
  if (import.meta.env.PROD) return null;
  try { const v = new URLSearchParams(window.location.search).get('pwa_test_phase'); return v === 'installing' || v === 'slow' || v === 'finishing' || v === 'done' ? v : null; } catch { return null; }
}

export const InstallStoreAppHint: React.FC<Props> = ({ tenantId, storeName, color, logoUrl, hidden, busy }) => {
  const deferred = useSyncExternalStore(subscribeInstall, getDeferredPrompt, () => null);
  const appInstalledEvt = useSyncExternalStore(subscribeInstall, wasAppInstalledEvent, () => false);
  const [installed, setInstalled] = useState(() => isMarkedInstalled(localStorage, tenantId));
  const [invite, setInvite] = useState<{ kind: InviteKind; trigger: InviteTrigger } | null>(null);
  const [help, setHelp] = useState(false);
  const barDismissed = false; // barra não é mais dispensável: fica até instalar
  const [phase, setPhase] = useState<InstallPhase>(() => testPhase() || 'idle');
  const [doneClosed, setDoneClosed] = useState(false);
  const [installStart, setInstallStart] = useState<number | null>(null);
  const [installedAt, setInstalledAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const [appDetected, setAppDetected] = useState(() => testOpenBar());
  const [openBarClosed, setOpenBarClosed] = useState(false);
  const standalone = isStandalone(window);
  const platform = detectPlatform(navigator.userAgent);
  const blockedRef = useRef(false);
  blockedRef.current = !!hidden || !!busy;

  // Instalado só por appinstalled ou execução em modo standalone (nunca por clique/fechamento).
  useEffect(() => {
    if (standalone || appInstalledEvt) { markInstalled(localStorage, tenantId); setInstalled(true); }
    // appinstalled chega antes do ícone ficar pronto: só registra o momento; a barra segue gradual.
    if (appInstalledEvt && !standalone) {
      const now = Date.now();
      setInstalledAt(a => a ?? now);
      setInstallStart(s => s ?? now);
      setPhase(p => (p === 'idle' || p === 'slow' ? 'installing' : p));
    }
  }, [standalone, appInstalledEvt, tenantId]);
  // Sem appinstalled em ~3 min: só orienta conferir a tela inicial.
  useEffect(() => {
    if (phase !== 'installing' || testPhase()) return;
    const id = window.setTimeout(() => setPhase(p => nextInstallPhase(p, 'slow-timeout')), INSTALL_SLOW_MS);
    return () => window.clearTimeout(id);
  }, [phase]);
  // Atualiza a porcentagem estimada enquanto instala (ou aguarda) — sem nunca chegar a 100% sozinha.
  useEffect(() => {
    if (phase !== 'installing' && phase !== 'slow') return;
    setInstallStart(s => s ?? Date.now());
    const id = window.setInterval(() => setTick(t => t + 1), 500);
    return () => window.clearInterval(id);
  }, [phase]);
  // 100% (só com appinstalled e após o tempo mínimo) → "Pronto!" com o botão "Abrir app" já liberado.
  useEffect(() => {
    if ((phase !== 'installing' && phase !== 'slow') || installStart == null || installedAt == null || testPhase()) return;
    const id = window.setInterval(() => {
      if (estimatedInstallPercent(Date.now() - installStart, installedAt - installStart) >= 100) setPhase('done');
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, installStart, installedAt]);
  // Durante a instalação: app detectado (getInstalledRelatedApps) ou modo standalone também confirmam.
  useEffect(() => {
    if ((phase !== 'installing' && phase !== 'slow') || installedAt != null || testPhase()) return;
    let alive = true;
    const check = () => {
      if (isStandalone(window)) { setInstalledAt(a => a ?? Date.now()); return; }
      detectInstalledApp().then(v => { if (alive && v) setInstalledAt(a => a ?? Date.now()); }).catch(() => {});
    };
    const id = window.setInterval(check, 2000);
    // Ao voltar do diálogo/instalação do Chrome a aba pode ter ficado em segundo plano: confere já.
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', check);
    check();
    return () => { alive = false; window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', check); };
  }, [phase, installedAt]);
  // Visitas posteriores no navegador: detecta o app já instalado (Chrome Android, via related_applications).
  useEffect(() => {
    if (standalone) return;
    let alive = true;
    detectInstalledApp().then(v => { if (alive && v) setAppDetected(true); });
    return () => { alive = false; };
  }, [standalone, tenantId]);
  const openApp = () => { openInstalledApp(currentStartPath()); };
  const openButton = (
    <button type="button" onClick={openApp} data-testid="open-installed-app"
      className="shrink-0 rounded-full bg-[#a8c7fa] px-4 py-1.5 text-sm font-semibold text-[#062e6f] transition active:scale-95 active:brightness-90 hover:brightness-105">Abrir app</button>
  );

  // Diagnóstico: avisa no console quando o manifesto da loja não carrega (sem ele o Chrome não oferece instalação).
  useEffect(() => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    if (!href || href.startsWith('data:') || typeof fetch !== 'function') return;
    fetch(href, { credentials: 'same-origin' }).then(r => {
      if (!r.ok) console.warn(`[PWA] Manifesto da loja indisponível (HTTP ${r.status}): ${href}. O Chrome não oferecerá a instalação nativa.`);
    }).catch(err => console.warn('[PWA] Falha ao buscar o manifesto da loja:', href, err));
  }, [tenantId]);
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

  // Cada carregamento/visita: convite após a identidade da loja carregar (pequeno atraso).
  useEffect(() => { const id = window.setTimeout(() => tryInvite('visit'), 1200); return () => window.clearTimeout(id); }, [tryInvite]);
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

  const copy = installPhaseCopy(phase, storeName);
  if (copy && !hidden && (phase !== 'done' || !doneClosed)) {
    const isDone = phase === 'done' || phase === 'finishing';
    const openReady = phase === 'done';
    return (
      <div data-testid="install-progress" data-phase={phase} role="status" aria-live="polite" className="fixed inset-x-0 bottom-2 z-[120] px-3 flex justify-center pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl bg-[#2b2b2e] text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] ring-1 ring-white/5 px-3 py-2.5">
          <div className="flex items-center gap-3">
            {isDone ? <CheckCircle2 className="h-10 w-10 p-1.5 text-emerald-400 shrink-0" />
              : <StoreLogo logoUrl={logoUrl} name={storeName} color={color} className="w-10 h-10 shrink-0 rounded-xl" />}
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight break-words">{copy.title}</p>
              {copy.subtitle && <p className="text-xs text-neutral-400 leading-tight mt-0.5">{copy.subtitle}</p>}
            </div>
            {isDone && (openReady ? openButton : <button type="button" disabled aria-disabled="true" data-testid="open-installed-app-wait" className="shrink-0 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold text-neutral-400 cursor-not-allowed">Abrir app</button>)}
            {phase !== 'installing' && <button type="button" aria-label="Fechar" onClick={() => { setDoneClosed(true); if (!isDone) setPhase('idle'); }} className="shrink-0 -mr-1 p-1 text-neutral-400 hover:text-white"><X className="h-4 w-4" /></button>}
          </div>
          {isDone && <p data-testid="open-app-hint" className="mt-1.5 text-xs text-neutral-400 leading-snug">Se não abrir, toque no ícone {storeName} na sua tela inicial</p>}
          {(phase === 'installing' || phase === 'slow' || isDone) && (() => {
            const tp = testPhase();
            const elapsed = tp ? (tp === 'installing' ? 25000 : 200000) : Date.now() - (installStart ?? Date.now());
            const pct = isDone ? 100 : estimatedInstallPercent(elapsed, installedAt != null && installStart != null ? installedAt - installStart : null);
            return (
              <div className="mt-2.5 flex items-center gap-2" data-testid="install-percent" data-percent={pct}>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${isDone ? 'bg-emerald-400' : 'bg-[#a8c7fa]'}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-9 text-right text-xs font-semibold tabular-nums text-neutral-300">{pct}%</span>
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  // App já instalado (marca local ou detectado) e aberto no navegador: barra "Abrir app" no lugar de "Instalar".
  if (!standalone && !hidden && !openBarClosed && (appDetected || (installed && phase === 'idle'))) {
    return (
      <div data-testid="open-app-bar" role="region" aria-label={`Abrir app ${storeName}`} className="fixed inset-x-0 bottom-2 z-[120] px-3 flex justify-center pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl bg-[#2b2b2e] text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] ring-1 ring-white/5 px-3 py-2.5">
          <div className="flex items-center gap-3">
            <StoreLogo logoUrl={logoUrl} name={storeName} color={color} className="w-10 h-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight break-words">{storeName}</p>
              <p className="text-xs text-neutral-400 leading-tight mt-0.5">Você já tem o app. Peça por ele.</p>
            </div>
            {openButton}
            <button type="button" aria-label="Fechar" onClick={() => setOpenBarClosed(true)} className="shrink-0 -mr-1 p-1 text-neutral-400 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
          <p className="mt-1.5 text-xs text-neutral-400 leading-snug">Se não abrir, toque no ícone {storeName} na sua tela inicial</p>
        </div>
      </div>
    );
  }

  const surface = inviteSurface({ installed, standalone, hidden: !!hidden, inviteOpen: !!invite, nativeAvailable: !!deferred, barDismissed });
  if (surface === 'none') return null;

  const closeModal = () => { setInvite(null); setHelp(false); };
  const install = async () => {
    const ev = getDeferredPrompt();
    if (!ev) { setHelp(true); return; }
    clearDeferredPrompt(); // o evento só pode ser usado uma vez
    try { await ev.prompt(); } catch { setHelp(true); return; }
    const choice = await ev.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') { recordAccepted(localStorage, tenantId, Date.now()); setDoneClosed(false); setPhase(p => nextInstallPhase(p, 'accepted')); closeModal(); return; }
    setPhase(p => nextInstallPhase(p, 'dismissed'));
    closeModal();
  };

  const steps = platform === 'android-chrome' || platform === 'android-other';
  const instructions = (
    <div data-testid="install-instructions" className="mt-3 rounded-xl bg-white/5 border border-white/10 p-3.5 text-[13px] leading-snug text-neutral-200 text-left">
      {steps && <>
        <p className="text-[15px] font-semibold text-white mb-2.5">Instale em 2 toques</p>
        {platform === 'android-other' && <p className="mb-2 text-neutral-300">Funciona melhor no <b>Google Chrome</b>.</p>}
        <ol className="space-y-2">
          <li className="flex items-center gap-2.5"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10"><MoreVertical className="h-4 w-4" /></span><span><b>1.</b> Toque em <b>⋮</b> no canto superior direito</span></li>
          <li className="flex items-center gap-2.5"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10"><Download className="h-4 w-4" /></span><span><b>2.</b> Toque em <b>“Instalar app”</b> ou <b>“Adicionar à tela inicial”</b></span></li>
        </ol>
      </>}
      {platform === 'ios-safari' && <p className="flex flex-wrap items-center gap-1">No Safari, toque em <Share className="inline h-4 w-4" /> <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</p>}
      {platform === 'ios-other' && <p>No iPhone, a instalação é feita pelo <b>Safari</b>. Abra este link no Safari, toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</p>}
      {platform === 'desktop' && <p>Abra este link no navegador do seu celular (Chrome no Android ou Safari no iPhone) para instalar o app da loja.</p>}
      <p className="mt-3 text-xs text-neutral-400">É rápido, gratuito e não ocupa quase nada de espaço.</p>
      <button type="button" data-testid="install-help-ok" onClick={() => setHelp(false)}
        className="mt-3 w-full rounded-full bg-white/10 py-2 text-sm font-semibold text-white active:scale-[0.98] active:bg-white/20 transition">Entendi</button>
    </div>
  );

  const card = surface !== 'fallback-bar';
  const t = invite?.trigger;
  const line = !card ? 'Mais praticidade para pedir de novo.' : t === 'order' ? 'Acompanhe seu pedido pelo app' : t === 'cart' ? 'Peça mais rápido da próxima vez' : 'Abra a loja com um toque na tela inicial';
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
          {phase !== 'installing' && <button type="button" onClick={install} data-testid="install-primary" aria-pressed={help}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition active:scale-95 active:brightness-90 hover:brightness-105 ${help ? 'bg-[#7fa6e8] text-[#041e49] ring-2 ring-white/30' : 'bg-[#a8c7fa] text-[#062e6f]'}`}>Instalar</button>}
          {card ? <button type="button" aria-label="Fechar" data-testid="install-continue" onClick={closeModal}
            className="shrink-0 -mr-1 p-1 text-neutral-400 hover:text-white"><X className="h-4 w-4" /></button>
            : help ? <button type="button" aria-label="Fechar instruções" onClick={() => setHelp(false)}
            className="shrink-0 -mr-1 p-1 text-neutral-400 hover:text-white"><X className="h-4 w-4" /></button> : null}
        </div>
        {help && instructions}
      </div>
    </div>
  );
};
