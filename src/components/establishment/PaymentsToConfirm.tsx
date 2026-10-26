import React, { useEffect, useState } from 'react';
import { paymentRepository, PaymentToConfirm } from '../../repositories/paymentRepository';

export function PaymentConfirmationList({ rows, busy, onConfirm }: { rows: PaymentToConfirm[]; busy: boolean; onConfirm: (number: number) => void }) {
  return <section aria-label="Pagamentos para conferir" className="rounded-2xl border bg-white p-5 space-y-3">
    <h3 className="font-bold">Pagamentos para conferir</h3>
    <p className="text-sm text-gray-600">PIX manual e InfinitePay. Confira o recebimento na sua conta antes de confirmar.</p>
    {!rows.length && <p className="text-sm">Nenhum pagamento para conferir.</p>}
    {rows.map(row => <article key={row.order_number} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
      <div className="text-sm"><p className="font-semibold">Pedido #{row.order_number} · {row.customer_first_name}</p>
        <p>{Number(row.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · {row.method === 'PIX' ? 'PIX' : 'Cartão'}</p>
        <p className="text-gray-500">{new Date(row.created_at).toLocaleString('pt-BR')}</p></div>
      <button disabled={busy} className="rounded-lg bg-emerald-700 text-white px-3 py-2 text-sm disabled:opacity-50" onClick={() => onConfirm(row.order_number)}>Confirmar recebimento</button>
    </article>)}
  </section>;
}
export function PaymentsToConfirm({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<PaymentToConfirm[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const data = await paymentRepository.toConfirm(tenantId); if (alive) { setRows(data); setError(''); } }
      catch (e) { if (alive) setError(e instanceof Error ? e.message : 'Não foi possível carregar.'); }
    };
    void load(); const timer = window.setInterval(load, 15000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [tenantId, revision]);
  const confirm = async (number: number) => {
    setBusy(true); setError('');
    try { await paymentRepository.confirmPending(tenantId, number); setRows(rs => rs.filter(r => r.order_number !== number)); setRevision(v => v+1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível confirmar.'); }
    finally { setBusy(false); }
  };
  return <div>{error && <p role="alert" className="text-sm text-rose-700">{error}</p>}<PaymentConfirmationList rows={rows} busy={busy} onConfirm={number => { void confirm(number); }} /></div>;
}
