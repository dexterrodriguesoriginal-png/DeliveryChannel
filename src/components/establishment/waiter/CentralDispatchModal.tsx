import React, { useEffect, useState } from 'react';
import { AlertCircle, Bell, CheckCircle2, Clock, Send, Users, Volume2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { waiterV2Repository } from '../../../repositories/waiterV2Repository';
import { initials, sortRoster, type RosterEntry } from '../../../lib/waiter/waiterRouting';
import { playNewOrderSound } from '../../../utils/audio';

interface CentralCall {
  id: string;
  tableLabel: string;
  type: string;
  createdAt: string;
  route: string;
}

interface CentralDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  call: CentralCall | null;
  onDispatched?: () => void;
}

export const CentralDispatchModal: React.FC<CentralDispatchModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  call,
  onDispatched,
}) => {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [busyWaiterId, setBusyWaiterId] = useState<string | null>(null);
  const [escalating, setEscalating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !tenantId) return;
    let alive = true;
    waiterV2Repository.roster(tenantId).then(r => {
      if (alive) setRoster(sortRoster(r));
    }).catch(() => {});
    return () => { alive = false; };
  }, [isOpen, tenantId]);

  if (!call) return null;

  const handleDispatch = async (waiterId: string) => {
    setBusyWaiterId(waiterId);
    setError('');
    try {
      await waiterV2Repository.dispatchCall(call.id, waiterId);
      onDispatched?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao despachar chamado.');
    } finally {
      setBusyWaiterId(null);
    }
  };

  const handleEscalate = async () => {
    setEscalating(true);
    setError('');
    try {
      await waiterV2Repository.escalateCall(call.id);
      onDispatched?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao escalonar chamado.');
    } finally {
      setEscalating(false);
    }
  };

  const onlineWaiters = roster.filter(w => w.online);
  const offlineWaiters = roster.filter(w => !w.online);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Despachar chamado · ${call.tableLabel}`}
      description="Toque no garçom para encaminhar este chamado individualmente."
      size="md"
    >
      <div className="space-y-4 text-xs">
        <div className="flex items-center justify-between rounded-2xl bg-amber-500/10 p-3 ring-1 ring-amber-400/30 text-amber-950">
          <div className="flex items-center gap-2.5">
            <Bell className="h-5 w-5 text-amber-600 animate-bounce" />
            <div>
              <p className="font-extrabold text-sm">{call.tableLabel}</p>
              <p className="text-[11px] text-amber-800">
                {call.type === 'BILL' ? 'Pediu a conta' : call.type === 'HELP' ? 'Precisa de ajuda' : 'Chamou o garçom'}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleEscalate}
            disabled={escalating}
            className="text-[11px] border-amber-300 text-amber-900 bg-amber-50 hover:bg-amber-100"
          >
            {escalating ? 'Escalonando…' : 'Liberar para todos'}
          </Button>
        </div>

        {error && <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-rose-700 font-semibold">{error}</p>}

        <div className="space-y-2">
          <h4 className="font-bold text-gray-700 uppercase tracking-wider text-[11px] flex items-center justify-between">
            <span>Garçons Online ({onlineWaiters.length})</span>
            <span className="text-gray-400 font-normal">Toque para despachar</span>
          </h4>

          {onlineWaiters.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center text-gray-500">
              <AlertCircle className="mx-auto h-6 w-6 text-gray-400 mb-1" />
              Nenhum garçom online no momento. Use &ldquo;Liberar para todos&rdquo; para avisar todos assim que entrarem.
            </div>
          ) : (
            <div className="grid gap-2">
              {onlineWaiters.map(waiter => {
                const isBusy = waiter.busy;
                return (
                  <button
                    key={waiter.userId}
                    type="button"
                    onClick={() => handleDispatch(waiter.userId)}
                    disabled={!!busyWaiterId || escalating}
                    className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3 hover:border-emerald-600 hover:bg-emerald-50/50 transition text-left"
                  >
                    <div className="flex items-center gap-3">
                      {waiter.photoUrl ? (
                        <img src={waiter.photoUrl} alt="" className="h-9 w-9 rounded-xl object-cover" />
                      ) : (
                        <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-800 font-bold text-xs">
                          {initials(waiter.name)}
                        </span>
                      )}
                      <div>
                        <p className="font-bold text-gray-900 text-xs">{waiter.name}</p>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Online
                          </span>
                          <span>·</span>
                          <span>{waiter.tableCount} {waiter.tableCount === 1 ? 'mesa' : 'mesas'}</span>
                          <span>·</span>
                          <span className={isBusy ? 'font-bold text-amber-600' : 'text-gray-500'}>
                            {isBusy ? 'Ocupado' : 'Disponível'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-xs">
                      {busyWaiterId === waiter.userId ? 'Despachando…' : 'Enviar'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {offlineWaiters.length > 0 && (
            <div className="pt-2">
              <h5 className="font-semibold text-gray-400 text-[10px] mb-1">Offline ({offlineWaiters.length})</h5>
              <div className="flex flex-wrap gap-1.5">
                {offlineWaiters.map(w => (
                  <span key={w.userId} className="rounded-lg bg-gray-100 px-2 py-1 text-[10px] text-gray-500">
                    {w.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2 border-t border-gray-100">
          <Button type="button" variant="outline" onClick={onClose} disabled={!!busyWaiterId || escalating}>
            Fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
};
