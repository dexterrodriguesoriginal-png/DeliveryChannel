import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../payments/store', () => ({ createPaymentStore: () => null }));
import { startDispatchRetention, startDriverOfferExpiry } from '../retention';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('dispatch maintenance scheduler', () => {
  it('expires every five minutes, retains daily, skips overlap and stops on close', async () => {
    vi.useFakeTimers(); vi.spyOn(console,'info').mockImplementation(() => {});
    let finish!: (v: unknown) => void;
    const rpc = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const stop = startDispatchRetention({}, { rpc });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('expire_unpaid_online_orders', {});
    await vi.advanceTimersByTimeAsync(5*60_000); expect(rpc).toHaveBeenCalledTimes(1);
    finish(undefined); await vi.advanceTimersByTimeAsync(0);
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['expire_unpaid_online_orders','purge_dispatch_data']);
    await vi.advanceTimersByTimeAsync(5*60_000);
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['expire_unpaid_online_orders','purge_dispatch_data','expire_unpaid_online_orders']);
    await vi.advanceTimersByTimeAsync(24*60*60_000);
    expect(rpc.mock.calls.filter(c => c[0]==='purge_dispatch_data')).toHaveLength(2);
    const count = rpc.mock.calls.length; stop();
    await vi.advanceTimersByTimeAsync(24*60*60_000); expect(rpc).toHaveBeenCalledTimes(count);
  });
  it('does not log backend details and retries at the next five-minute tick', async () => {
    vi.useFakeTimers(); const log = vi.spyOn(console,'error').mockImplementation(() => {});
    const rpc = vi.fn().mockRejectedValue(new Error('private token and message'));
    const stop = startDispatchRetention({}, { rpc }); await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledWith('[dispatch-retention] failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    await vi.advanceTimersByTimeAsync(5*60_000); expect(rpc).toHaveBeenCalledTimes(2); stop();
  });
});

describe('expiração de ofertas sem pg_cron', () => {
  it('executa a cada 30 segundos, evita sobreposição e para no encerramento', async () => {
    vi.useFakeTimers();
    let finish!: (v: unknown) => void;
    const rpc = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const stop = startDriverOfferExpiry({ rpc });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('expire_driver_offers', {});
    await vi.advanceTimersByTimeAsync(60000); expect(rpc).toHaveBeenCalledTimes(1);
    finish(undefined); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30000); expect(rpc).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(60000); expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('sem credenciais configuradas não agenda requisições', () => {
    vi.useFakeTimers(); const before = vi.getTimerCount();
    startDriverOfferExpiry(null)(); expect(vi.getTimerCount()).toBe(before);
  });
});
