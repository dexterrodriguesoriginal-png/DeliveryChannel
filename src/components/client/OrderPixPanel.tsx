import React, { useState } from 'react';
import { orderRepository } from '../../repositories/orderRepository';
import { OrderPixPayload } from '../../types';
import { formatBRL } from '../../lib/pricing/money';
import { Button } from '../ui/Button';
import { QrCode, Copy, Check } from 'lucide-react';

/**
 * PIX do pedido: o BR Code (EMV + CRC16-CCITT) é gerado pelo SERVIDOR com o valor
 * exato do pedido (get_order_pix_payload). Nada é montado no navegador.
 */
export const OrderPixPanel: React.FC<{ orderId: string }> = ({ orderId }) => {
  const [payload, setPayload] = useState<OrderPixPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setPayload(await orderRepository.getOrderPixPayload(orderId));
    } catch (err: any) {
      setError(err.message || 'PIX indisponível para este pedido.');
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload.brcode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Não foi possível copiar automaticamente. Selecione o código e copie manualmente.');
    }
  };

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2 text-left">
      <p className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
        <QrCode className="w-4 h-4" /> Pagamento via PIX
      </p>
      {!payload ? (
        <Button type="button" size="sm" variant="primary" isLoading={loading} onClick={load}>
          Gerar código PIX do pedido
        </Button>
      ) : (
        <>
          <p className="text-[11px] text-emerald-900">
            Valor: <strong>{formatBRL(payload.amount)}</strong> · Recebedor: <strong>{payload.merchantName}</strong>
          </p>
          <textarea
            readOnly
            value={payload.brcode}
            className="w-full text-[10px] font-mono p-2 rounded-lg border border-emerald-200 bg-white"
            rows={3}
            onFocus={e => e.currentTarget.select()}
          />
          <Button type="button" size="sm" variant="primary" onClick={copy} leftIcon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}>
            {copied ? 'Copiado!' : 'Copiar PIX copia e cola'}
          </Button>
        </>
      )}
      {error && <p className="text-[11px] font-semibold text-rose-600">{error}</p>}
    </div>
  );
};
