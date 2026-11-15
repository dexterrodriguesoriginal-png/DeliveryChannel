// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ ping: () => {}, stop: vi.fn(), subscribe: vi.fn() }));
vi.mock('../../supabase', () => ({ supabase: {} }));
vi.mock('../themeLiveUpdate', () => ({
  THEME_PING_MIN_MS: 3000, THEME_POLL_MS: 30000,
  subscribeThemeUpdates: (...args: unknown[]) => { h.subscribe(...args); h.ping = args[2] as () => void; return h.stop; },
}));
import { useChannelThemeRefresh } from '../useChannelThemeRefresh';
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
it('shares one channel, updates on broadcast/poll and keeps last data on failure', async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockResolvedValue('published');
  const apply = vi.fn();
  const a = renderHook(() => useChannelThemeRefresh('scope','tenant',load,apply));
  const b = renderHook(() => useChannelThemeRefresh('scope','tenant',load,apply));
  expect(h.subscribe).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(3000); h.ping(); });
  expect(apply).toHaveBeenCalledWith('published');
  load.mockRejectedValue(new Error('offline')); apply.mockClear();
  await act(async () => { vi.advanceTimersByTime(30000); });
  expect(apply).not.toHaveBeenCalled();
  a.unmount(); expect(h.stop).not.toHaveBeenCalled();
  b.unmount(); expect(h.stop).toHaveBeenCalledOnce();
});
it('ignores late responses after switching store or device', async () => {
  vi.useFakeTimers();
  let resolve!: (value: string) => void;
  const pending = new Promise<string>(done => { resolve = done; });
  const apply = vi.fn();
  const view = renderHook(({scope}) => useChannelThemeRefresh(scope,'tenant',() => pending,apply),{initialProps:{scope:'old'}});
  await act(async () => { vi.advanceTimersByTime(3000); h.ping(); });
  view.rerender({scope:'new'});
  await act(async () => { resolve('old appearance'); });
  expect(apply).not.toHaveBeenCalled();
});
