import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../payments/store', () => ({ createPaymentStore: () => null }));
import { startDispatchRetention } from '../retention';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('dispatch retention scheduler', () => {
  it('runs immediately, skips overlap, runs daily and stops on server close', async () => {
    vi.useFakeTimers(); vi.spyOn(console,'info').mockImplementation(() => {});
    let finish!: (v: unknown) => void;
    const rpc = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const stop = startDispatchRetention({}, { rpc });
    expect(rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24*60*60_000); expect(rpc).toHaveBeenCalledTimes(1);
    finish(undefined); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(24*60*60_000); expect(rpc).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(24*60*60_000); expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('logs no backend error details and retries on the next day', async () => {
    vi.useFakeTimers(); const log = vi.spyOn(console,'error').mockImplementation(() => {});
    const rpc = vi.fn().mockRejectedValue(new Error('private token and message'));
    const stop = startDispatchRetention({}, { rpc }); await Promise.resolve();
    expect(log).toHaveBeenCalledWith('[dispatch-retention] failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    await vi.advanceTimersByTimeAsync(24*60*60_000); expect(rpc).toHaveBeenCalledTimes(2); stop();
  });
});
