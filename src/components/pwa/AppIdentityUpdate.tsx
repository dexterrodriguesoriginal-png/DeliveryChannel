import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  APP_IDENTITY_META, APP_IDENTITY_RE, chromeIntentUrl, identityStatus, newestLaunchedKey, reinstallUrl, REINSTALL_PARAM,
  splitStoreSegment, storeSegmentFromPath, versionedStartUrl,
} from '../../lib/pwa/appIdentity';
import { clearDeferredPrompt, detectPlatform, getDeferredPrompt, isStandalone, subscribeInstall, wasAppInstalledEvent } from '../../lib/pwa/installState';

/** Versão atual da logo que o servidor injeta só para lojas de teste (<meta name="dc-app-identity">). */
export function readAppIdentityMeta(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): string | null {
  const v = doc?.querySelector(`meta[name="${APP_IDENTITY_META}"]`)?.getAttribute('content') || '';
  return APP_IDENTITY_RE.test(v) ? v : null;
}

export const REINSTALL_PROGRESS_MS = 1200;
export const REINSTALL_PROMPT_WAIT_MS = 8000;

const safeGet = (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { window.localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };

type Phase = 'idle' | 'progress' | 'opening-chrome' | 'waiting-prompt' | 'ready' | 'installed' | 'no-prompt';

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

function ProgressBar({ indeterminate, value }: { indeterminate?: boolean; value?: number }) {
  return (
    <div role="progressbar" aria-label="Atualizando aplicativo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : value}
      style={{ height: 8, borderRadius: 999, background: 'var(--dc-border)', overflow: 'hidden', position: 'relative' }}>
      <style>{'@keyframes dc-reinstall-indet{0%{left:-40%}100%{left:100%}}'}</style>
      <div data-testid="identity-progress-fill" style={indeterminate
        ? { position: 'absolute', top: 0, bottom: 0, width: '40%', background: 'var(--dc-primary)', borderRadius: 999, animation: 'dc-reinstall-indet 1.1s ease-in-out infinite' }
        : { height: '100%', width: `${value ?? 0}%`, background: 'var(--dc-primary)', borderRadius: 999, transition: `width ${REINSTALL_PROGRESS_MS}ms ease-out` }} />
    </div>
  );
}

function RemoveOldIconSteps() {
  return (
    <ol data-testid="identity-remove-steps" style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
      <li>Na tela inicial, toque e segure o ícone <b>antigo</b> da loja.</li>
      <li>Toque em <b>Desinstalar</b> (ou <b>Remover</b>). No Android 9, arraste até <b>Desinstalar</b>.</li>
      <li>Use só o ícone novo daqui para a frente.</li>
    </ol>
  );
}

/**
 * EXPERIMENTO (só lojas de teste): "Nova versão do app disponível" quando a logo mudou.
 * O Android não deixa um site apagar outro app: o botão instala a versão nova e orienta a remover o ícone antigo.
 */
export function AppIdentityUpdate({ slug, storeName, initialIdentity }: { slug: string; storeName: string; initialIdentity: string }) {
  const [current, setCurrent] = useState(initialIdentity);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
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
    if (standalone && running === current) safeSet(newestLaunchedKey(slug), current);
  }, [standalone, running, current, slug]);

  const status = identityStatus({ standalone, runningIdentity: running, currentIdentity: current, newestLaunched: safeGet(newestLaunchedKey(slug)), reinstallRequested });

  // Aba do Chrome vinda do "Atualizar": espera o convite de instalação nativo.
  useEffect(() => {
    if (status !== 'reinstall') return;
    setPhase(p => (p === 'idle' ? 'waiting-prompt' : p));
    const t = setTimeout(() => setPhase(p => (p === 'waiting-prompt' ? (wasAppInstalledEvent() ? 'installed' : 'no-prompt') : p)), REINSTALL_PROMPT_WAIT_MS);
    return () => clearTimeout(t);
  }, [status]);
  const deferred = getDeferredPrompt();
  useEffect(() => {
    if (status === 'reinstall' && (phase === 'waiting-prompt' || phase === 'no-prompt') && deferred) setPhase('ready');
    if (wasAppInstalledEvent() && phase !== 'installed' && phase !== 'idle') setPhase('installed');
  });

  const openNewApp = useCallback(() => {
    const url = `${window.location.origin}${versionedStartUrl(slug, current)}`;
    // Sem package: o Android entrega ao app (WebAPK) que abre esse endereço.
    window.location.href = chromeIntentUrl(url, { android, package: null });
  }, [slug, current, android]);

  const runPrompt = useCallback(async () => {
    const d = getDeferredPrompt();
    if (!d) return false;
    try {
      await d.prompt();
      const choice = await d.userChoice;
      clearDeferredPrompt(); // o evento só serve uma vez
      setPhase(choice.outcome === 'accepted' ? 'installed' : (status === 'reinstall' ? 'ready' : 'idle'));
      return true;
    } catch {
      return false;
    }
  }, [status]);

  const startUpdate = useCallback(() => {
    setPhase('progress');
    setProgress(0);
    requestAnimationFrame(() => setProgress(90));
    setTimeout(async () => {
      // Se o próprio app já recebeu o convite (versão nova fora do scope deste ícone), instala aqui mesmo.
      if (await runPrompt()) return;
      setPhase('opening-chrome');
      window.location.href = chromeIntentUrl(reinstallUrl(window.location.origin, slug, current), { android });
    }, REINSTALL_PROGRESS_MS);
  }, [runPrompt, slug, current, android]);

  if (status === 'current' || dismissed) return null;

  const overlay = (children: React.ReactNode) => (
    <div data-testid="identity-overlay" role="dialog" aria-modal="true" aria-label="Atualizando aplicativo"
      style={{ position: 'fixed', inset: 0, zIndex: 2147482000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--dc-bg-general-color)' }}>
      <div style={{ ...card, width: '100%', maxWidth: 380, padding: 20 }}>{children}</div>
    </div>
  );

  if (status === 'update-available') {
    if (phase === 'progress' || phase === 'opening-chrome' || phase === 'installed') {
      return overlay(phase === 'installed' ? (
        <div data-testid="identity-installed">
          <p style={{ fontWeight: 800, fontSize: 17, margin: 0 }}>Pronto! Nova versão instalada</p>
          <p style={{ fontSize: 13, margin: '6px 0 0' }}>Abra {storeName} pelo ícone novo e remova este ícone antigo:</p>
          <RemoveOldIconSteps />
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button type="button" style={primaryBtn} onClick={openNewApp}>Abrir app novo</button>
            <button type="button" style={secondaryBtn} onClick={() => setDismissed(true)}>Agora não</button>
          </div>
        </div>
      ) : (
        <div data-testid="identity-progress">
          <p style={{ fontWeight: 800, fontSize: 17, margin: '0 0 12px' }}>Atualizando aplicativo...</p>
          <ProgressBar value={progress} />
          <p style={{ fontSize: 13, margin: '12px 0 0' }}>
            {phase === 'opening-chrome' ? 'Abrindo o Chrome para instalar a nova versão. Toque em Instalar quando aparecer.' : 'Preparando a nova versão do app.'}
          </p>
        </div>
      ));
    }
    return (
      <div data-testid="identity-pill" role="status"
        style={{ ...card, position: 'fixed', left: 12, right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 10px)', zIndex: 2147482000,
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px 10px 16px', borderRadius: 999 }}>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>Nova versão do app disponível</span>
        <button type="button" style={primaryBtn} onClick={startUpdate} data-testid="identity-update">Atualizar</button>
      </div>
    );
  }

  if (status === 'old-icon') {
    return (
      <div data-testid="identity-old-icon" role="alert"
        style={{ ...card, position: 'fixed', left: 12, right: 12, top: 'calc(env(safe-area-inset-top, 0px) + 10px)', zIndex: 2147482000, padding: 16 }}>
        <p style={{ fontWeight: 800, fontSize: 15, margin: 0 }}>Este ícone é antigo</p>
        <p style={{ fontSize: 13, margin: '4px 0 0' }}>Você já tem a versão nova de {storeName}. Abra pelo ícone novo e remova este:</p>
        <RemoveOldIconSteps />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" style={primaryBtn} onClick={openNewApp} data-testid="identity-open-new">Abrir app novo</button>
          <button type="button" style={secondaryBtn} onClick={() => setDismissed(true)}>Fechar</button>
        </div>
      </div>
    );
  }

  // status === 'reinstall' (aba do Chrome)
  return overlay(
    phase === 'installed' ? (
      <div data-testid="identity-installed">
        <p style={{ fontWeight: 800, fontSize: 17, margin: 0 }}>Pronto! Nova versão instalada</p>
        <p style={{ fontSize: 13, margin: '6px 0 0' }}>O ícone novo de {storeName} está na tela inicial. Agora remova o ícone antigo:</p>
        <RemoveOldIconSteps />
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button type="button" style={primaryBtn} onClick={openNewApp}>Abrir app novo</button>
          <button type="button" style={secondaryBtn} onClick={() => setDismissed(true)}>Fechar</button>
        </div>
      </div>
    ) : phase === 'ready' ? (
      <div data-testid="identity-ready">
        <p style={{ fontWeight: 800, fontSize: 17, margin: '0 0 12px' }}>Atualizando aplicativo...</p>
        <ProgressBar value={95} />
        <p style={{ fontSize: 13, margin: '12px 0 14px' }}>Falta um toque: instale a nova versão de {storeName}.</p>
        <button type="button" style={{ ...primaryBtn, width: '100%' }} onClick={() => { void runPrompt(); }} data-testid="identity-install">Instalar nova versão</button>
      </div>
    ) : phase === 'no-prompt' ? (
      <div data-testid="identity-no-prompt">
        <p style={{ fontWeight: 800, fontSize: 17, margin: 0 }}>Quase lá</p>
        <p style={{ fontSize: 13, margin: '6px 0 0' }}>Se o pedido de instalação não apareceu, toque em <b>⋮</b> (menu do Chrome) → <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>). Depois remova o ícone antigo.</p>
        <button type="button" style={{ ...secondaryBtn, marginTop: 14 }} onClick={() => setDismissed(true)}>Fechar</button>
      </div>
    ) : (
      <div data-testid="identity-waiting">
        <p style={{ fontWeight: 800, fontSize: 17, margin: '0 0 12px' }}>Atualizando aplicativo...</p>
        <ProgressBar indeterminate />
        <p style={{ fontSize: 13, margin: '12px 0 0' }}>Preparando a instalação da nova versão.</p>
      </div>
    ),
  );
}
