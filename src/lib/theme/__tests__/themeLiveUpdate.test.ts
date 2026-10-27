import { describe, it, expect, vi } from 'vitest';
import {
  announceThemeUpdated, subscribeThemeUpdates, themeChannelName, shouldRefetchTheme,
  THEME_PING_EVENT, THEME_PING_MIN_MS, THEME_POLL_MS,
} from '../themeLiveUpdate';
import { THEME_REFRESH_MIN_MS, shouldRefreshTheme } from '../silentThemeRefresh';

function fakeClient() {
  const handlers: Array<(p: unknown) => void> = [];
  const sent: unknown[] = [];
  const channel = vi.fn((name: string) => {
    const ch: any = {
      name,
      on: (_t: string, filter: any, cb: (p: unknown) => void) => { expect(filter.event).toBe(THEME_PING_EVENT); handlers.push(cb); return ch; },
      subscribe: (cb?: (s: string) => void) => { cb?.('SUBSCRIBED'); return ch; },
      send: async (m: unknown) => { sent.push(m); },
    };
    return ch;
  });
  return { client: { channel, removeChannel: vi.fn() } as any, handlers, sent, channel };
}

describe('atualização rápida do app do cliente', () => {
  it('canal por loja e aviso sem dados (só um ping)', async () => {
    const f = fakeClient();
    await announceThemeUpdated(f.client, 'tenant-1');
    expect(f.channel).toHaveBeenCalledWith(themeChannelName('tenant-1'));
    expect(f.sent).toHaveLength(1);
    const msg = f.sent[0] as any;
    expect(msg.type).toBe('broadcast');
    expect(msg.event).toBe(THEME_PING_EVENT);
    expect(Object.keys(msg.payload)).toEqual(['at']);
  });
  it('o app inscrito recebe o aviso e cancela a inscrição ao sair', () => {
    const f = fakeClient();
    const onPing = vi.fn();
    const stop = subscribeThemeUpdates(f.client, 'tenant-1', onPing);
    f.handlers[0]({});
    expect(onPing).toHaveBeenCalledTimes(1);
    stop();
    expect(f.client.removeChannel).toHaveBeenCalled();
  });
  it('falha do Realtime nunca quebra o salvar nem o app', async () => {
    const boom: any = { channel: () => { throw new Error('offline'); }, removeChannel: vi.fn() };
    await expect(announceThemeUpdated(boom, 't')).resolves.toBeUndefined();
    expect(() => subscribeThemeUpdates(boom, 't', () => {})()).not.toThrow();
  });
  it('limita releituras (aviso falso não vira flood) e volta ao app atualiza em > 5 s', () => {
    expect(shouldRefetchTheme(1000, 1000 + THEME_PING_MIN_MS - 1, THEME_PING_MIN_MS)).toBe(false);
    expect(shouldRefetchTheme(1000, 1000 + THEME_PING_MIN_MS, THEME_PING_MIN_MS)).toBe(true);
    expect(THEME_REFRESH_MIN_MS).toBeLessThanOrEqual(5000);
    expect(shouldRefreshTheme(0, 6000, true)).toBe(true);
    expect(shouldRefreshTheme(0, 6000, false)).toBe(false);
    expect(THEME_POLL_MS).toBeLessThanOrEqual(30_000);
  });
});
