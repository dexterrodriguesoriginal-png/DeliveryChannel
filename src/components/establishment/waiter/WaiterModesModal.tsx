import React, { useEffect, useState } from 'react';
import { Check, Clock, Radio, Shield, Sparkles, UserCheck, Users, ArrowRightLeft } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import {
  DEFAULT_SERVICE_SETTINGS,
  SERVICE_MODE_LABELS,
  summarizeTables,
  tablesByWaiter,
  toggleAssignment,
  type RosterEntry,
  type ServiceMode,
  type ServiceSettings,
} from '../../../lib/waiter/waiterRouting';
import { waiterV2Repository, type TableAssignment } from '../../../repositories/waiterV2Repository';
import { initials } from '../../../lib/waiter/waiterRouting';

interface TableLike {
  id: string;
  label: string;
  area?: string | null;
  seats?: number;
}

interface WaiterModesModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  tables: TableLike[];
  onSaved?: () => void;
}

export const WaiterModesModal: React.FC<WaiterModesModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  tables,
  onSaved,
}) => {
  const [tab, setTab] = useState<'MODE' | 'ASSIGN' | 'PASS'>('MODE');
  const [settings, setSettings] = useState<ServiceSettings>(DEFAULT_SERVICE_SETTINGS);
  const [assignments, setAssignments] = useState<TableAssignment[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [selectedWaiterId, setSelectedWaiterId] = useState<string | null>(null);
  const [fromWaiterId, setFromWaiterId] = useState<string>('');
  const [toWaiterId, setToWaiterId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!isOpen || !tenantId) return;
    let alive = true;
    setLoading(true);
    setError('');
    setSuccess('');
    Promise.all([
      waiterV2Repository.settings(tenantId),
      waiterV2Repository.assignments(tenantId),
      waiterV2Repository.roster(tenantId),
    ])
      .then(([s, a, r]) => {
        if (!alive) return;
        setSettings(s);
        setAssignments(a);
        setRoster(r);
        if (r.length > 0 && !selectedWaiterId) setSelectedWaiterId(r[0].userId);
      })
      .catch((err: any) => {
        if (alive) setError(err.message || 'Erro ao carregar configurações de atendimento.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [isOpen, tenantId]);

  const handleSaveMode = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await waiterV2Repository.saveSettings(tenantId, settings);
      setSuccess('Modo de atendimento salvo com sucesso.');
      onSaved?.();
    } catch (err: any) {
      setError(err.message || 'Falha ao salvar configurações.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleTable = async (tableId: string) => {
    if (!selectedWaiterId) return;
    const next = toggleAssignment(assignments, tableId, selectedWaiterId);
    setAssignments(next);
    const byWaiter = tablesByWaiter(next);
    const waiterTableIds = byWaiter.get(selectedWaiterId) ?? [];
    try {
      await waiterV2Repository.assignTables(tenantId, selectedWaiterId, waiterTableIds);
      onSaved?.();
    } catch (err: any) {
      setError(err.message || 'Erro ao atribuir mesa.');
    }
  };

  const handlePassTables = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromWaiterId || !toWaiterId || fromWaiterId === toWaiterId) {
      setError('Selecione dois garçons diferentes para a troca de turno.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const moved = await waiterV2Repository.passTables(tenantId, fromWaiterId, toWaiterId, null);
      setSuccess(`${moved} ${moved === 1 ? 'mesa passada' : 'mesas passadas'} com sucesso!`);
      const nextAssignments = await waiterV2Repository.assignments(tenantId);
      setAssignments(nextAssignments);
      onSaved?.();
    } catch (err: any) {
      setError(err.message || 'Erro ao passar mesas.');
    } finally {
      setBusy(false);
    }
  };

  const byWaiter = tablesByWaiter(assignments);
  const currentAssignedTableIds = new Set(selectedWaiterId ? byWaiter.get(selectedWaiterId) ?? [] : []);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Modo de Atendimento do Salão"
      description="Defina como os chamados das mesas são distribuídos para a equipe de garçons."
      size="lg"
    >
      <div className="space-y-4 text-xs">
        {/* Abas */}
        <div className="flex border-b border-gray-200">
          <button
            type="button"
            onClick={() => setTab('MODE')}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 font-bold ${
              tab === 'MODE' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Radio className="h-4 w-4" />
            Modo e Prazos
          </button>
          <button
            type="button"
            onClick={() => setTab('ASSIGN')}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 font-bold ${
              tab === 'ASSIGN' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users className="h-4 w-4" />
            Distribuir Mesas ({assignments.length}/{tables.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('PASS')}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 font-bold ${
              tab === 'PASS' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <ArrowRightLeft className="h-4 w-4" />
            Troca de Turno
          </button>
        </div>

        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-700 font-semibold">{error}</p>}
        {success && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-800 font-semibold">{success}</p>}

        {tab === 'MODE' && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {(['FREE', 'FIXED', 'CENTRAL'] as ServiceMode[]).map((modeKey) => {
                const info = SERVICE_MODE_LABELS[modeKey];
                const active = settings.mode === modeKey;
                return (
                  <button
                    key={modeKey}
                    type="button"
                    onClick={() => setSettings(s => ({ ...s, mode: modeKey }))}
                    className={`flex flex-col justify-between rounded-2xl border p-4 text-left transition ${
                      active
                        ? 'border-emerald-600 bg-emerald-50/60 shadow-sm ring-2 ring-emerald-500'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-sm text-gray-900">{info.title}</span>
                        {active && <Check className="h-4 w-4 text-emerald-600" />}
                      </div>
                      <p className="mt-2 text-[11px] text-gray-600 leading-relaxed">{info.hint}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {settings.mode === 'FIXED' && (
              <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 space-y-3">
                <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-emerald-700" />
                  Regras de Escalonamento (Mesas Fixas)
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1" htmlFor="accept-timeout">
                      Tempo limite para o responsável aceitar (segundos)
                    </label>
                    <input
                      id="accept-timeout"
                      type="number"
                      min={10}
                      max={600}
                      value={settings.acceptTimeoutSeconds}
                      onChange={e => setSettings(s => ({ ...s, acceptTimeoutSeconds: Number(e.target.value) || 60 }))}
                      className="w-full rounded-xl border border-gray-200 bg-white p-2.5 outline-none focus:border-emerald-600"
                    />
                    <p className="mt-1 text-[10px] text-gray-500">Padrão: 60s. Se ele não aceitar ou estiver offline, vai para todos os garçons.</p>
                  </div>
                  <div className="flex items-center">
                    <label className="flex items-start gap-2 cursor-pointer mt-3">
                      <input
                        type="checkbox"
                        checked={settings.hybridHelp}
                        onChange={e => setSettings(s => ({ ...s, hybridHelp: e.target.checked }))}
                        className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <div>
                        <span className="font-bold text-gray-800">Modo Híbrido (Ajudar)</span>
                        <p className="text-[11px] text-gray-500">Permite que um garçom atenda chamados e registre ajuda em mesa de outro colega.</p>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {settings.mode === 'CENTRAL' && (
              <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 space-y-3">
                <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-emerald-700" />
                  Regras da Central (Dono/Gerente decide)
                </h4>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1" htmlFor="dispatch-timeout">
                    Tempo limite para despachar antes de escalonar para todos (segundos)
                  </label>
                  <input
                    id="dispatch-timeout"
                    type="number"
                    min={10}
                    max={600}
                    value={settings.dispatchTimeoutSeconds}
                    onChange={e => setSettings(s => ({ ...s, dispatchTimeoutSeconds: Number(e.target.value) || 60 }))}
                    className="w-full max-w-xs rounded-xl border border-gray-200 bg-white p-2.5 outline-none focus:border-emerald-600"
                  />
                  <p className="mt-1 text-[10px] text-gray-500">Padrão: 60s. O chamado toca no painel da gerência com lista de garçons online; se ninguém despachar a tempo, pode escalonar para todos.</p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Fechar</Button>
              <Button type="button" variant="primary" onClick={handleSaveMode} disabled={busy}>
                {busy ? 'Salvando…' : 'Salvar modo'}
              </Button>
            </div>
          </div>
        )}

        {tab === 'ASSIGN' && (
          <div className="space-y-4">
            <div>
              <p className="text-gray-600 mb-2">
                Selecione um garçom abaixo e clique nas mesas para atribuir ou liberar.
              </p>
              {roster.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  Nenhum garçom cadastrado na equipe. Cadastre garçons em <strong>Equipe &amp; Permissões</strong>.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {roster.map(w => {
                    const active = selectedWaiterId === w.userId;
                    const wTableIds = byWaiter.get(w.userId) ?? [];
                    const wTableLabels = tables.filter(t => wTableIds.includes(t.id)).map(t => t.label);
                    return (
                      <button
                        key={w.userId}
                        type="button"
                        onClick={() => setSelectedWaiterId(w.userId)}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
                          active
                            ? 'border-emerald-600 bg-emerald-600 text-white font-bold shadow'
                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {w.photoUrl ? (
                          <img src={w.photoUrl} alt="" className="h-6 w-6 rounded-lg object-cover" />
                        ) : (
                          <span className={`grid h-6 w-6 place-items-center rounded-lg text-[10px] font-bold ${
                            active ? 'bg-emerald-800 text-white' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {initials(w.name)}
                          </span>
                        )}
                        <div>
                          <p className="text-xs leading-none">{w.name}</p>
                          <p className={`text-[10px] ${active ? 'text-emerald-100' : 'text-gray-500'}`}>
                            {wTableLabels.length > 0 ? summarizeTables(wTableLabels) : 'Sem mesas'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 pt-3">
              <h4 className="font-bold text-gray-800 mb-2">
                Mapa de Mesas ({tables.length} mesas)
              </h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5 max-h-72 overflow-y-auto p-1">
                {tables.map(table => {
                  const isAssignedToSelected = currentAssignedTableIds.has(table.id);
                  const assignedToWaiter = assignments.find(a => a.table_id === table.id);
                  const assignedWaiter = assignedToWaiter ? roster.find(r => r.userId === assignedToWaiter.waiter_id) : null;

                  return (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => handleToggleTable(table.id)}
                      disabled={!selectedWaiterId}
                      className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center transition ${
                        isAssignedToSelected
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-black ring-2 ring-emerald-500'
                          : assignedWaiter
                          ? 'border-amber-300 bg-amber-50 text-amber-950 opacity-90'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-sm font-black">{table.label}</span>
                      <span className="text-[10px] text-gray-500">{table.area || 'Salão'}</span>
                      {assignedWaiter && (
                        <span className={`mt-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${
                          isAssignedToSelected ? 'bg-emerald-600 text-white' : 'bg-amber-200 text-amber-900'
                        }`}>
                          {assignedWaiter.name.split(' ')[0]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {tab === 'PASS' && (
          <form onSubmit={handlePassTables} className="space-y-4">
            <p className="text-gray-600">
              Passe as mesas de um garçom para outro (por exemplo, na troca de turno).
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block font-semibold text-gray-700 mb-1" htmlFor="from-waiter">
                  Garçom de saída (passar mesas de):
                </label>
                <select
                  id="from-waiter"
                  value={fromWaiterId}
                  onChange={e => setFromWaiterId(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white p-2.5 text-xs outline-none focus:border-emerald-600"
                  required
                >
                  <option value="">Selecione o garçom...</option>
                  {roster.map(r => {
                    const count = byWaiter.get(r.userId)?.length ?? 0;
                    return (
                      <option key={r.userId} value={r.userId}>
                        {r.name} ({count} {count === 1 ? 'mesa' : 'mesas'})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1" htmlFor="to-waiter">
                  Garçom de entrada (receber mesas):
                </label>
                <select
                  id="to-waiter"
                  value={toWaiterId}
                  onChange={e => setToWaiterId(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white p-2.5 text-xs outline-none focus:border-emerald-600"
                  required
                >
                  <option value="">Selecione o garçom...</option>
                  {roster.filter(r => r.userId !== fromWaiterId).map(r => (
                    <option key={r.userId} value={r.userId}>{r.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
              <Button type="submit" variant="primary" disabled={busy || !fromWaiterId || !toWaiterId}>
                {busy ? 'Transferindo…' : 'Passar todas as mesas'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
