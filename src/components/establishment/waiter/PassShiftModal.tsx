import React, { useEffect, useState } from 'react';
import { ArrowRightLeft, Users } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { waiterV2Repository } from '../../../repositories/waiterV2Repository';
import { initials, type RosterEntry } from '../../../lib/waiter/waiterRouting';

interface PassShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  currentUserId: string;
  myTableLabels: string[];
  onPassed: () => void;
}

export const PassShiftModal: React.FC<PassShiftModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  currentUserId,
  myTableLabels,
  onPassed,
}) => {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [targetWaiterId, setTargetWaiterId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !tenantId) return;
    let alive = true;
    setError('');
    setTargetWaiterId('');
    waiterV2Repository.roster(tenantId).then(r => {
      if (alive) {
        const others = r.filter(w => w.userId !== currentUserId);
        setRoster(others);
        if (others.length > 0) setTargetWaiterId(others[0].userId);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [isOpen, tenantId, currentUserId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetWaiterId) {
      setError('Escolha o garçom para quem deseja passar as mesas.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await waiterV2Repository.passTables(tenantId, currentUserId, targetWaiterId, null);
      onPassed();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Falha ao passar as mesas.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Troca de turno · Passar mesas"
      description="Transfira a responsabilidade das suas mesas para outro garçom da equipe."
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs text-slate-800" data-testid="pass-shift-form">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5">
          <p className="font-bold text-slate-900">Suas mesas atribuídas:</p>
          {myTableLabels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {myTableLabels.map(label => (
                <span key={label} className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-900">
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 italic">Você não tem mesas fixas atribuídas no momento.</p>
          )}
        </div>

        <div>
          <label className="mb-1 block font-bold text-slate-700" htmlFor="target-waiter">
            Passar para o garçom:
          </label>
          {roster.length === 0 ? (
            <p className="rounded-xl bg-amber-50 p-2.5 text-amber-800">
              Nenhum outro garçom ativo encontrado na equipe.
            </p>
          ) : (
            <select
              id="target-waiter"
              value={targetWaiterId}
              onChange={e => setTargetWaiterId(e.target.value)}
              disabled={busy}
              className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs font-semibold text-slate-900 outline-none focus:border-emerald-600"
            >
              {roster.map(w => (
                <option key={w.userId} value={w.userId}>
                  {w.name} {w.online ? '(online)' : '(offline)'} · {w.tableCount} {w.tableCount === 1 ? 'mesa' : 'mesas'}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-rose-50 p-2.5 text-rose-700 font-semibold">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || roster.length === 0 || myTableLabels.length === 0}
            leftIcon={<ArrowRightLeft className="h-3.5 w-3.5" />}
          >
            {busy ? 'Transferindo…' : 'Confirmar troca'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
