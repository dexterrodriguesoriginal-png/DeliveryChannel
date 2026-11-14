import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { subscribeThemeUpdates, THEME_PING_MIN_MS, THEME_POLL_MS } from './themeLiveUpdate';
import { subscribeThemeRefresh } from './silentThemeRefresh';

const channels = new Map<string, { listeners: Set<() => void>; stop: () => void }>();
function subscribeChannel(tenantId: string, listener: () => void): () => void {
  let entry = channels.get(tenantId);
  if (!entry) {
    const listeners = new Set<() => void>();
    entry = { listeners, stop: subscribeThemeUpdates(supabase as unknown as Parameters<typeof subscribeThemeUpdates>[0], tenantId, () => listeners.forEach(fn => fn())) };
    channels.set(tenantId, entry);
  }
  const current = entry;
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) { current.stop(); channels.delete(tenantId); }
  };
}

/** Refresh visual tokens without resetting an open table, cart or payment. */
export function useChannelThemeRefresh<T>(scope: string, tenantId: string, load: () => Promise<T | null>, apply: (value: T) => void): void {
  const callbacks = useRef({ load, apply });
  callbacks.current = { load, apply };
  useEffect(() => {
    if (!scope || !tenantId) return;
    let active = true, busy = false, lastAt = Date.now();
    const refresh = async () => {
      if (!active || busy || document.visibilityState === 'hidden' || Date.now() - lastAt < THEME_PING_MIN_MS) return;
      lastAt = Date.now(); busy = true;
      try {
        const value = await callbacks.current.load();
        if (active && value !== null) callbacks.current.apply(value);
      } catch { /* Keep the last confirmed appearance during connection failures. */ }
      finally { busy = false; }
    };
    const unsubscribe = subscribeChannel(tenantId, () => void refresh());
    const unfocus = subscribeThemeRefresh(window, document, () => void refresh());
    const timer = window.setInterval(() => void refresh(), THEME_POLL_MS);
    return () => { active = false; unsubscribe(); unfocus(); window.clearInterval(timer); };
  }, [scope, tenantId]);
}
