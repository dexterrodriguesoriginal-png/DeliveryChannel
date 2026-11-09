import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Smartphone, X } from 'lucide-react';
import {
  INSTALL_DURATION_MS,
  INSTALL_PROGRESS_TITLE,
  OPEN_APP_BUTTON_LABEL,
  formatInstallCountdown,
  persistInstallStart,
  prefersReducedMotion,
  progressAt,
} from '../../lib/pwa/installProgress';
import { rememberOpenAttempt } from '../../lib/pwa/openInstalledApp';

export interface InstallProgressProps {
  appId: string;
  appName: string;
  startPath: string;
  startedAt?: number | null;
  forceElapsedMs?: number | null;
  logo?: React.ReactNode;
  subtitle?: string;
  /** Título durante o progresso. Padrão: "Tempo estimado de instalação". */
  title?: string;
  /** Texto ao concluir. Padrão: "Pronto! O app {appName} está na sua tela inicial". */
  doneTitle?: string;
  /** Rótulo do botão ao concluir. Padrão: "Abrir o app". */
  openLabel?: string;
  /** Instrução visível após instalar. Nunca deixe só um botão morto. */
  openHint?: string;
  onClose?: () => void;
  onComplete?: () => void;
  variant?: 'floating' | 'inline';
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Barra reutilizável de progresso de instalação de 60 s (cliente, garçom, cozinha, entregador).
 * Persiste o início em `sessionStorage`, exibe contagem regressiva e libera "Abrir o app" em 100%.
 */
export const InstallProgress: React.FC<InstallProgressProps> = ({
  appId,
  appName,
  startPath,
  startedAt,
  forceElapsedMs,
  logo,
  subtitle,
  title = INSTALL_PROGRESS_TITLE,
  doneTitle,
  openLabel = OPEN_APP_BUTTON_LABEL,
  openHint,
  onClose,
  onComplete,
  variant = 'floating',
  className = '',
  style,
}) => {
  const [startMs, setStartMs] = useState<number>(() => {
    const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    return persistInstallStart(storage, appId, startedAt ?? Date.now());
  });
  const [, setTick] = useState(0);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    setStartMs(persistInstallStart(storage, appId, startedAt ?? Date.now()));
  }, [appId, startedAt]);

  const elapsed = forceElapsedMs != null ? Math.max(0, forceElapsedMs) : Math.max(0, Date.now() - startMs);
  const pct = progressAt(elapsed);
  const isDone = pct >= 100;
  const countdown = formatInstallCountdown(elapsed);
  const reducedMotion = prefersReducedMotion(typeof window !== 'undefined' ? window : undefined);

  useEffect(() => {
    if (forceElapsedMs != null) {
      if (forceElapsedMs >= INSTALL_DURATION_MS && !completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.();
      }
      return;
    }
    const currentElapsed = Math.max(0, Date.now() - startMs);
    if (currentElapsed >= INSTALL_DURATION_MS) {
      if (!completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.();
      }
      return;
    }
    const intervalId = window.setInterval(() => {
      const el = Math.max(0, Date.now() - startMs);
      setTick(t => t + 1);
      if (el >= INSTALL_DURATION_MS) {
        window.clearInterval(intervalId);
        if (!completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current?.();
        }
      }
    }, 250);
    const timeoutId = window.setTimeout(() => {
      setTick(t => t + 1);
      if (!completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.();
      }
    }, Math.max(0, INSTALL_DURATION_MS - currentElapsed));
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [startMs, forceElapsedMs]);

  const startHref = typeof window !== 'undefined' ? new URL(startPath, window.location.origin).href : startPath;
  const resolvedOpenHint = openHint || `Abra o app ${appName} na tela inicial`;

  const handleOpenApp = () => {
    // O <a target=_blank> abre o start_url no escopo (launch_handler / capture_links).
    if (typeof sessionStorage !== 'undefined') rememberOpenAttempt(sessionStorage, appId);
  };

  const phase = isDone ? 'done' : 'installing';
  const cardContent = (
    <div className="pointer-events-auto w-full max-w-sm rounded-2xl bg-[#2b2b2e] text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] ring-1 ring-white/5 px-3 py-2.5">
      <div className="flex items-center gap-3">
        {isDone ? (
          <CheckCircle2 className="h-10 w-10 p-1.5 text-emerald-400 shrink-0" />
        ) : (
          logo ?? (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-300">
              <Smartphone className="h-5 w-5" />
            </div>
          )
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-semibold leading-tight break-words">{isDone ? (doneTitle || title) : title}</p>
            <span data-testid="install-countdown" className="shrink-0 text-xs font-semibold tabular-nums text-neutral-300">
              {countdown}
            </span>
          </div>
          <p className="text-xs text-neutral-400 leading-tight mt-0.5">
            {isDone ? (doneTitle ? '' : `Pronto! O app ${appName} está na sua tela inicial`) : subtitle || appName}
          </p>
        </div>
        {isDone && (
          <a
            href={startHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleOpenApp}
            data-testid="open-installed-app"
            className="shrink-0 rounded-full bg-[#a8c7fa] px-4 py-1.5 text-sm font-semibold text-[#062e6f] transition active:scale-95 active:brightness-90 hover:brightness-105"
          >
            {openLabel}
          </a>
        )}
        {isDone && onClose && (
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="shrink-0 -mr-1 p-1 text-neutral-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {isDone && (
        <p data-testid="open-app-hint" role="status" className="mt-1.5 text-xs text-neutral-400 leading-snug">
          {resolvedOpenHint}
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2" data-testid="install-percent" data-percent={pct}>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label={INSTALL_PROGRESS_TITLE}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div
            data-testid="install-progress-bar"
            data-reduced-motion={reducedMotion ? 'true' : 'false'}
            className={`h-full rounded-full motion-reduce:transition-none ${
              reducedMotion ? 'transition-none' : 'transition-[width] duration-300 ease-out'
            } ${isDone ? 'bg-emerald-400' : 'bg-[#a8c7fa]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-9 text-right text-xs font-semibold tabular-nums text-neutral-300">{pct}%</span>
      </div>
    </div>
  );

  if (variant === 'inline') {
    return (
      <div
        data-testid="install-progress"
        data-phase={phase}
        role="status"
        aria-live="polite"
        className={className}
        style={style}
      >
        {cardContent}
      </div>
    );
  }

  return (
    <div
      data-testid="install-progress"
      data-phase={phase}
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 z-[120] px-3 flex justify-center pointer-events-none ${className}`}
      style={style}
    >
      {cardContent}
    </div>
  );
};

