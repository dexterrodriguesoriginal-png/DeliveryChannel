import React, { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, Loader2, Pencil, Printer, QrCode, Save, Trash2, X } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useToast } from '../../context/ToastContext';
import { tenantModuleRepository } from '../../repositories/tenantModuleRepository';
import { diningTableRepository, DiningTable } from '../../repositories/diningTableRepository';
import { DineInConfig, diningTableQrUrl, bulkTableInputs, readDineInConfig } from './salonSetup';

const CLOSE_ROLE_OPTIONS = [
  ['OWNER', 'Proprietário'],
  ['MANAGER', 'Gerente'],
  ['CASHIER', 'Caixa'],
  ['WAITER', 'Garçom'],
] as const;

interface Props {
  tenantId: string;
  tenantName: string;
  canManageTables: boolean;
  canConfigure: boolean;
  canManageServiceFeeModule: boolean;
  canRegenerateQr: boolean;
  onConfigSaved: () => Promise<void>;
}

export const SalonSetupPanel: React.FC<Props> = ({
  tenantId,
  tenantName,
  canManageTables,
  canConfigure,
  canManageServiceFeeModule,
  canRegenerateQr,
  onConfigSaved,
}) => {
  const { showToast } = useToast();
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [config, setConfig] = useState<DineInConfig>(readDineInConfig());
  const [feeEnabled, setFeeEnabled] = useState(false);
  const [feePercent, setFeePercent] = useState(10);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingTable, setSavingTable] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newArea, setNewArea] = useState('');
  const [newSeats, setNewSeats] = useState(2);
  const [bulkCount, setBulkCount] = useState(10);
  const [bulkArea, setBulkArea] = useState('');
  const [bulkSeats, setBulkSeats] = useState(2);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ label: '', area: '', seats: 2 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [snapshot, fetchedTables] = await Promise.all([
        tenantModuleRepository.getForTenant(tenantId),
        diningTableRepository.list(tenantId),
      ]);
      const dineIn = snapshot.modules.find(module => module.key === 'dine_in');
      const fee = snapshot.modules.find(module => module.key === 'service_fee');
      setConfig(readDineInConfig(dineIn?.config));
      setFeeEnabled(Boolean(fee?.enabled));
      const percent = Number(fee?.config.percent ?? 10);
      setFeePercent(Number.isFinite(percent) ? percent : 10);
      setTables(fetchedTables);
    } catch (error) {
      showToast({ type: 'error', title: 'Falha ao carregar configuração do salão', message: error instanceof Error ? error.message : 'Tente novamente.' });
    } finally {
      setLoading(false);
    }
  }, [tenantId, showToast]);

  useEffect(() => { void load(); }, [load]);

  const saveConfig = async () => {
    if (!canConfigure || savingConfig) return;
    if (!Number.isFinite(config.round_limit) || config.round_limit <= 0 || !Number.isFinite(feePercent) || feePercent < 0 || feePercent > 30) {
      showToast({ type: 'error', title: 'Valores inválidos', message: 'O limite por rodada deve ser maior que zero e a taxa deve ficar entre 0 e 30%.' });
      return;
    }
    setSavingConfig(true);
    try {
      const snapshot = await tenantModuleRepository.getForTenant(tenantId);
      const fee = snapshot.modules.find(module => module.key === 'service_fee');
      await tenantModuleRepository.configureDineIn(
        tenantId,
        config,
        feeEnabled,
        { ...(fee?.config || {}), percent: feePercent },
      );
      await onConfigSaved();
      showToast({ type: 'success', title: 'Configuração salva', message: 'As opções do salão foram atualizadas.' });
    } catch (error) {
      showToast({ type: 'error', title: 'Não foi possível salvar', message: error instanceof Error ? error.message : 'Tente novamente.' });
    } finally {
      setSavingConfig(false);
    }
  };

  const addTable = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageTables || !newLabel.trim()) return;
    setSavingTable(true);
    try {
      const created = await diningTableRepository.create(tenantId, { label: newLabel, area: newArea, seats: newSeats });
      setTables(current => [...current, created].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })));
      setNewLabel('');
      showToast({ type: 'success', title: 'Mesa criada', message: `${created.label} está pronta para receber clientes.` });
    } catch (error) {
      showToast({ type: 'error', title: 'Falha ao criar mesa', message: error instanceof Error ? error.message : 'Tente novamente.' });
    } finally {
      setSavingTable(false);
    }
  };

  const addBulkTables = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageTables || bulkCount < 1 || bulkCount > 100) return;
    setSavingTable(true);
    try {
      const created = await diningTableRepository.createMany(tenantId, bulkTableInputs(bulkCount, bulkArea, bulkSeats));
      setTables(current => [...current, ...created].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })));
      showToast({ type: 'success', title: 'Mesas criadas', message: `${created.length} mesas foram adicionadas.` });
    } catch (error) {
      showToast({ type: 'error', title: 'Falha ao criar mesas', message: error instanceof Error ? error.message : 'Verifique se os nomes das mesas já existem.' });
    } finally {
      setSavingTable(false);
    }
  };

  const saveTable = async (table: DiningTable) => {
    setSavingTable(true);
    try {
      const updated = await diningTableRepository.update(tenantId, table.id, editValues, table.label);
      setTables(current => current.map(item => item.id === updated.id ? updated : item));
      setEditingId(null);
    } catch (error) {
      showToast({ type: 'error', title: 'Falha ao atualizar mesa', message: error instanceof Error ? error.message : 'Tente novamente.' });
    } finally {
      setSavingTable(false);
    }
  };

  const removeTable = async (table: DiningTable) => {
    if (!window.confirm(`Excluir ${table.label}? Essa ação não pode ser desfeita.`)) return;
    try {
      await diningTableRepository.remove(tenantId, table.id);
      setTables(current => current.filter(item => item.id !== table.id));
    } catch (error) {
      showToast({ type: 'error', title: 'Falha ao excluir mesa', message: error instanceof Error ? error.message : 'Tente novamente.' });
    }
  };

  const regenerateQr = async (table: DiningTable) => {
    if (!window.confirm(`Gerar um novo QR para ${table.label}? O QR antigo deixará de funcionar.`)) return;
    setRegeneratingId(table.id);
    try {
      const token = await diningTableRepository.regenerateQr(tenantId, table.id);
      setTables(current => current.map(item => item.id === table.id ? { ...item, qrToken: token } : item));
      showToast({ type: 'success', title: 'Novo QR gerado', message: `O QR antigo de ${table.label} não funciona mais.` });
    } catch (error) {
      showToast({ type: 'error', title: 'Falha ao renovar QR', message: error instanceof Error ? error.message : 'Tente novamente.' });
    } finally {
      setRegeneratingId(null);
    }
  };

  return (
    <section className="space-y-4" aria-label="Configuração do salão">
      <style>{`
        @media print {
          @page { size: A6 portrait; margin: 8mm; }
          body * { visibility: hidden !important; }
          .salon-print, .salon-print * { visibility: visible !important; }
          .salon-print { position: absolute; inset: 0; width: 100%; }
          .salon-poster { break-after: page; page-break-after: always; }
          .salon-poster:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Configuração do salão</h2>
          <p className="text-xs text-gray-500">Configure comandas, regras de atendimento e mesas com QR Code.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()} disabled={!tables.length}>
          <Printer className="mr-1.5 h-4 w-4" /> Imprimir cartazes A6
        </Button>
      </div>

      <Card className="space-y-4 p-4">
        <h3 className="font-semibold text-gray-900">Comandas e atendimento</h3>
        {!canConfigure && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            <AlertTriangle className="mr-1 inline h-4 w-4" /> Somente o proprietário pode alterar as opções de comandas e taxa.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-gray-700">
            Modo de atendimento
            <select value={config.mode} disabled={!canConfigure || savingConfig} onChange={e => setConfig({ ...config, mode: e.target.value as DineInConfig['mode'] })} className="mt-1 block min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3 disabled:bg-gray-100">
              <option value="TABLE">Mesa</option><option value="INDIVIDUAL">Comanda individual</option>
            </select>
          </label>
          <label className="text-xs font-medium text-gray-700">
            Limite por rodada (R$)
            <input type="number" min="0.01" step="0.01" value={config.round_limit} disabled={!canConfigure || savingConfig} onChange={e => setConfig({ ...config, round_limit: Number(e.target.value) })} className="mt-1 block min-h-10 w-full rounded-lg border border-gray-300 px-3 disabled:bg-gray-100" />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={config.release_required} disabled={!canConfigure || savingConfig} onChange={e => setConfig({ ...config, release_required: e.target.checked })} />
            Exigir liberação do atendimento
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input type="checkbox" checked={config.salon_open} disabled={!canConfigure || savingConfig} onChange={e => setConfig({ ...config, salon_open: e.target.checked })} />
            Salão aberto (permite atendimento quando a loja estiver fechada)
          </label>
        </div>
        <fieldset disabled={!canConfigure || savingConfig} className="space-y-2">
          <legend className="text-xs font-semibold text-gray-700">Quem pode fechar comandas</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {CLOSE_ROLE_OPTIONS.map(([role, label]) => (
              <label key={role} className="flex items-center gap-1.5 text-xs text-gray-700">
                <input type="checkbox" checked={config.close_roles.includes(role)} onChange={e => setConfig({
                  ...config,
                  close_roles: e.target.checked ? [...config.close_roles, role] : config.close_roles.filter(item => item !== role),
                })} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="border-t border-gray-100 pt-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <input
              type="checkbox"
              checked={feeEnabled}
              disabled={!canManageServiceFeeModule || savingConfig}
              onChange={e => setFeeEnabled(e.target.checked)}
            />
            Ativar taxa de serviço opcional
          </label>
          {!canManageServiceFeeModule && (
            <p className="mt-1 text-[11px] text-gray-500">A ativação ou desativação de módulos continua restrita ao proprietário.</p>
          )}
          {feeEnabled && (
            <label className="mt-2 block max-w-xs text-xs font-medium text-gray-700">
              Taxa de serviço (%)
              <input type="number" min="0" max="30" step="0.01" value={feePercent} disabled={!canConfigure || savingConfig} onChange={e => setFeePercent(Number(e.target.value))} className="mt-1 block min-h-10 w-full rounded-lg border border-gray-300 px-3 disabled:bg-gray-100" />
            </label>
          )}
        </div>
        {canConfigure && <Button type="button" variant="primary" size="sm" disabled={savingConfig} onClick={() => void saveConfig()}>
          {savingConfig ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Salvar configuração
        </Button>}
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <h3 className="font-semibold text-gray-900">Mesas e QR Codes</h3>
          <p className="text-xs text-gray-500">Crie, edite e organize as mesas por área e quantidade de lugares.</p>
        </div>
        {canManageTables && (
          <>
            <form onSubmit={addTable} className="grid items-end gap-2 sm:grid-cols-4">
              <label className="text-xs text-gray-700">Nome da mesa<input required maxLength={80} value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Ex.: Mesa externa" className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-3" /></label>
              <label className="text-xs text-gray-700">Área<input maxLength={80} value={newArea} onChange={e => setNewArea(e.target.value)} placeholder="Salão" className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-3" /></label>
              <label className="text-xs text-gray-700">Lugares<input type="number" min="1" max="100" value={newSeats} onChange={e => setNewSeats(Number(e.target.value))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-3" /></label>
              <Button type="submit" size="sm" variant="primary" disabled={savingTable}>Adicionar mesa</Button>
            </form>
            <form onSubmit={addBulkTables} className="grid items-end gap-2 rounded-lg bg-gray-50 p-3 sm:grid-cols-4">
              <label className="text-xs text-gray-700">Mesas 1 a N<input type="number" min="1" max="100" value={bulkCount} onChange={e => setBulkCount(Number(e.target.value))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-3" /></label>
              <label className="text-xs text-gray-700">Área<input maxLength={80} value={bulkArea} onChange={e => setBulkArea(e.target.value)} placeholder="Salão" className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-3" /></label>
              <label className="text-xs text-gray-700">Lugares por mesa<input type="number" min="1" max="100" value={bulkSeats} onChange={e => setBulkSeats(Number(e.target.value))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-3" /></label>
              <Button type="submit" size="sm" variant="outline" disabled={savingTable}>Criar Mesas 1 a {bulkCount}</Button>
            </form>
          </>
        )}
        {loading ? <p className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Carregando mesas…</p> : tables.length === 0 ? (
          <p className="py-4 text-center text-xs text-gray-500">Nenhuma mesa cadastrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="border-b bg-gray-50 text-gray-500"><tr><th className="p-2">Mesa</th><th className="p-2">Área</th><th className="p-2">Lugares</th><th className="p-2 text-right">Ações</th></tr></thead>
              <tbody className="divide-y">
                {tables.map(table => <tr key={table.id}>
                  {editingId === table.id ? <>
                    <td className="p-2"><input aria-label="Nome da mesa" value={editValues.label} onChange={e => setEditValues({ ...editValues, label: e.target.value })} className="w-full rounded border px-2 py-1" /></td>
                    <td className="p-2"><input aria-label="Área da mesa" value={editValues.area} onChange={e => setEditValues({ ...editValues, area: e.target.value })} className="w-full rounded border px-2 py-1" /></td>
                    <td className="p-2"><input aria-label="Lugares da mesa" type="number" min="1" max="100" value={editValues.seats} onChange={e => setEditValues({ ...editValues, seats: Number(e.target.value) })} className="w-20 rounded border px-2 py-1" /></td>
                    <td className="space-x-1 p-2 text-right"><Button size="sm" variant="primary" disabled={savingTable} onClick={() => void saveTable(table)}>Salvar</Button><Button size="sm" variant="ghost" onClick={() => setEditingId(null)}><X className="h-4 w-4" /></Button></td>
                  </> : <>
                    <td className="p-2 font-medium text-gray-900">{table.label}</td><td className="p-2">{table.area || '—'}</td><td className="p-2">{table.seats}</td>
                    <td className="space-x-1 p-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => window.open(diningTableQrUrl(window.location.origin, table.qrToken), '_blank', 'noopener,noreferrer')}><QrCode className="h-3.5 w-3.5" /><span className="ml-1">Ver QR</span></Button>
                      {canManageTables && <Button size="sm" variant="ghost" title="Editar mesa" onClick={() => { setEditingId(table.id); setEditValues({ label: table.label, area: table.area || '', seats: table.seats }); }}><Pencil className="h-3.5 w-3.5" /></Button>}
                      {canRegenerateQr && <Button size="sm" variant="ghost" disabled={regeneratingId === table.id} title="Gerar novo QR" onClick={() => void regenerateQr(table)}>{regeneratingId === table.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}</Button>}
                      {canManageTables && <Button size="sm" variant="ghost" title="Excluir mesa" onClick={() => void removeTable(table)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>}
                    </td>
                  </>}
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="salon-print hidden print:block">
        {tables.map(table => (
          <article key={table.id} className="salon-poster flex min-h-[130mm] flex-col items-center justify-center gap-3 text-center">
            <h2 className="text-3xl font-bold">{tenantName} · {table.label}</h2>
            <p className="text-sm">Aponte a câmera para acessar o cardápio</p>
            <QRCodeSVG value={diningTableQrUrl(window.location.origin, table.qrToken)} size={250} level="M" />
            {feeEnabled && <p className="text-sm">A taxa de serviço de {feePercent}% é opcional</p>}
            <p className="break-all text-[9px]">{diningTableQrUrl(window.location.origin, table.qrToken)}</p>
          </article>
        ))}
      </div>
    </section>
  );
};
