import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { normalizeHandoffCode, isCompleteHandoffCode, wrongCodeMessage } from '../../lib/orders/handoff';
import { handoffRepository } from '../../repositories/handoffRepository';
import { useToast } from '../../context/ToastContext';

interface Props {
  orderId: string;
  kind: 'pickup' | 'delivery';
  onDone: () => void | Promise<void>;
}

/** Campo de 4 dígitos para o entregador confirmar retirada (código da loja) ou entrega (código do cliente). */
export const HandoffCodeForm: React.FC<Props> = ({ orderId, kind, onDone }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { showToast } = useToast();
  const isPickup = kind === 'pickup';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCompleteHandoffCode(code) || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = isPickup ? await handoffRepository.confirmPickup(orderId, code) : await handoffRepository.confirmDelivery(orderId, code);
      if (!r.success) {
        setMsg(wrongCodeMessage(r.attemptsLeft));
        setCode('');
        return;
      }
      showToast({
        type: 'success',
        title: isPickup ? 'Retirada confirmada' : 'Entrega concluída!',
        message: isPickup ? 'Boa rota! O cliente já recebeu o código de entrega.' : 'Corrida finalizada com sucesso.',
      });
      await onDone();
    } catch (err: any) {
      setMsg(err?.message || 'Não foi possível confirmar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2" data-testid={`handoff-${kind}`}>
      <label className="block text-xs font-semibold text-gray-700">
        {isPickup ? 'Código de retirada (peça à loja)' : 'Código de entrega (peça ao cliente)'}
      </label>
      <input
        value={code}
        onChange={(e) => setCode(normalizeHandoffCode(e.target.value))}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={4}
        placeholder="0000"
        aria-label={isPickup ? 'Código de retirada' : 'Código de entrega'}
        className="w-full text-center tracking-[0.6em] font-mono text-2xl font-bold py-2.5 rounded-xl border border-gray-300 focus:border-emerald-600 outline-none"
      />
      {msg && <p className="text-xs font-semibold text-rose-600" role="alert">{msg}</p>}
      <Button type="submit" variant="primary" disabled={!isCompleteHandoffCode(code) || busy}
        className={`w-full text-sm py-3 ${isPickup ? '' : 'bg-emerald-700 hover:bg-emerald-800'}`}>
        {busy ? 'Confirmando...' : isPickup ? 'Confirmar retirada e iniciar rota' : 'Confirmar entrega ao cliente'}
      </Button>
    </form>
  );
};
