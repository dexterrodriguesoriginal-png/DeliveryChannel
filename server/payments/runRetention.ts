import 'dotenv/config';
import { createPaymentStore } from './store';
import { runPaymentRetention } from './retention';
import { paymentLog } from './privacy';

// Entrypoint for a daily platform scheduler, including deployments that scale the web server to zero.
async function main() {
  try {
    const store = createPaymentStore(process.env);
    if (!store) throw new Error('Payments unavailable');
    paymentLog('retention_completed',await runPaymentRetention(store));
  } catch { paymentLog('retention_failed'); process.exitCode=1; }
}
void main();
