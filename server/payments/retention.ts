import { createPaymentStore, PaymentStore } from './store';
import { paymentLog } from './privacy';

/** Bounded, restart-safe, multi-replica-safe batches. The SQL clock defines the five-year cutoff. */
export async function runPaymentRetention(store: Pick<PaymentStore,'rpc'>): Promise<number> {
  let total = 0;
  for (let batch=0; batch<10; batch++) {
    const count = await store.rpc<number>('anonymize_expired_payments',{ p_limit:500 });
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid retention result');
    total += count; if (count < 500) break;
  }
  return total;
}
export function startPaymentRetention(env = process.env, store = createPaymentStore(env)) {
  if (!store) return () => {};
  let running = false; let stopped = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    try { paymentLog('retention_completed',await runPaymentRetention(store)); }
    catch { paymentLog('retention_failed'); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => { void run(); },24*60*60_000); timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
