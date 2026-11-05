import { supabase } from '../lib/supabase';
import { parseSalonNightStats, type SalonNightStats } from '../lib/salon/nightStats';

export const SALON_STATS_ERROR = 'Não foi possível carregar as estatísticas do salão.';

export const salonNightStatsRepository = {
  async load(tenantId: string): Promise<SalonNightStats> {
    try {
      const { data, error } = await supabase.rpc('salon_night_stats', { p_tenant: tenantId });
      const stats = !error ? parseSalonNightStats(data) : null;
      if (stats) return stats;
    } catch { /* Fail closed with a public message; raw database errors may contain data. */ }
    throw new Error(SALON_STATS_ERROR);
  },
};

