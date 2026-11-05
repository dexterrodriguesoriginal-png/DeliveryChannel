import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));
import { SALON_STATS_ERROR, salonNightStatsRepository } from '../salonNightStatsRepository';

const aggregate = () => ({
  window_start: '2026-11-04T15:00:00Z', window_end: '2026-11-04T23:00:00Z',
  window_source: 'OPENED_TODAY', timezone: 'America/Sao_Paulo',
  orders_count: 12, tables_served: 8, revenue_cents: 20000, paid_visits: 8,
  average_ticket_cents: 2500, average_stay_seconds: 3600, calls_handled: 4,
  average_response_seconds: 45, open_tabs: 3,
});
beforeEach(() => { rpc.mockReset(); });

describe('estatísticas agregadas do salão', () => {
  it('consulta uma única RPC pela loja e descarta quaisquer campos de identidade', async () => {
    rpc.mockResolvedValue({ data: { ...aggregate(), customer_email: 'private@example.test', user_id: 'private' }, error: null });
    expect(await salonNightStatsRepository.load('store-a')).toEqual(aggregate());
    expect(rpc).toHaveBeenCalledExactlyOnceWith('salon_night_stats', { p_tenant: 'store-a' });
  });

  it('preserva médias ausentes como NULL e contagens zero', async () => {
    const data = { ...aggregate(), window_source: 'LAST_12_HOURS', orders_count: 0, tables_served: 0,
      revenue_cents: 0, paid_visits: 0, average_ticket_cents: null, average_stay_seconds: null,
      calls_handled: 0, average_response_seconds: null, open_tabs: 0 };
    rpc.mockResolvedValue({ data, error: null });
    expect(await salonNightStatsRepository.load('empty-store')).toEqual(data);
  });

  it('não converte resposta financeira inválida em zeros plausíveis', async () => {
    for (const patch of [{ revenue_cents: '20000' }, { open_tabs: -1 }, { average_stay_seconds: NaN },
      { window_start: 'invalid' }, { window_end: '2026-11-03T23:00:00Z' }, { window_source: 'OTHER' }]) {
      rpc.mockResolvedValue({ data: { ...aggregate(), ...patch }, error: null });
      await expect(salonNightStatsRepository.load('store-a')).rejects.toThrow(SALON_STATS_ERROR);
    }
  });

  it('recusa erro de outra loja sem divulgar texto bruto do banco', async () => {
    rpc.mockResolvedValue({ data: aggregate(), error: { message: 'private-other-tenant@example.test' } });
    await expect(salonNightStatsRepository.load('store-b')).rejects.toThrow(SALON_STATS_ERROR);
    rpc.mockRejectedValue(new Error('private network payload'));
    await expect(salonNightStatsRepository.load('store-b')).rejects.toThrow(SALON_STATS_ERROR);
  });
});

