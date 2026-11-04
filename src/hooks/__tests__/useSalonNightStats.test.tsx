// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalonNightStats } from '../../lib/salon/nightStats';

const mocks = vi.hoisted(() => ({ load: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() }));
vi.mock('../../repositories/salonNightStatsRepository', () => ({
  SALON_STATS_ERROR: 'Não foi possível carregar as estatísticas do salão.',
  salonNightStatsRepository: { load: mocks.load },
}));
vi.mock('../../lib/supabase', () => ({ supabase: { channel: mocks.channel, removeChannel: mocks.removeChannel } }));
import { useSalonNightStats } from '../useSalonNightStats';

const stats = (orders: number): SalonNightStats => ({
  window_start: '2026-11-04T15:00:00Z', window_end: '2026-11-04T23:00:00Z',
  window_source: 'OPENED_TODAY', timezone: 'America/Sao_Paulo', orders_count: orders,
  tables_served: 0, revenue_cents: 0, paid_visits: 0, average_ticket_cents: null,
  average_stay_seconds: null, calls_handled: 0, average_response_seconds: null, open_tabs: 0,
});
const deferred = () => {
  let resolve!: (value: SalonNightStats) => void;
  const promise = new Promise<SalonNightStats>(r => { resolve = r; });
  return { promise, resolve };
};
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue(stats(1)); mocks.channel.mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }); });
afterEach(cleanup);

describe('estatísticas por loja no salão', () => {
  it('esconde a loja anterior e ignora resposta atrasada após a troca', async () => {
    const old = deferred(); const next = deferred();
    mocks.load.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ tenant }) => useSalonNightStats(tenant, true), { initialProps: { tenant: 'a' } });
    rerender({ tenant: 'b' });
    expect(result.current.stats).toBeNull();
    await act(async () => next.resolve(stats(20)));
    expect(result.current.stats?.orders_count).toBe(20);
    await act(async () => old.resolve(stats(99)));
    expect(result.current.stats?.orders_count).toBe(20);
    expect(mocks.load.mock.calls.map(call => call[0])).toEqual(['a', 'b']);
  });

  it('limpa dados quando acesso é desativado e não busca sem loja', async () => {
    const { result, rerender } = renderHook(({ tenant, enabled }) => useSalonNightStats(tenant, enabled), { initialProps: { tenant: 'a' as string | undefined, enabled: true } });
    await waitFor(() => expect(result.current.stats?.orders_count).toBe(1));
    rerender({ tenant: 'a', enabled: false });
    expect(result.current.stats).toBeNull();
    expect(result.current.loading).toBe(false);
    rerender({ tenant: undefined, enabled: true });
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('mantém apenas a resposta mais recente para atualizações simultâneas', async () => {
    const old = deferred(); const next = deferred();
    mocks.load.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => useSalonNightStats('a', true));
    act(() => result.current.refresh());
    await act(async () => next.resolve(stats(2)));
    await act(async () => old.resolve(stats(1)));
    expect(result.current.stats?.orders_count).toBe(2);
  });

  it('falha sem valores fictícios e permite tentar novamente', async () => {
    mocks.load.mockRejectedValueOnce(new Error('private payload'));
    const { result } = renderHook(() => useSalonNightStats('a', true));
    await waitFor(() => expect(result.current.error).toBe('Não foi possível carregar as estatísticas do salão.'));
    expect(result.current.stats).toBeNull();
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.stats?.orders_count).toBe(1));
    expect(result.current.error).toBe('');
  });

  it('atualiza recebimentos e abertura pelo canal da loja e remove a inscrição ao sair', async () => {
    const { result, unmount } = renderHook(() => useSalonNightStats('a', true));
    await waitFor(() => expect(result.current.stats?.orders_count).toBe(1));
    const channel = mocks.channel.mock.results[0].value;
    expect(channel.on.mock.calls.map((call: unknown[]) => call[1])).toEqual(
      ['orders', 'dining_tabs', 'tab_payments', 'waiter_calls', 'tenant_settings'].map(table => ({ event: '*', schema: 'public', table, filter: 'tenant_id=eq.a' })),
    );
    mocks.load.mockResolvedValueOnce(stats(3));
    act(() => channel.on.mock.calls[2][2]());
    await waitFor(() => expect(result.current.stats?.orders_count).toBe(3));
    unmount();
    expect(mocks.removeChannel).toHaveBeenCalledWith(channel);
  });
});
