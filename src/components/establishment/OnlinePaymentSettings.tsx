import React, { useCallback, useEffect, useState } from 'react';
import { paymentRepository, PaymentAccount, OnlineProvider, PROVIDER_LABELS } from '../../repositories/paymentRepository';
import { PixPaymentSettingsCard } from './PixPaymentSettingsCard';
import { Button } from '../ui/Button';
import { CreditCard, ShieldCheck } from 'lucide-react';

export function OnlinePaymentSettings({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [availability, setAvailability] = useState<Partial<Record<OnlineProvider, boolean>>>({});
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [tag, setTag] = useState('');
  const load = useCallback(async () => {
    if (!canEdit) return;
    try { const data = await paymentRepository.accounts(tenantId); setAccounts(data.accounts); setAvailability(data.availability); }
    catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar os pagamentos.'); }
    finally { setLoading(false); }
  }, [tenantId, canEdit]);
  useEffect(() => { setAccounts([]); setAvailability({}); setError(''); setLoading(true); void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(''); try { await fn(); await load(); } catch(e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); } finally { setBusy(false); }
  };
  return <section className="space-y-4" aria-labelledby="online-payments-title">
    <div><h2 id="online-payments-title" className="text-lg font-bold flex items-center gap-2"><CreditCard className="w-5 h-5 text-emerald-700" />Pagamentos online</h2>
      <p className="text-sm text-gray-600">Receba direto na conta da sua loja. Disponível em todos os planos.</p></div>
    {!canEdit ? <p className="text-sm text-gray-500">Somente o proprietário ou gerente pode configurar as contas de pagamento.</p> : <>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div className="grid sm:grid-cols-2 gap-4">
        {(Object.keys(PROVIDER_LABELS) as OnlineProvider[]).map(provider => {
          const account = accounts.find(a => a.provider === provider); const connected = account?.status === 'connected';
          return <article key={provider} className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
            <div className="flex justify-between gap-2"><h3 className="font-bold">{PROVIDER_LABELS[provider]}</h3><span className="text-xs text-gray-500">{connected ? 'Conectado' : loading ? 'Carregando…' : availability[provider] ? 'Não conectado' : 'Em breve'}</span></div>
            <p className="text-xs text-gray-600">{provider === 'manual_pix' ? 'O cliente paga pela sua chave. Confira o recebimento e confirme no pedido.' : provider === 'infinitepay' ? 'Gere um link com sua InfiniteTag. Confira o recebimento e confirme no pedido.' : 'Conecte sua conta para receber PIX e cartão com confirmação automática.'}</p>
            {connected && <p className="text-xs text-gray-600">{account.account_label}</p>}
            {provider === 'infinitepay' && !connected && availability[provider] && <label className="block text-xs font-semibold">Sua InfiniteTag<input value={tag} onChange={e => setTag(e.target.value)} autoComplete="off" placeholder="Seu nome na InfinitePay" className="mt-1 w-full rounded-lg border p-2 text-sm" /></label>}
            {connected && <div className="space-y-2 text-sm">
              <label className="flex gap-2"><input type="radio" name="primary-payment-account" checked={account.is_primary} disabled={busy} onChange={() => void act(() => paymentRepository.configure(tenantId, provider, { is_primary: true }))} />Conta principal</label>
              <label className="flex gap-2"><input type="checkbox" checked={account.accepts_pix} disabled={busy} onChange={e => void act(() => paymentRepository.configure(tenantId, provider, { accepts_pix: e.target.checked }))} />Aceitar PIX</label>
              {provider !== 'manual_pix' && <label className="flex gap-2"><input type="checkbox" checked={account.accepts_card} disabled={busy} onChange={e => void act(() => paymentRepository.configure(tenantId, provider, { accepts_card: e.target.checked }))} />Aceitar cartão</label>}
            </div>}
            <Button size="sm" variant={connected ? 'secondary' : 'primary'} disabled={busy || loading || (!connected && !availability[provider])} onClick={() => void act(async () => {
              if (connected) await paymentRepository.configure(tenantId, provider, { action: 'disconnect' });
              else { const result = await paymentRepository.connect(tenantId, provider, provider === 'infinitepay' ? tag : undefined); setTag(''); if (result.url) window.location.assign(result.url); }
            })}>{connected ? 'Desconectar' : availability[provider] ? 'Conectar' : 'Em breve'}</Button>
          </article>;
        })}
      </div>
      <PixPaymentSettingsCard tenantId={tenantId} canEdit={canEdit} />
      <p className="text-xs text-gray-500 flex gap-1"><ShieldCheck className="w-4 h-4 shrink-0" />As credenciais ficam protegidas no servidor. Nenhuma taxa da plataforma é adicionada ao pagamento.</p>
    </>}
  </section>;
}
