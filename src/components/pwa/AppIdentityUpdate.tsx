import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  APP_IDENTITY_META, APP_IDENTITY_RE, identityStatus, newestLaunchedKey, reinstallUrl, REINSTALL_PARAM,
  chromeIntentUrl, splitStoreSegment, storeSegmentFromPath, versionedStartUrl,
} from '../../lib/pwa/appIdentity';
import { clearDeferredPrompt, detectPlatform, getDeferredPrompt, isStandalone, subscribeInstall, wasAppInstalledEvent } from '../../lib/pwa/installState';

/** Versão atual da logo que o servidor injeta só para lojas de teste (<meta name="dc-app-identity">). */
export function readAppIdentityMeta(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): string | null {
  const v = doc?.querySelector(`meta[name="${APP_IDENTITY_META}"]`)?.getAttribute('content') || '';
  return APP_IDENTITY_RE.test(v) ? v : null;
}

export const REINSTALL_PROGRESS_MS = 1200;
export const REINSTALL_PROMPT_WAIT_MS = 3000;
/** Aceitar o convite não é instalar: espera o appinstalled antes de mandar remover o ícone antigo. */
export const REINSTALL_CONFIRM_WAIT_MS = 45000;

const safeGet = (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };

type Phase = 'idle' | 'opening-chrome' | 'pending-install' | 'slow-install' | 'installed' | 'no-prompt';

const card: React.CSSProperties = {
  background: 'var(--dc-bg-card-color)', color: 'var(--dc-text-main)', border: '1px solid var(--dc-border)',
  borderRadius: 16, boxShadow: '0 10px 30px rgba(0,0,0,.18)',
};
const primaryBtn: React.CSSProperties = {
  background: 'var(--dc-primary)', color: 'var(--dc-button-text)', border: 0, borderRadius: 999,
  padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  background: 'transparent', color: 'var(--dc-text-main)', border: '1px solid var(--dc-border)', borderRadius: 999,
  padding: '10px 18px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
};

