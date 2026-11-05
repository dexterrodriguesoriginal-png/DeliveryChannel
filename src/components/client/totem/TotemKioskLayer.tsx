import React, { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useIdleTimer } from '../../../hooks/useIdleTimer';
import { isFullscreenActive, isFullscreenSupported, toggleFullscreen } from '../../../lib/menu/fullscreen';

export interface TotemKioskLayerProps {
  enabled: boolean;
  idleSeconds: number;
  /** Chamado após o aviso de 10 s sem resposta: limpar sacola e voltar ao início. */
  onIdle(): void;
}

/** Botão de tela cheia + aviso "Ainda está aí?" do modo totem. Não conhece sacola nem navegação. */
export function TotemKioskLayer({ enabled, idleSeconds, onIdle }: TotemKioskLayerProps) {
  const { isWarning, secondsRemaining, resetTimer } = useIdleTimer({ enabled, idleTimeoutSeconds: idleSeconds, onTimeout: onIdle });
  const [fullscreen, setFullscreen] = useState(() => isFullscreenActive());
  const supported = isFullscreenSupported();

  useEffect(() => {
    const sync = () => setFullscreen(isFullscreenActive());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  if (!enabled) return null;
  return <>
    {supported && <button type="button" data-testid="totem-fullscreen-button" onClick={() => void toggleFullscreen()}
      aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} aria-pressed={fullscreen}
      className="fixed left-3 top-3 z-40 grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur active:scale-95">
      {fullscreen ? <Minimize2 aria-hidden="true" className="h-5 w-5" /> : <Maximize2 aria-hidden="true" className="h-5 w-5" />}
    </button>}
    {isWarning && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="totem-idle-title" data-testid="totem-idle-warning"
        className="w-full max-w-sm rounded-3xl bg-white p-6 text-center text-slate-900 shadow-2xl">
        <h2 id="totem-idle-title" className="text-2xl font-black">Ainda está aí?</h2>
        <p className="mt-2 text-sm text-slate-600" role="status">Sua sacola será limpa em <strong data-testid="totem-idle-seconds">{secondsRemaining}</strong> s.</p>
        <button type="button" autoFocus onClick={resetTimer} className="mt-5 w-full rounded-2xl bg-emerald-700 px-4 py-4 text-base font-black text-white active:scale-95">Continuar pedindo</button>
      </section>
    </div>}
  </>;
}
