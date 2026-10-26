import 'dotenv/config';
import { createPaymentStore } from '../payments/store';
async function main() {
  try {
    const store = createPaymentStore(process.env);
    if (!store) throw new Error();
    await store.rpc('expire_unpaid_online_orders', {});
    await store.rpc('purge_dispatch_data', {});
    console.info('[dispatch-retention] completed');
  } catch { console.error('[dispatch-retention] failed'); process.exitCode = 1; }
}
void main();
