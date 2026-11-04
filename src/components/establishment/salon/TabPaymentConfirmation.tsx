import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Mail } from 'lucide-react';
import { formatBRL } from '../../../lib/pricing/money';
import { tabReceiptRepository, type TabReceiptTarget } from '../../../repositories/tabReceiptRepository';

const VALID_RECEIPT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/;
export function isValidReceiptEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && VALID_RECEIPT_EMAIL.test(trimmed);
}

const METHOD_LABEL: Record<string, string> = {
  PIX: 'PIX',
  CASH: 'Dinheiro',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  CAIXA: 'Caixa',
};

export const TabPaymentConfirmation: React.FC<{
  tabId: string;
  amountCents: number;
  tableLabel?: string;
  paidAt?: string | null;
  method?: string;
  onDone: () => void;
}> = ({ tabId, amountCents, tableLabel, paidAt, method = 'PIX', onDone }) => {
  const [targetResult, setTarget] = useState<{ tabId: string; value: TabReceiptTarget } | null>(null);
  const target = targetResult?.tabId === tabId ? targetResult.value : null;
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [useOtherEmail, setUseOtherEmail] = useState(false);
  const [otherEmail, setOtherEmail] = useState('');
  const activeTab = useRef<string | null>(tabId);
  activeTab.current = tabId;
  useEffect(() => {
    let active = true;
    activeTab.current = tabId;
    setMessage(''); setSending(false); setUseOtherEmail(false); setOtherEmail('');
    void tabReceiptRepository.target(tabId).then(value => { if (active) setTarget({ tabId, value }); }).catch(() => { /* sending still reports the safe server result */ });
    return () => { active = false; activeTab.current = null; };
  }, [tabId]);
  const otherEmailValid = isValidReceiptEmail(otherEmail);
  const canSend = useOtherEmail ? otherEmailValid : target?.exists !== false;
  const send = async () => {
    if (useOtherEmail && !otherEmailValid) {
      setMessage('Informe um e-mail válido.');
      return;
    }
    setSending(true); setMessage('');
    try {
      const result = useOtherEmail
        ? await tabReceiptRepository.send(tabId, otherEmail.trim())
        : await tabReceiptRepository.send(tabId);
      if (activeTab.current === tabId) setMessage(result.sent ? 'Comprovante enviado por e-mail.' : 'Envio de email não configurado');
    } catch (error) { if (activeTab.current === tabId) setMessage(error instanceof Error ? error.message : 'Não foi possível enviar o comprovante.'); }
    finally { if (activeTab.current === tabId) setSending(false); }
  };
  const date = paidAt ? new Date(paidAt) : null;
  return <section aria-label="Pagamento confirmado" className="mt-4 space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
    <div role="status" className="flex items-center gap-3"><CheckCircle2 className="h-9 w-9 shrink-0 text-emerald-700" aria-hidden="true" /><div><h3 className="text-lg font-black">Pagamento confirmado</h3><p className="text-sm">Conta fechada e mesa liberada.</p></div></div>
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div><dt className="text-emerald-800">Valor recebido</dt><dd className="text-xl font-black">{formatBRL(amountCents / 100)}</dd></div>
      <div><dt className="text-emerald-800">Mesa</dt><dd className="font-bold">{tableLabel || 'Mesa da comanda'}</dd></div>
      <div><dt className="text-emerald-800">Forma</dt><dd className="font-bold">{METHOD_LABEL[method] || method}</dd></div>
      <div><dt className="text-emerald-800">Data e horário</dt><dd className="font-bold">{date && Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Confirmado pelo provedor'}</dd></div>
    </dl>
    <div className="space-y-2 rounded-xl border border-emerald-200 bg-white/80 p-3 text-xs">
      {target?.maskedEmail && <p data-testid="receipt-masked-email">Destinatário: {target.maskedEmail}</p>}
      {target && !target.exists && <p>O cliente não informou e-mail para o comprovante.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          data-testid="receipt-other-email-toggle"
          onClick={() => { setUseOtherEmail(prev => !prev); setMessage(''); }}
          className="font-bold text-emerald-800 underline"
        >
          {useOtherEmail ? 'Usar e-mail cadastrado na conta' : 'Enviar para outro email'}
        </button>
      </div>
      {useOtherEmail && (
        <label className="block space-y-1">
          <span className="font-semibold text-emerald-950">Outro e-mail para o recibo</span>
          <input
            type="email"
            aria-label="Outro e-mail para recibo"
            data-testid="receipt-other-email-input"
            value={otherEmail}
            onChange={e => setOtherEmail(e.target.value)}
            placeholder="cliente@exemplo.com"
            className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
          {otherEmail.trim() !== '' && !otherEmailValid && (
            <span role="alert" className="block text-xs font-semibold text-rose-700">Informe um e-mail válido.</span>
          )}
        </label>
      )}
    </div>
    {message && <p role="status" className="rounded-xl bg-white p-3 text-sm font-semibold">{message}</p>}
    <div className="space-y-2">
      <button type="button" disabled={sending || !canSend} onClick={() => void send()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 text-sm font-bold disabled:opacity-50"><Mail className="h-4 w-4" aria-hidden="true" />{sending ? 'Enviando comprovante…' : 'Enviar comprovante por e-mail'}</button>
      <button type="button" onClick={onDone} className="min-h-11 w-full rounded-xl bg-emerald-700 px-3 font-black text-white">Concluir</button>
    </div>
  </section>;
};
