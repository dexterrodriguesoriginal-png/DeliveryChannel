import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { salonStaffRepository, type PendingApproval } from '../repositories/salonStaffRepository';
import { playNewOrderSound, playShortBeep, unlockAudio } from '../utils/audio';

export const APPROVALS_POLL_MS = 5000;
export const APPROVALS_REMIND_MS = 30000;

/** Ids that appeared since the previous poll (pure; the first poll never counts as "new"). */
export function newApprovalIds(previous: ReadonlySet<string> | null, current: readonly PendingApproval[]): string[] {
  if (!previous) return [];
  return current.filter(item => !previous.has(item.sessionId)).map(item => item.sessionId);
}

/**
 * Sessions waiting for a waiter to release the table. Subscribes to Supabase Realtime + polls while visible,
 * beeps when a NEW one shows up and reminds every 30 s while some are still waiting.
 */
export function usePendingApprovals(tenantId: string | undefined, enabled: boolean, opts: { sound?: boolean } = {}) {
  const sound = opts.sound !== false;
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const seen = useRef<Set<string> | null>(null);
  const lastBeep = useRef(0);

  const refresh = useCallback(async () => {
    if (!tenantId || !enabled) return;
    try {
      const list = await salonStaffRepository.pendingApprovals(tenantId);
      const fresh = newApprovalIds(seen.current, list);
      const now = Date.now();
      if (sound && list.length) {
        if (fresh.length) { (playNewOrderSound ?? playShortBeep)?.(); lastBeep.current = now; }
        else if (seen.current !== null && now - lastBeep.current >= APPROVALS_REMIND_MS) { (playShortBeep ?? playNewOrderSound)?.(); lastBeep.current = now; }
      }
      seen.current = new Set(list.map(item => item.sessionId));
      setPending(list);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível verificar as liberações.');
    }
  }, [tenantId, enabled, sound]);

  useEffect(() => {
    seen.current = null; setPending([]);
    if (!tenantId || !enabled) return;
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, APPROVALS_POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    const channel = typeof supabase?.channel === 'function'
      ? supabase
          .channel(`salon-approvals:${tenantId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tab_sessions', filter: `tenant_id=eq.${tenantId}` }, () => { void refresh(); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tabs', filter: `tenant_id=eq.${tenantId}` }, () => { void refresh(); })
          .subscribe()
      : null;
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('pointerdown', unlock);
      if (channel && typeof supabase?.removeChannel === 'function') void supabase.removeChannel(channel);
    };
  }, [tenantId, enabled, refresh]);

  const act = useCallback(async (sessionId: string, kind: 'approve' | 'reject') => {
    setBusyId(sessionId); setError('');
    try {
      if (kind === 'approve') await salonStaffRepository.approve(sessionId); else await salonStaffRepository.reject(sessionId);
      setPending(list => list.filter(item => item.sessionId !== sessionId));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally { setBusyId(null); }
  }, [refresh]);

  return { pending, busyId, error, refresh, approve: (id: string) => act(id, 'approve'), reject: (id: string) => act(id, 'reject') };
}
