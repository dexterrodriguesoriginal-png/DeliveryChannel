import React, { useEffect, useState } from 'react';
import { OnlineChoice, PaymentAccount, paymentRepository, PROVIDER_LABELS } from '../../repositories/paymentRepository';
export function OnlinePaymentOptions({ slug, value, onChange }: { slug: string; value: OnlineChoice | null; onChange: (choice: OnlineChoice | null) => void }) {
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  useEffect(() => {
    let alive = true; setAccounts([]);
    void paymentRepository.options(slug).then(r => { if (alive) setAccounts(r.accounts); }).catch(() => {});
    return () => { alive = false; };
  }, [slug]);
  if (!accounts.length) return null;
  const options = [...accounts].sort((a,b) => Number(b.is_primary) - Number(a.is_primary)).flatMap(a => [
    ...(a.accepts_pix ? [{ provider: a.provider, method: 'pix' as const }] : []),
    ...(a.accepts_card ? [{ provider: a.provider, method: 'card' as const }] : []),
  ]);
  return <fieldset className="space-y-2"><legend className="text-xs font-bold text-gray-700">Como deseja pagar?</legend>
    <label className="flex gap-2 rounded-lg border p-3 text-sm"><input type="radio" name="online-payment" checked={!value} onChange={() => onChange(null)} />Pagar na entrega ou retirada</label>
    {options.map(choice => <label key={choice.provider + choice.method} className="flex gap-2 rounded-lg border p-3 text-sm"><input type="radio" name="online-payment" checked={value?.provider === choice.provider && value.method === choice.method} onChange={() => onChange(choice)} />
      {choice.method === 'pix' ? 'PIX' : 'Cartão online'} · {PROVIDER_LABELS[choice.provider]}{accounts.find(a => a.provider === choice.provider)?.is_primary ? ' (principal)' : ''}
    </label>)}
  </fieldset>;
}
