import { useCallback, useEffect, useState } from 'react';
import { playShortBeep, unlockAudio } from '../../utils/audio';

/**
 * 19/10: alarme de pedido novo. Bipe curto a cada ~5 s enquanto houver pedido em "Novo"
 * (aguardando aceite); para quando não sobrar nenhum. Respeita o bloqueio de autoplay:
 * só toca depois da primeira interação do usuário. Preferência salva no navegador.
 */
export const SOUND_PREF_KEY = 'dc_owner_new_order_sound';
export const BEEP_INTERVAL_MS = 5000;

export function readSoundPref(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try { return storage?.getItem(SOUND_PREF_KEY) !== '0'; } catch { return true; }
}

export function writeSoundPref(storage: Pick<Storage, 'setItem'> | null | undefined, on: boolean): void {
  try { storage?.setItem(SOUND_PREF_KEY, on ? '1' : '0'); } catch { /* sem storage */ }
}

export function shouldBeep(opts: { enabled: boolean; unlocked: boolean; pendingCount: number }): boolean {
  return opts.enabled && opts.unlocked && opts.pendingCount > 0;
}

const ls = (): Storage | null => (typeof window !== 'undefined' ? window.localStorage : null);

export interface NewOrderAlarm {
  enabled: boolean;
  unlocked: boolean;
  /** "Ativar som" / desligar. */
  toggle: () => void;
}

export function useNewOrderAlarm(pendingCount: number): NewOrderAlarm {
  const [enabled, setEnabled] = useState<boolean>(() => readSoundPref(ls()));
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (unlocked || typeof window === 'undefined') return;
    const onFirst = () => { unlockAudio(); setUnlocked(true); };
    window.addEventListener('pointerdown', onFirst, { once: true });
    window.addEventListener('keydown', onFirst, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onFirst);
      window.removeEventListener('keydown', onFirst);
    };
  }, [unlocked]);

  const active = shouldBeep({ enabled, unlocked, pendingCount });
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => playShortBeep(), BEEP_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [active]);

  const toggle = useCallback(() => {
    unlockAudio();
    setUnlocked(true);
    setEnabled(prev => {
      const next = !(prev && unlocked) ? true : false;
      writeSoundPref(ls(), next);
      if (next) playShortBeep();
      return next;
    });
  }, [unlocked]);

  return { enabled, unlocked, toggle };
}