/** Atualização da identidade do app; só appinstalled confirma uma instalação. */
export function AppIdentityUpdate({ slug, storeName, initialIdentity }: { slug: string; storeName: string; initialIdentity: string }) {
  const [current, setCurrent] = useState(initialIdentity);
  const [phase, setPhase] = useState<Phase>('idle');
  const [dismissed, setDismissed] = useState(false);
  const [, force] = useState(0);
  const standalone = useMemo(() => isStandalone(window), []);
  const android = useMemo(() => detectPlatform(navigator.userAgent || '').startsWith('android'), []);
  const running = useMemo(() => splitStoreSegment(storeSegmentFromPath(window.location.pathname) || '').identity, []);
  const reinstallRequested = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get(REINSTALL_PARAM) === '1'; } catch { return false; }
  }, []);

  // Versão atual direto do servidor (o HTML pode estar alguns minutos atrás).
  useEffect(() => {
    let alive = true;
    fetch(`/api/pwa/version?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j && typeof j.appIdentity === 'string' && APP_IDENTITY_RE.test(j.appIdentity)) setCurrent(j.appIdentity); })
      .catch(() => {});
    return () => { alive = false; };
  }, [slug]);
  useEffect(() => subscribeInstall(() => force(n => n + 1)), []);

  // Aberto pelo ícone da versão atual: avisa os ícones antigos (armazenamento do Chrome é comum à origem).
  useEffect(() => {
    if (standalone && !reinstallRequested && running === current && !document.referrer) safeSet(newestLaunchedKey(slug), current);
  }, [standalone, reinstallRequested, running, current, slug]);

  const status = identityStatus({ standalone, runningIdentity: running, currentIdentity: current, newestLaunched: safeGet(newestLaunchedKey(slug)), reinstallRequested });

  // appinstalled (pelo botão, pelo menu ⋮ ou depois de "Instalando..."): mostra "Pronto!".
  useEffect(() => {
    if (wasAppInstalledEvent() && phase !== 'installed' && (status === 'reinstall' || phase === 'pending-install' || phase === 'slow-install')) setPhase('installed');
  });
  // Só o appinstalled confirma a versão nova instalada (libera "Abrir a nova" no ícone antigo).
  useEffect(() => {
    if ((status === 'reinstall' || status === 'update-available') && phase === 'installed') safeSet(newestLaunchedKey(slug), current);
  }, [status, phase, slug, current]);

  useEffect(() => {
    if (phase !== 'pending-install') return;
    const t = setTimeout(() => setPhase(p => (p === 'pending-install' ? 'slow-install' : p)), REINSTALL_CONFIRM_WAIT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Instalação seguiu na aba do Chrome: ao voltar para este app, libera a loja (os eventos de lá não chegam aqui).
  useEffect(() => {
    if (phase !== 'opening-chrome') return;
    let left = false;
    const onVis = () => {
      if (document.visibilityState === 'hidden') left = true;
      else if (left) setPhase('idle');
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase]);

  const openNewApp = useCallback(() => {
    // Link https comum (no toque do cliente): o Chrome abre o app instalado que é o único dono desse endereço
    // (WebApkSelfOwnedRendererNavLaunch). intent:// para o Chrome só navegava a janela atual.
    window.location.href = `${window.location.origin}${versionedStartUrl(slug, current)}`;
  }, [slug, current]);

  const runPrompt = useCallback(async () => {
    const d = getDeferredPrompt();
    if (!d) return false;
    try {
      await d.prompt();
      const choice = await d.userChoice;
      clearDeferredPrompt(); // o evento só serve uma vez
      // Aceito ≠ instalado: fica "Instalando..." até o appinstalled. Recusado: aba do Chrome vai para o menu ⋮.
      setPhase(wasAppInstalledEvent() ? 'installed' : choice.outcome === 'accepted' ? 'pending-install' : (status === 'reinstall' ? 'no-prompt' : 'idle'));
      return true;
    } catch {
      return false;
    }
  }, [status]);

  const startUpdate = useCallback(() => {
    // Ainda no toque: janela nova fora do app (o intent:// para o Chrome só navegava a janela do próprio app, onde
    // o Chrome nunca oferece instalar). Se bloquearem, abre aqui mesmo; a página de instalação mostra o caminho.
    // Se o próprio app já tem o convite nativo (raro), instala aqui mesmo.
    if (getDeferredPrompt()) { void runPrompt().then(ok => { if (!ok) setPhase('idle'); }); return; }
    const url = reinstallUrl(window.location.origin, slug, current);
    let w: Window | null = null;
    try { w = window.open(url, '_blank'); } catch { w = null; }
    if (!w) { window.location.href = url; return; }
    setPhase('opening-chrome');
  }, [runPrompt, slug, current]);

  // Experimento só no Android (WebAPK do Chrome); iPhone e outros seguem como hoje.
  if (!android || status === 'current' || dismissed) return null;

  const overlay = (children: React.ReactNode) => (
    <div data-testid="identity-overlay" role="dialog" aria-modal="true" aria-label={`Atualizando ${storeName}`}
      style={{ position: 'fixed', inset: 0, zIndex: 2147482000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--dc-bg-general-color)' }}>
      <div style={{ ...card, width: '100%', maxWidth: 380, padding: 20 }}>{children}</div>
    </div>
  );
  const title = (t: string) => <p style={{ fontWeight: 800, fontSize: 17, margin: '0 0 12px' }}>{t}</p>;
  const close = (label = 'Agora não') => (
    <button type="button" style={{ ...secondaryBtn, width: '100%', marginTop: 8 }} onClick={() => setDismissed(true)}>{label}</button>
  );

  const installedView = (
    <div data-testid="identity-installed">
      {title('Pronto!')}
      <p style={{ fontSize: 13, margin: '12px 0 0' }}>A nova versão está na tela inicial.</p>
      <button type="button" style={{ ...primaryBtn, width: '100%', marginTop: 14 }} onClick={openNewApp} data-testid="identity-open-new">Abrir a nova</button>
    </div>
  );
  const pendingView = (
    <div data-testid={phase === 'slow-install' ? 'identity-slow' : 'identity-pending'}>
      {title('Instalando aplicativo...')}
      {phase === 'slow-install' && (<>
        <button type="button" style={{ ...primaryBtn, width: '100%', marginTop: 14 }} onClick={openNewApp} data-testid="identity-open-new">Abrir a nova</button>
        {close('Fechar')}
      </>)}
    </div>
  );

  if (status === 'update-available') {
    if (phase === 'installed') return overlay(installedView);
    if (phase === 'pending-install' || phase === 'slow-install') return overlay(pendingView);
    if (phase === 'opening-chrome') return overlay(
      <div data-testid="identity-opening-chrome">
        {title('Página de instalação aberta')}
        <button type="button" style={{ ...secondaryBtn, width: '100%' }} onClick={() => setPhase('idle')} data-testid="identity-back">Voltar à loja</button>
      </div>,
    );
    return (
      <div data-testid="identity-pill" role="status"
        style={{ ...card, position: 'fixed', left: 12, right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 10px)', zIndex: 2147482000,
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 16px', borderRadius: 999 }}>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>Nova versão do app</span>
        <button type="button" style={{ ...primaryBtn, padding: '9px 14px', fontSize: 13 }} onClick={startUpdate} data-testid="identity-update">Baixar versão atualizada</button>
      </div>
    );
  }

  if (status === 'old-icon') {
    // Acabou de instalar pelo convite no próprio app antigo: mantém o "Pronto!" (já marcado como instalado).
    if (phase === 'installed') return overlay(installedView);
    return (
      <div data-testid="identity-old-icon" role="alert"
        style={{ ...card, position: 'fixed', left: 12, right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 10px)', zIndex: 2147482000,
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 16px', borderRadius: 999 }}>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>Esta versão é antiga, pode apagar</span>
        <button type="button" style={{ ...primaryBtn, padding: '9px 14px', fontSize: 13 }} onClick={openNewApp} data-testid="identity-open-new">Abrir a nova</button>
        <button type="button" aria-label="Fechar" onClick={() => setDismissed(true)}
          style={{ background: 'transparent', border: 0, color: 'var(--dc-text-main)', fontSize: 20, lineHeight: 1, padding: '4px 8px', cursor: 'pointer' }}>×</button>
      </div>
    );
  }

  // ?reinstall=1: controles disponíveis desde o primeiro render, sem progresso artificial.
  const installFromPage = async () => {
    if (!getDeferredPrompt()) {
      const found = await new Promise<boolean>(resolve => {
        if (getDeferredPrompt()) { resolve(true); return; }
        let finished = false;
        const finish = (available: boolean) => {
          if (finished) return;
          finished = true;
          unsubscribe();
          window.clearTimeout(timer);
          resolve(available);
        };
        const unsubscribe = subscribeInstall(() => { if (getDeferredPrompt()) finish(true); });
        const timer = window.setTimeout(() => finish(!!getDeferredPrompt()), REINSTALL_PROMPT_WAIT_MS);
      });
      if (!found) { setPhase('no-prompt'); return; }
    }
    if (!(await runPrompt())) setPhase('no-prompt');
  };
  const httpsUrl = reinstallUrl(window.location.origin, slug, current);
  const chromeUrl = chromeIntentUrl(httpsUrl, { android });
  const appLogo = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href
    || document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href;
  return overlay(
    phase === 'installed' ? installedView
    : phase === 'pending-install' || phase === 'slow-install' ? pendingView
    : (
      <div data-testid="identity-reinstall" style={{ textAlign: 'center' }}>
        {appLogo ? <img src={appLogo} alt={`Logo de ${storeName}`} width={80} height={80}
          style={{ width: 80, height: 80, objectFit: 'contain', borderRadius: 16, margin: '0 auto 12px' }} /> :
          <div role="img" aria-label={`Logo de ${storeName}`} style={{ background: 'var(--dc-primary)', color: 'var(--dc-button-text)', width: 80, height: 80, borderRadius: 16, margin: '0 auto 12px', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 800 }}>{storeName.slice(0, 2).toUpperCase()}</div>}
        <p style={{ fontSize: 20, fontWeight: 800, margin: '0 0 18px' }}>{storeName}</p>
        <button type="button" style={{ ...primaryBtn, width: '100%', minHeight: 52, fontSize: 16 }}
          data-testid="identity-install" onClick={() => { void installFromPage(); }}>Instalar app</button>
        <a href={chromeUrl} data-testid="identity-chrome" style={{ ...secondaryBtn, width: '100%', minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', marginTop: 12, textDecoration: 'none', fontSize: 16 }}>
          Baixar pelo Google Chrome
        </a>
        {phase === 'no-prompt' && <p data-testid="identity-no-prompt" style={{ fontSize: 13, margin: '14px 0 0' }}>Toque em <b>⋮</b> e escolha <b>Abrir no Chrome</b> ou <b>Instalar app</b>.</p>}
        {close('Fechar')}
      </div>
    ),
  );
}
