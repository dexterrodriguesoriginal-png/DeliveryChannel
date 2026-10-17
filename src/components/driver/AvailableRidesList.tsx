import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { formatBRL } from '../../lib/pricing/money';
import { handoffRepository, AvailableDriverOrder } from '../../repositories/handoffRepository';
import { useToast } from '../../context/ToastContext';

interface Props {
  tenantId: string;
  enabled: boolean;
  onAccepted: () => void | Promise<void>;
}

/** Corridas chamadas pela loja (aguardando entregador). Quem aceitar primeiro leva. */
export const AvailableRidesList: React.FC<Props> = ({ tenantId, enabled, onAccepted }) => {
  const [rides, setRides] = useState<AvailableDriverOrder[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    if (!enabled) { setRides([]); return; }
    try {
      const all = await handoffRepository.listAvailable();
      setRides(all.filter(r => r.tenantId === tenantId));
    } catch (err) {
      console.warn('[AvailableRides] falha ao listar corridas', err);
    }
  }, [enabled, tenantId]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 10000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!enabled || rides.length === 0) return null;

  return (
    <Card className="p-4 space-y-3 border-emerald-300" data-testid="available-rides">
      <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Corridas disponíveis</h4>
      {rides.map(r => (
        <div key={r.id} className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
          <div className="min-w-0">
            <div className="text-xs font-bold text-gray-900">#{r.orderNumber} · {r.storeName}</div>
            <div className="text-[11px] text-gray-500 truncate">{r.deliveryAddress}</div>
            <div className="text-xs font-bold text-emerald-700">Você ganha {formatBRL(r.driverPayout)}</div>
          </div>
          <Button size="sm" variant="primary" disabled={busyId !== null} onClick={async () => {
            setBusyId(r.id);
            try {
              await handoffRepository.accept(r.id);
              showToast({ type: 'success', title: 'Corrida aceita', message: 'Vá até a loja e peça o código de retirada.' });
              await onAccepted();
            } catch (err: any) {
              showToast({ type: 'error', title: 'Não foi possível aceitar', message: err?.message || 'Tente novamente.' });
            } finally {
              setBusyId(null);
              load();
            }
          }}>
            {busyId === r.id ? 'Aceitando...' : 'Aceitar'}
          </Button>
        </div>
      ))}
    </Card>
  );
};
