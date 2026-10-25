import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { OnlineChoice, OnlinePayment, paymentRepository, PROVIDER_LABELS } from '../../repositories/paymentRepository';
import { formatBRL } from '../../lib/pricing/money';
import { Button } from '../ui/Button';

export function OnlineOrderPaymentPanel({ orderId, choice, staff = false, onConfirmed }: { orderId: string; choice?: OnlineChoice | null; staff?: boolean; onConfirmed?: () => void }) {
  const [payment, setPayment] = useState<OnlinePayment | null>(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const [taxId, setTaxId] = useState(''); const [now, setNow] = useState(Date.now()); const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true; let running = false; let finished = false; let startRequested = false;
    setPayment(null); setError('');
    const poll = async () => {
      if (finished || running || document.visibilityState === 'hidden') return;
      running = true;
      try { let r = await paymentRepository.status(orderId);
        if (!r.payment && choice && !(choice.provider === 'pagbank' && choice.method === 'pix') && !startRequested) {
          startRequested = true; if (alive) setBusy(true); r = await paymentRepository.create(orderId, choice);
        }
        if (alive) { setPayment(r.payment); setError(''); finished = !!r.payment && ['paid','cancelled','refunded'].includes(r.payment.status); } }
      catch(e) { if (alive && choice) setError(e instanceof Error ? e.message : 'Não foi possível atualizar o pagamento.'); }
      finally { running = false; if (alive) setBusy(false); }
    };
    void poll(); const timer = setInterval(() => { void poll(); }, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(timer); clearInterval(clock); };
  }, [orderId, !!choice]);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir o pagamento.'); } finally { setBusy(false); } };
  if (!payment && !choice) return null;
  const retryChoice = choice || (payment ? { provider: payment.provider, method: payment.method } : null);
  const seconds = payment?.expiresAt ? Math.max(0, Math.floor((new Date(payment.expiresAt).getTime() - now)/1000)) : null;
  const paid = payment?.status === 'paid';
  const terminal = paid || payment?.status === 'cancelled' || payment?.status === 'refunded';
  return <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3 text-left" aria-label="Pagamento online">
    <p role="status" className="font-bold text-emerald-900">{payment?.status === 'cancelled' ? 'Pedido cancelado' : payment?.status === 'refunded' ? 'Pagamento estornado' : paid ? 'Pago online' : payment?.manualConfirmation ? 'Aguardando confirmação' : 'Aguardando pagamento'}</p>
    {payment && <p className="text-xs">{PROVIDER_LABELS[payment.provider]} · {formatBRL(payment.amount)}</p>}
    {(!payment || payment.status === 'creating') && retryChoice?.provider === 'pagbank' && retryChoice.method === 'pix' && <label className="block text-sm">CPF ou CNPJ do pagador<input inputMode="numeric" autoComplete="off" value={taxId} onChange={e => setTaxId(e.target.value)} className="w-full rounded-lg border p-2 mt-1" /></label>}
    {!payment && choice && <>
      <Button size="sm" isLoading={busy} onClick={() => void act(async () => setPayment((await paymentRepository.create(orderId, choice, taxId)).payment))}>{choice.method === 'pix' ? 'Gerar pagamento PIX' : 'Preparar pagamento com cartão'}</Button>
    </>}
    {!terminal && payment?.status === 'creating' && <><p className="text-xs">Preparando seu pagamento. Aguarde alguns instantes.</p>{retryChoice && retryChoice.provider !== 'infinitepay' && <Button size="sm" isLoading={busy} onClick={() => void act(async () => setPayment((await paymentRepository.create(orderId, retryChoice, taxId)).payment))}>Tentar gerar novamente</Button>}</>}
    {!terminal && payment?.brcode && <>
      {seconds !== 0 && <QRCodeSVG value={payment.brcode} size={192} marginSize={4} title="QR Code para pagamento PIX" />}
      <textarea aria-label="Código PIX copia e cola" readOnly value={payment.brcode} rows={3} className="w-full rounded-lg border p-2 font-mono text-xs" onFocus={e => e.currentTarget.select()} />
      <Button size="sm" disabled={seconds === 0} onClick={() => void act(async () => { await navigator.clipboard.writeText(payment.brcode!); setCopied(true); })}>{copied ? 'Copiado!' : 'Copiar código PIX'}</Button>
    </>}
    {!terminal && seconds !== null && <p className="text-xs">{seconds > 0 ? `Código válido por ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}` : 'Código expirado. Fale com a loja antes de pagar.'}</p>}
    {!terminal && payment?.checkoutUrl && <a href={payment.checkoutUrl} target="_blank" rel="noopener noreferrer" className="inline-block rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm font-bold">{payment.method === 'pix' ? 'Abrir pagamento PIX' : 'Pagar com cartão'}</a>}
    {!terminal && payment?.manualConfirmation && <p className="text-xs">A loja confere o recebimento e confirma o pagamento no pedido.</p>}
    {!terminal && staff && payment?.canConfirm && <Button size="sm" isLoading={busy} onClick={() => void act(async () => { await paymentRepository.confirm(orderId); setPayment((await paymentRepository.status(orderId)).payment); onConfirmed?.(); })}>Confirmar pagamento</Button>}
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
  </section>;
}
