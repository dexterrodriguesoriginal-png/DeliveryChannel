import React from 'react';
import { OnlineProvider, PaymentAccount, PROVIDER_LABELS } from '../../repositories/paymentRepository';

export function PrimaryPaymentAccountChoice({ accounts, busy, onChoose }: {
  accounts: PaymentAccount[]; busy: boolean; onChoose: (provider: OnlineProvider) => void;
}) {
  const connected = accounts.filter(account => account.status === 'connected');
  if (connected.length < 2) return null;
  return <fieldset className="space-y-3 rounded-2xl border border-gray-200 p-4">
    <legend className="px-1 font-bold">Escolha a conta em que deseja receber</legend>
    <p className="text-sm text-gray-600">A conta escolhida aparece primeiro para o cliente no pagamento.</p>
    {connected.map(account => <label key={account.provider} className="flex gap-2 text-sm">
      <input type="radio" name="primary-payment-account" checked={account.is_primary} disabled={busy} onChange={() => onChoose(account.provider)} />
      <span><span className="block font-semibold">{account.account_label || PROVIDER_LABELS[account.provider]}</span>
        <span className="block text-gray-600">Receber nesta conta</span></span>
    </label>)}
  </fieldset>;
}
