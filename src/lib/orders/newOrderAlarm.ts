import { readPreferences, savePreferences } from '../notifications/preferences';
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

export function useNewOrderAlarm(pendingCount: number, scope?: { tenant: string; user: string }): NewOrderAlarm {
  const scoped = Boolean(scope?.tenant && scope?.user);
  const read = () => scoped && ls() ? readPreferences(ls()!, scope!.tenant, scope!.user).sound : readSoundPref(ls());
  const [enabled, setEnabled] = useState<boolean>(read);
  useEffect(() => {
    const refresh = () => setEnabled(read()); refresh();
    window.addEventListener('dc:notification-preferences', refresh);
    return () => window.removeEventListener('dc:notification-preferences', refresh);
  }, [scope?.tenant, scope?.user]);
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
    const next = !(enabled && unlocked);
    setEnabled(next);
    if (scoped && ls()) savePreferences(ls()!,scope!.tenant,scope!.user,{ ...readPreferences(ls()!,scope!.tenant,scope!.user),sound: next });
    else writeSoundPref(ls(), next);
    if (next) playShortBeep();
  }, [enabled, unlocked, scope?.tenant, scope?.user]);

  return { enabled, unlocked, toggle };
}
