import React from 'react';
import { useIdleTimer } from '../../../hooks/useIdleTimer';

export interface TotemKioskLayerProps {
  enabled: boolean;
  idleSeconds: number;
  /** Ao expirar o aviso de inatividade, limpa a sessão do quiosque. */
  onIdle(): void;
}

/** Cardápio ocupa toda a viewport via CSS; sem botão de ampliar.
 * O fullscreen nativo do navegador exige gesto/gestão do dispositivo e não é disparado automaticamente.
 * Mantém a proteção de inatividade para equipamentos compartilhados.
 */
export function TotemKioskLayer({ enabled, idleSeconds, onIdle }: TotemKioskLayerProps) {
  const { isWarning, secondsRemaining, resetTimer } = useIdleTimer({
    enabled, idleTimeoutSeconds: idleSeconds, onTimeout: onIdle,
  });
  if (!enabled || !isWarning) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="totem-idle-title"
        data-testid="totem-idle-warning"
        className="w-full max-w-sm rounded-3xl bg-white p-6 text-center text-slate-900 shadow-2xl">
        <h2 id="totem-idle-title" className="text-2xl font-black">Ainda está aí?</h2>
        <p className="mt-2 text-sm text-slate-600" role="status">
          Sua sacola será limpa em <strong data-testid="totem-idle-seconds">{secondsRemaining}</strong> s.
        </p>
        <button type="button" autoFocus onClick={resetTimer}
          className="mt-5 w-full rounded-2xl bg-emerald-700 px-4 py-4 text-base font-black text-white">
          Continuar pedindo
        </button>
      </section>
    </div>
  );
}
