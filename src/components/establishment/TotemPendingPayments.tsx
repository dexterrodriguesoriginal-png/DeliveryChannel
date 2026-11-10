import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../../lib/supabase';
import { totemAccessRepository } from '../../repositories/totemAccessRepository';
import { formatBRL } from '../../lib/pricing/money';
import { useAuth } from '../../context/AuthContext';
import { themeToTokens } from '../../lib/theme/themeEngine';

type Pending = { orderId: string; total: number; createdAt: string; expiresAt: string; status: string; autoPrintStore: boolean };

/** Staff-authenticated PDV queue; the server checks the tenant and permissions again on approval. */
export function TotemPendingPayments({ tenantId }: { tenantId: string }) {
  const { activeTenant } = useAuth();
  const palette = themeToTokens(activeTenant?.id === tenantId ? activeTenant.theme : null).palette;
  const confirmStyle = { backgroundColor: palette.buttonBg, color: palette.buttonText };
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<{ orderId: string; total: number; code: string } | null>(null);
  useEffect(() => {
    if (!receipt) return;
    const clearReceipt = () => setReceipt(null);
    window.addEventListener('afterprint', clearReceipt);
    try { window.print(); } catch { setMessage('O navegador bloqueou a impressão automática.'); setReceipt(null); }
    return () => window.removeEventListener('afterprint', clearReceipt);
  }, [receipt]);
  useEffect(() => {
    setPending([]); setReceipt(null); setMessage('');
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
      {receipt && <style>{`@media print {
        body * { visibility: hidden !important; }
        #totem-store-receipt, #totem-store-receipt * { visibility: visible !important; }
        #totem-store-receipt { display: block !important; position: fixed; top: 0; left: 0; width: 76mm; padding: 4mm; font-family: monospace; color: black; background: white; }
      }`}</style>}
      {receipt && <div id="totem-store-receipt" style={{ display: 'none' }}>
        <strong>RETIRADA NO BALCÃO</strong>
        <h1>SENHA {receipt.code}</h1>
        <p>Pedido: {receipt.orderId.slice(0, 8).toUpperCase()}</p>
        <p>Total: {formatBRL(receipt.total)}</p>
        <p>Não é documento fiscal</p>
      </div>}
      <h3 className="font-bold text-sm">Aguardando pagamento no totem</h3>
      <p className="text-xs">Confirme somente depois da aprovação na maquininha ao lado do totem.</p>
      {pending.map(item => (
        <div key={item.orderId} className="flex items-center justify-between gap-2 p-2 border rounded-lg">
          <div className="text-xs">
            <strong>{formatBRL(item.total)}</strong>
            <p>Pedido #{item.orderId.slice(0, 8).toUpperCase()}</p>
          </div>
          <button type="button" disabled={busy !== null}
            className="px-3 py-2 rounded-lg text-xs font-bold" style={confirmStyle}
            onClick={() => {
              setBusy(item.orderId); setMessage('');
              void totemAccessRepository.confirmManualPayment(item.orderId)
                .then(result => {
                  setPending(list => list.filter(row => row.orderId !== item.orderId));
                  setMessage('Pagamento confirmado. A senha foi liberada.');
                  if (item.autoPrintStore && /^\d{3,4}$/.test(result.pickupCode)) {
                    const key = `dc_totem_printed:${tenantId}:${item.orderId}`;
                    try {
                      if (localStorage.getItem(key)) return;
                      localStorage.setItem(key, '1');
                    } catch {
                      // Keep the confirmed payment; a blocked storage area cannot block the sale.
                    }
                    setReceipt({ orderId: item.orderId, total: item.total, code: result.pickupCode });
                  }
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
