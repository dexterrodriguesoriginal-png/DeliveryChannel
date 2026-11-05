/**
 * Lógica pura da barra de instalação de 60 s para PWAs (cliente, garçom, cozinha, entregador).
 * Curva monotônica por segmentos (rápido → devagar → rápido → devagar), chegando a 100% exatamente em 60 s.
 */

export const INSTALL_DURATION_MS = 60_000;
export const INSTALL_PROGRESS_TITLE = 'Tempo estimado de instalação';
export const OPEN_APP_BUTTON_LABEL = 'Abrir o app';

export interface ProgressSegment {
  startMs: number;
  endMs: number;
  startPct: number;
  endPct: number;
  speed: 'fast' | 'slow';
}

/**
 * Segmentos com velocidade alternada (rápido → devagar → rápido → devagar):
 * - 0..12 s: 0% → 40% (~3,33%/s, rápido)
 * - 12..28 s: 40% → 52% (~0,75%/s, devagar)
 * - 28..42 s: 52% → 86% (~2,43%/s, rápido)
 * - 42..60 s: 86% → 100% (~0,78%/s, devagar)
 */
export const INSTALL_SEGMENTS: readonly ProgressSegment[] = [
  { startMs: 0, endMs: 12_000, startPct: 0, endPct: 40, speed: 'fast' },
  { startMs: 12_000, endMs: 28_000, startPct: 40, endPct: 52, speed: 'slow' },
  { startMs: 28_000, endMs: 42_000, startPct: 52, endPct: 86, speed: 'fast' },
  { startMs: 42_000, endMs: 60_000, startPct: 86, endPct: 100, speed: 'slow' },
];

/**
 * Calcula a porcentagem (0..100) no instante `ms` (tempo decorrido desde o início).
 * Monotônica, nunca chega a 100% antes de 60 000 ms e atinge 100% exatamente em 60 000 ms.
 */
export function progressAt(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  if (ms >= INSTALL_DURATION_MS) return 100;
  for (const seg of INSTALL_SEGMENTS) {
    if (ms <= seg.endMs) {
      const u = (ms - seg.startMs) / (seg.endMs - seg.startMs);
      const raw = seg.startPct + (seg.endPct - seg.startPct) * u;
      return Math.min(99, Math.max(0, Math.floor(raw)));
    }
  }
  return 99;
}

export function remainingSecondsAt(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return INSTALL_DURATION_MS / 1000;
  if (ms >= INSTALL_DURATION_MS) return 0;
  return Math.max(0, Math.ceil((INSTALL_DURATION_MS - ms) / 1000));
}

/** Formata contagem regressiva em `m:ss` (ex.: "1:00", "0:42", "0:00"). */
export function formatInstallCountdown(ms: number): string {
  const rem = remainingSecondsAt(ms);
  const mins = Math.floor(rem / 60);
  const secs = String(rem % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

type SessionKV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const installProgressSessionKey = (appId: string) => `deliverychannel_pwa_install_start_${appId}`;

export function readPersistedInstallStart(storage: Partial<SessionKV> | null | undefined, appId: string): number | null {
  try {
    const raw = storage?.getItem?.(installProgressSessionKey(appId));
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  } catch {
    return null;
  }
}

/**
 * Persiste o instante inicial no `sessionStorage`. Se já houver um início salvo na sessão,
 * preserva-o para que re-renders ou remontagens não reiniciem a contagem de 60 s.
 */
export function persistInstallStart(
  storage: Partial<SessionKV> | null | undefined,
  appId: string,
  now = Date.now(),
): number {
  const existing = readPersistedInstallStart(storage, appId);
  if (existing != null) return existing;
  try {
    storage?.setItem?.(installProgressSessionKey(appId), String(now));
  } catch {
    /* navegador sem sessionStorage */
  }
  return now;
}

export function clearPersistedInstallStart(storage: Partial<SessionKV> | null | undefined, appId: string): void {
  try {
    storage?.removeItem?.(installProgressSessionKey(appId));
  } catch {
    /* navegador sem sessionStorage */
  }
}

export function prefersReducedMotion(
  win: { matchMedia?: (q: string) => { matches: boolean } } | undefined = typeof window !== 'undefined' ? window : undefined,
): boolean {
  try {
    return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

