import { useEffect } from 'react';
import { isFullscreenActive, isFullscreenSupported, requestFullscreen } from '../lib/menu/fullscreen';

/**
 * Pede tela cheia no primeiro gesto do usuário (toque, clique ou tecla) e
 * volta a pedir no próximo gesto se a tela cheia for encerrada.
 * Sem botão. Navegadores que recusam (iOS Safari) seguem em tela cheia via CSS.
 */
export function useAutoFullscreen(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !isFullscreenSupported()) return;

    const onGesture = () => {
      if (!isFullscreenActive()) void requestFullscreen();
    };

    const opts: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener('pointerdown', onGesture, opts);
    window.addEventListener('touchstart', onGesture, opts);
    window.addEventListener('keydown', onGesture, opts);
    return () => {
      window.removeEventListener('pointerdown', onGesture, opts);
      window.removeEventListener('touchstart', onGesture, opts);
      window.removeEventListener('keydown', onGesture, opts);
    };
  }, [enabled]);
}
