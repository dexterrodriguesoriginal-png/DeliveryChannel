import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { SalonNightStats } from '../lib/salon/nightStats';
import { SALON_STATS_ERROR, salonNightStatsRepository } from '../repositories/salonNightStatsRepository';

export const SALON_STATS_POLL_MS = 30_000;
type Snapshot = { tenantId: string; stats: SalonNightStats | null; loading: boolean; error: string };

export function useSalonNightStats(tenantId: string | undefined, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    refreshRef.current = () => undefined;
    if (!tenantId || !enabled) { setSnapshot(null); return; }
    let active = true;
    let request = 0;
    const load = async () => {
      const sequence = ++request;
      try {
        const stats = await salonNightStatsRepository.load(tenantId);
        if (active && sequence === request) setSnapshot({ tenantId, stats, loading: false, error: '' });
      } catch {
        if (active && sequence === request) setSnapshot({ tenantId, stats: null, loading: false, error: SALON_STATS_ERROR });
      }
    };
    refreshRef.current = () => { void load(); };
    setSnapshot({ tenantId, stats: null, loading: true, error: '' });
    void load();
    const visibleRefresh = () => { if (document.visibilityState !== 'hidden') void load(); };
    const timer = window.setInterval(visibleRefresh, SALON_STATS_POLL_MS);
    document.addEventListener('visibilitychange', visibleRefresh);
    window.addEventListener('focus', visibleRefresh);
    window.addEventListener('online', visibleRefresh);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      if (typeof supabase?.channel === 'function') {
        channel = supabase.channel(`salon-night-stats:${tenantId}`);
        for (const table of ['orders', 'dining_tabs', 'tab_payments', 'waiter_calls', 'tenant_settings']) {
          channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `tenant_id=eq.${tenantId}` }, visibleRefresh);
        }
        channel.subscribe();
      }
    } catch { /* Polling remains available when realtime cannot subscribe. */ }
    return () => {
      active = false;
      refreshRef.current = () => undefined;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibleRefresh);
      window.removeEventListener('focus', visibleRefresh);
      window.removeEventListener('online', visibleRefresh);
      if (channel && typeof supabase?.removeChannel === 'function') void supabase.removeChannel(channel);
    };
  }, [tenantId, enabled]);

  // Tagging also hides the previous store during the render before effect cleanup.
  const current = enabled && tenantId && snapshot?.tenantId === tenantId ? snapshot : null;
  return { stats: current?.stats ?? null, loading: !!enabled && !!tenantId && (current?.loading ?? true), error: current?.error ?? '', refresh };
}
