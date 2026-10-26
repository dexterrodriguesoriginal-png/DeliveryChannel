import { createPaymentStore } from '../payments/store';
type RetentionStore = { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> };
/** Existing service job: expire unpaid orders every five minutes, retain dispatch data daily. */
export function startDispatchRetention(env = process.env, store: RetentionStore | null = createPaymentStore(env)) {
  if (!store) return () => {};
  let running = false; let stopped = false; let nextRetention = 0;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await store.rpc('expire_unpaid_online_orders', {});
      if (Date.now() >= nextRetention) {
        await store.rpc('purge_dispatch_data', {});
        nextRetention = Date.now() + 24 * 60 * 60_000;
      }
      console.info('[dispatch-retention] completed');
    } catch { console.error('[dispatch-retention] failed'); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => { void run(); }, 5 * 60_000); timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
// resync
