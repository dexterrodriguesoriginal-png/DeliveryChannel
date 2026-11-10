import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { totemAccessRepository } from '../../repositories/totemAccessRepository';
import { formatBRL } from '../../lib/pricing/money';

type Pending = { orderId: string; total: number; createdAt: string; expiresAt: string; status: string };

/** Staff-authenticated PDV queue; the server checks the tenant and permissions again on approval. */
export function TotemPendingPayments({ tenantId }: { tenantId: string }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!tenantId || !isSupabaseConfigured) return;
    let alive = true;
    const load = () => {
      void totemAccessRepository.listPendingPayments(tenantId)
        .then(rows => { if (alive) setPending(rows); })
        .catch(() => { /* migration not yet installed; do not interrupt PDV */ });
    };
    load();
    const handle = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(handle); };
  }, [tenantId]);
  if (!isSupabaseConfigured) return null;
  return (
    <section data-testid="totem-pdv-payments" className="p-3 border rounded-xl space-y-2">
      <h3 className="font-bold text-sm">Aguardando pagamento no totem</h3>
      <p className="text-xs">Confirme somente depois da aprovação na maquininha ao lado do totem.</p>
      {pending.map(item => (
        <div key={item.orderId} className="flex items-center justify-between gap-2 p-2 border rounded-lg">
          <div className="text-xs">
            <strong>{formatBRL(item.total)}</strong>
            <p>Pedido #{item.orderId.slice(0, 8).toUpperCase()}</p>
          </div>
          <button type="button" disabled={busy !== null}
            className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold"
            onClick={() => {
              setBusy(item.orderId); setMessage('');
              void totemAccessRepository.confirmManualPayment(item.orderId)
                .then(() => {
                  setPending(list => list.filter(row => row.orderId !== item.orderId));
                  setMessage('Pagamento confirmado. A senha foi liberada.');
                })
                .catch(err => setMessage(err instanceof Error ? err.message : 'Falha ao confirmar.'))
                .finally(() => setBusy(null));
            }}>
            {busy === item.orderId ? 'Confirmando…' : 'Confirmar pagamento'}
          </button>
        </div>
      ))}
      {pending.length === 0 && <p className="text-xs">Nenhum pagamento pendente.</p>}
      {message && <p className="text-xs" role="status">{message}</p>}
    </section>
  );
}
