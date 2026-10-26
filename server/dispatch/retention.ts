import { createPaymentStore } from '../payments/store';
type RetentionStore = { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> };
/** Fallback para instalações sem pg_cron. Não altera a rotina de retenção existente. */
export function startDriverOfferExpiry(store: RetentionStore | null = createPaymentStore(process.env)) {
  if (!store) return () => {};
  let running = false, stopped = false;
  const expire = async () => {
    if (running || stopped) return;
    running = true;
    try { await store.rpc('expire_driver_offers', {}); }
    catch { console.error('[driver-offers] Falha ao expirar chamadas.'); }
    finally { running = false; }
  };
  void expire();
  const timer = setInterval(() => { void expire(); }, 30000); timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
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
