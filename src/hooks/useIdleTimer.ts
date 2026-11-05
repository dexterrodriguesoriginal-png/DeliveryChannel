import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseIdleTimerOptions {
  enabled?: boolean;
  idleTimeoutSeconds?: number;
  warningSeconds?: number;
  onTimeout(): void;
  onWarning?(): void;
  onReset?(): void;
}

export interface UseIdleTimerResult {
  isWarning: boolean;
  secondsRemaining: number;
  resetTimer(): void;
}

export const MIN_IDLE_TIMEOUT_SECONDS = 30;
export const MAX_IDLE_TIMEOUT_SECONDS = 300;
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 60;
export const DEFAULT_WARNING_SECONDS = 10;

export function clampIdleTimeout(seconds?: number): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return DEFAULT_IDLE_TIMEOUT_SECONDS;
  }
  const rounded = Math.round(seconds);
  return Math.max(MIN_IDLE_TIMEOUT_SECONDS, Math.min(MAX_IDLE_TIMEOUT_SECONDS, rounded));
}

const USER_EVENTS = ['pointerdown', 'mousemove', 'keydown', 'scroll', 'touchstart'] as const;

export function useIdleTimer({
  enabled = true,
  idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS,
  warningSeconds = DEFAULT_WARNING_SECONDS,
  onTimeout,
  onWarning,
  onReset,
}: UseIdleTimerOptions): UseIdleTimerResult {
  const effectiveIdleSeconds = clampIdleTimeout(idleTimeoutSeconds);
  const [isWarning, setIsWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(warningSeconds);

  const isWarningRef = useRef(false);
  isWarningRef.current = isWarning;

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const warningRef = useRef(false);
  const callbacksRef = useRef({ onTimeout, onWarning, onReset });
  callbacksRef.current = { onTimeout, onWarning, onReset };

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (countdownIntervalRef.current !== null) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const startCountdown = useCallback(() => {
    clearTimers();
    isWarningRef.current = true;
    warningRef.current = true;
    setIsWarning(true);
    setSecondsRemaining(warningSeconds);
    callbacksRef.current.onWarning?.();

    let remaining = warningSeconds;
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearTimers();
        isWarningRef.current = false;
        setIsWarning(false);
        setSecondsRemaining(0);
        callbacksRef.current.onTimeout();
      } else {
        setSecondsRemaining(remaining);
      }
    }, 1000);
  }, [clearTimers, warningSeconds]);

  const startIdleTimer = useCallback(() => {
    clearTimers();
    isWarningRef.current = false;
    setIsWarning(false);
    setSecondsRemaining(warningSeconds);
    idleTimerRef.current = setTimeout(() => {
      startCountdown();
    }, effectiveIdleSeconds * 1000);
  }, [clearTimers, effectiveIdleSeconds, startCountdown, warningSeconds]);

  const resetTimer = useCallback(() => {
    if (!enabled) return;
    const wasWarning = isWarningRef.current;
    startIdleTimer();
    if (wasWarning) {
      callbacksRef.current.onReset?.();
    }
  }, [enabled, startIdleTimer]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      isWarningRef.current = false;
      setIsWarning(false);
      setSecondsRemaining(warningSeconds);
      return;
    }

    startIdleTimer();

    const handleUserActivity = () => {
      resetTimer();
    };

    const opts = { passive: true, capture: true };
    USER_EVENTS.forEach(event => {
      window.addEventListener(event, handleUserActivity, opts);
    });

    return () => {
      clearTimers();
      USER_EVENTS.forEach(event => {
        window.removeEventListener(event, handleUserActivity, opts);
      });
    };
  }, [enabled, effectiveIdleSeconds, warningSeconds, startIdleTimer, resetTimer, clearTimers]);

  return {
    isWarning,
    secondsRemaining,
    resetTimer,
  };
}
