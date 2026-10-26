import { createPaymentStore } from '../payments/store';
type RetentionStore = { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> };
/** Only the existing server-side service client is used; no credentials or message bodies in logs. */
export function startDispatchRetention(env = process.env, store: RetentionStore | null = createPaymentStore(env)) {
  if (!store) return () => {};
  let running = false; let stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try { await store.rpc('purge_dispatch_data', {}); console.info('[dispatch-retention] completed'); }
    catch { console.error('[dispatch-retention] failed'); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => { void run(); }, 24 * 60 * 60_000); timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
