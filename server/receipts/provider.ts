import { ReceiptError, type ReceiptProvider, type TabReceipt } from './types';

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const html = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function receiptContent(receipt: TabReceipt) {
  const time = new Date(receipt.paid_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const lines = receipt.items.map(item => `${item.quantity} × ${item.name} — ${money(item.total_price)}`);
  const details = [receipt.store_name, `Mesa: ${receipt.table_label}`, ...lines,
    `Taxa de serviço: ${money(receipt.service_fee_cents / 100)}`, `Total: ${money(receipt.total_cents / 100)}`,
    `Forma: ${receipt.method}`, `Data/hora: ${time} (Brasília)`, `Cobrança: ${receipt.charge_id}`];
  return {
    subject: 'Pagamento confirmado — comprovante',
    text: ['Pagamento confirmado', ...details].join('\n'),
    html: `<main lang="pt-BR"><h1>Pagamento confirmado</h1>${details.map(line => `<p>${html(line)}</p>`).join('')}</main>`,
  };
}

export class ResendReceiptProvider implements ReceiptProvider {
  constructor(private readonly apiKey: string, private readonly from: string, private readonly fetcher: typeof fetch = fetch) {}
  async send(receipt: TabReceipt) {
    const content = receiptContent(receipt);
    try {
      const response = await this.fetcher('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}`, 'Idempotency-Key': `tab-receipt/${receipt.attempt_id}` },
        body: JSON.stringify({ from: this.from, to: [receipt.recipient_email], ...content }),
      });
      // Never parse, log or reflect provider response bodies: they may contain the address or credentials.
      if (!response.ok) throw new Error('provider');
    } catch {
      throw new ReceiptError('RECEIPT_PROVIDER_ERROR', 502, 'Não foi possível enviar o comprovante. Tente novamente em instantes.');
    }
  }
}

export function receiptProvider(env: NodeJS.ProcessEnv, fetcher?: typeof fetch): ReceiptProvider | null {
  // TODO(email-provider): configure the Resend key and a verified sender in server runtime secrets before enabling delivery.
  return env.RESEND_API_KEY?.trim() && env.RECEIPT_FROM?.trim()
    ? new ResendReceiptProvider(env.RESEND_API_KEY.trim(), env.RECEIPT_FROM.trim(), fetcher) : null;
}

/** Provider boundary keeps the receipt workflow independent of the transactional email adapter. */
export async function sendReceipt(provider: ReceiptProvider, receipt: TabReceipt) { await provider.send(receipt); }
