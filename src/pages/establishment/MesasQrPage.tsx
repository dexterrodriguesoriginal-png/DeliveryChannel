import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, Layers, Loader2, PauseCircle, PlayCircle, Plus, Printer, QrCode, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useModules } from '../../hooks/useModules';
import { Modal } from '../../components/ui/Modal';
import { TableQrCard } from '../../components/establishment/mesas/TableQrCard';
import { diningTableRepository, DiningTable } from '../../repositories/diningTableRepository';
import { mesasQrRepository, MesasQrCapabilities, NO_CAPABILITIES } from '../../repositories/mesasQrRepository';
import { bulkTableNames, friendlyTableError, nextTableName, qrFileName, tableAppUrl, validateTableName, TABLE_NAME_MAX } from '../../lib/salon/tableQr';
import { downloadBlob, qrPosterBlob } from '../../lib/salon/qrImage';
import '../../components/establishment/mesas/mesasQr.css';

const MANAGE_ROLES = ['OWNER', 'MANAGER'];
type Confirm = { kind: 'delete' | 'rotate'; id: string } | null;

export const MesasQrPage: React.FC = () => {
  const { activeTenant, activeRole } = useAuth();
  const { available, isModuleEnabled } = useModules();
  const enabled = available && isModuleEnabled('dine_in');
  const canManage = MANAGE_ROLES.includes(activeRole || '');
  const canRotate = activeRole === 'OWNER';
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [caps, setCaps] = useState<MesasQrCapabilities>(NO_CAPABILITIES);
  const [pausedIds, setPausedIds] = useState<Set<string>>(new Set());
  const [storePaused, setStorePaused] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [seats, setSeats] = useState(4);
  const [bulkCount, setBulkCount] = useState(10);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [printIds, setPrintIds] = useState<string[] | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const slug = activeTenant?.slug || '';
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const urlOf = useCallback((table: DiningTable) => tableAppUrl(origin, slug, table.qrToken), [origin, slug]);
  const flash = useCallback((text: string) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const load = useCallback(async () => {
    if (!activeTenant?.id || !enabled || !canManage) { setLoading(false); return; }
    setLoading(true);
    try {
      const [list, nextCaps] = await Promise.all([diningTableRepository.list(activeTenant.id), mesasQrRepository.capabilities()]);
      setTables(list); setCaps(nextCaps); setError(null);
      if (nextCaps.qrPause) {
        const pauses = await mesasQrRepository.pauses(activeTenant.id).catch(() => ({ storeWide: false, tableIds: [] as string[] }));
        setPausedIds(new Set(pauses.tableIds)); setStorePaused(pauses.storeWide);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar as mesas.'); }
    finally { setLoading(false); }
  }, [activeTenant?.id, enabled, canManage]);
  useEffect(() => { void load(); }, [load]);

  // printing: render the A6 posters, open the print dialog, then unmount them
  useEffect(() => {
    if (!printIds?.length) return;
    const done = () => setPrintIds(null);
    window.addEventListener('afterprint', done);
    const timer = window.setTimeout(() => window.print(), 250);
    return () => { window.removeEventListener('afterprint', done); window.clearTimeout(timer); };
  }, [printIds]);

  const labels = useMemo(() => tables.map(table => table.label), [tables]);
  const printTables = useMemo(() => tables.filter(table => printIds?.includes(table.id) && urlOf(table)), [tables, printIds, urlOf]);

  const guard = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); }
    catch (e) { setError(friendlyTableError(e instanceof Error ? e.message : 'Não foi possível concluir a ação.')); }
    finally { setBusy(false); }
  };

  const addOne = () => {
    if (!activeTenant) return;
    const label = name.trim() || nextTableName(labels);
    const problem = validateTableName(label, labels);
    if (problem) { setNameError(problem); return; }
    setNameError(null);
    void guard(async () => {
      const created = await diningTableRepository.create(activeTenant.id, { label, area, seats });
      setTables(current => [...current, created]); setName(''); flash(`${created.label} criada com QR próprio.`);
    });
  };
  const addBulk = () => {
    if (!activeTenant) return;
    const count = Math.max(1, Math.min(60, Math.floor(bulkCount) || 1));
    void guard(async () => {
      const created = await diningTableRepository.createMany(activeTenant.id, bulkTableNames(count, labels).map(label => ({ label, area, seats })));
      setTables(current => [...current, ...created]); flash(`${created.length} mesas criadas.`);
    });
  };
  const rename = useCallback(async (id: string, label: string) => {
    if (!activeTenant) return;
    const current = tables.find(table => table.id === id);
    if (!current) return;
    const updated = await diningTableRepository.update(activeTenant.id, id, { label, area: current.area || '', seats: current.seats }, current.label);
    setTables(list => list.map(table => table.id === id ? updated : table));
  }, [activeTenant, tables]);

  const copy = useCallback(async (id: string) => {
    const table = tables.find(item => item.id === id);
    const url = table ? urlOf(table) : '';
    if (!url) return;
    try { await navigator.clipboard.writeText(url); flash('Link copiado.'); } catch { flash('Não foi possível copiar automaticamente.'); }
  }, [tables, urlOf, flash]);
  const download = useCallback(async (id: string, svg: SVGElement | null) => {
    const table = tables.find(item => item.id === id);
    if (!table || !svg) return;
    try { downloadBlob(await qrPosterBlob(svg, table.label, activeTenant?.name || 'Cardápio'), qrFileName(table.label, slug)); flash('Imagem baixada.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao baixar.'); }
  }, [tables, activeTenant?.name, slug, flash]);

  const togglePause = useCallback((id: string | null) => {
    if (!activeTenant) return;
    const paused = id === null ? storePaused : pausedIds.has(id);
    void guard(async () => {
      await mesasQrRepository.setPause(activeTenant.id, id, !paused);
      if (id === null) setStorePaused(!paused);
      else setPausedIds(current => { const next = new Set(current); if (paused) next.delete(id); else next.add(id); return next; });
      flash(!paused ? 'QR pausado: clientes veem um aviso.' : 'QR retomado.');
    });
  }, [activeTenant, storePaused, pausedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const runConfirm = () => {
    if (!confirm || !activeTenant) return;
    const { kind, id } = confirm;
    setConfirm(null);
    void guard(async () => {
      if (kind === 'delete') {
        await diningTableRepository.remove(activeTenant.id, id);
        setTables(list => list.filter(table => table.id !== id)); setSelected(current => { const next = new Set(current); next.delete(id); return next; });
        flash('Mesa excluída.');
      } else {
        const token = await diningTableRepository.regenerateQr(activeTenant.id, id);
        setTables(list => list.map(table => table.id === id ? { ...table, qrToken: token } : table));
        flash('Novo QR gerado. O QR impresso anterior não funciona mais — imprima o novo.');
      }
    });
  };

  const onSelect = useCallback((id: string, on: boolean) => setSelected(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; }), []);
  const confirmTable = confirm ? tables.find(table => table.id === confirm.id) : null;

  if (!enabled) return <div className="rounded-2xl bg-white p-6 text-sm text-gray-600">A ferramenta Mesa/Comanda está desativada. Ative em Ferramentas para criar os QR Codes das mesas.</div>;
  if (!canManage) return <div className="rounded-2xl bg-white p-6 text-sm text-gray-600">Somente o proprietário ou o gerente podem gerenciar as mesas e os QR Codes.</div>;

  return (
    <div className="mq-root space-y-5" data-testid="mesas-qr-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black text-gray-950"><QrCode className="h-6 w-6 text-teal-700" aria-hidden="true" />Mesas e QR Code</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">Cada mesa tem um QR fixo e único. O cliente aponta a câmera, pede pelo celular e o pedido cai direto na comanda da mesa — sem entrega e sem taxa.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {caps.qrPause && <button type="button" className="mq-ghost" onClick={() => togglePause(null)} disabled={busy} aria-pressed={storePaused}>
            {storePaused ? <PlayCircle className="h-4 w-4" aria-hidden="true" /> : <PauseCircle className="h-4 w-4" aria-hidden="true" />}{storePaused ? 'Retomar pedidos por QR' : 'Pausar todos os QR'}</button>}
          <button type="button" className="mq-ghost" onClick={() => setSelected(selected.size === tables.length ? new Set() : new Set(tables.map(table => table.id)))} disabled={!tables.length}><Layers className="h-4 w-4" aria-hidden="true" />{selected.size === tables.length && tables.length ? 'Limpar seleção' : 'Selecionar todas'}</button>
          <button type="button" className="mq-primary" onClick={() => setPrintIds(Array.from(selected.size ? selected : new Set(tables.map(table => table.id))))} disabled={!tables.length}><Printer className="h-4 w-4" aria-hidden="true" />Imprimir {selected.size ? `${selected.size} selecionada${selected.size > 1 ? 's' : ''}` : 'todas'} (A6)</button>
        </div>
      </header>

      <div className="flex items-start gap-3 rounded-2xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p><b>Seguro por padrão:</b> o código do QR é aleatório e não revela a loja nem a ordem das mesas, e só serve para lançar itens na comanda aberta desta mesa. Se um cartaz for perdido, gere um <b>Novo QR</b> {canRotate ? '' : '(somente o proprietário) '}e o antigo para de funcionar.{!caps.qrPause && ' A pausa de QR aparece aqui assim que a atualização do banco for aplicada.'}</p>
      </div>

      <div aria-live="polite" className="min-h-[1px]">{notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-900">{notice}</p>}</div>
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</div>}
      {storePaused && <div role="status" className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950"><PauseCircle className="h-5 w-5" aria-hidden="true" />Todos os QR estão pausados. Clientes veem “pedidos pausados”; a equipe continua lançando pelo Salão.</div>}

      <section className="grid gap-3 lg:grid-cols-2" aria-label="Adicionar mesas">
        <div className="mq-panel space-y-3">
          <h2 className="text-sm font-black text-slate-900">Nova mesa</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_90px]">
            <div><label className="sr-only" htmlFor="mq-new-name">Nome da mesa</label>
              <input id="mq-new-name" className="mq-field" value={name} onChange={event => { setName(event.target.value); setNameError(null); }} placeholder={`Nome (3–${TABLE_NAME_MAX}) — ex.: ${nextTableName(labels)}`} maxLength={TABLE_NAME_MAX + 5} aria-invalid={!!nameError} onKeyDown={event => { if (event.key === 'Enter') addOne(); }} /></div>
            <div><label className="sr-only" htmlFor="mq-new-area">Área</label><input id="mq-new-area" className="mq-field" value={area} onChange={event => setArea(event.target.value)} placeholder="Área (varanda…)" maxLength={40} /></div>
            <div><label className="sr-only" htmlFor="mq-new-seats">Lugares</label><input id="mq-new-seats" type="number" min={1} max={50} className="mq-field" value={seats} onChange={event => setSeats(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></div>
          </div>
          {nameError && <p role="alert" className="text-xs font-bold text-rose-700">{nameError}</p>}
          <button type="button" className="mq-primary w-full" onClick={addOne} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}Adicionar mesa</button>
        </div>
        <div className="mq-panel space-y-3">
          <h2 className="text-sm font-black text-slate-900">Criar várias de uma vez</h2>
          <div className="flex items-center gap-2"><label htmlFor="mq-bulk" className="text-sm font-semibold text-slate-700">Quantidade</label>
            <input id="mq-bulk" type="number" min={1} max={60} className="mq-field !w-24" value={bulkCount} onChange={event => setBulkCount(Number(event.target.value))} />
            <span className="text-xs text-slate-600">“Mesa 01”, “Mesa 02”… pula nomes já usados.</span></div>
          <button type="button" className="mq-ghost w-full justify-center" onClick={addBulk} disabled={busy}><Layers className="h-4 w-4" aria-hidden="true" />Criar mesas em lote</button>
        </div>
      </section>

      {loading ? (
        <div role="status" className="flex items-center gap-2 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Carregando as mesas…</div>
      ) : tables.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center shadow-sm"><span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-teal-50 text-teal-700"><QrCode className="h-8 w-8" aria-hidden="true" /></span>
          <h2 className="mt-3 text-lg font-black text-slate-900">Nenhuma mesa ainda</h2><p className="mt-1 text-sm text-gray-600">Crie a primeira mesa acima para gerar o QR Code.</p></div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {tables.map((table, index) => (
            <TableQrCard key={table.id} id={table.id} label={table.label} area={table.area} seats={table.seats} active={table.active} url={urlOf(table)} index={index}
              selected={selected.has(table.id)} paused={pausedIds.has(table.id)} storePaused={storePaused} canPause={caps.qrPause} canRotate={canRotate}
              otherLabels={labels.filter(label => label !== table.label)} busy={busy}
              onSelect={onSelect} onRename={rename} onCopy={copy} onDownload={download} onPrint={id => setPrintIds([id])}
              onRotate={id => setConfirm({ kind: 'rotate', id })} onDelete={id => setConfirm({ kind: 'delete', id })} onTogglePause={togglePause} />
          ))}
        </div>
      )}

      <Modal isOpen={!!confirm} onClose={() => setConfirm(null)} title={confirm?.kind === 'delete' ? 'Excluir mesa' : 'Gerar novo QR'}>
        <div className="space-y-4">
          <p className="text-sm text-slate-700">{confirm?.kind === 'delete'
            ? <>Excluir <b>{confirmTable?.label}</b>? O QR impresso deixa de funcionar. Mesas com histórico de comandas não podem ser excluídas.</>
            : <>Gerar um novo QR para <b>{confirmTable?.label}</b>? O cartaz impresso atual <b>para de funcionar</b> na hora e precisa ser trocado.</>}</p>
          <div className="flex justify-end gap-2"><button type="button" className="mq-ghost" onClick={() => setConfirm(null)}>Cancelar</button>
            <button type="button" className="mq-primary !bg-rose-700 hover:!bg-rose-800" onClick={runConfirm}>{confirm?.kind === 'delete' ? 'Excluir mesa' : 'Gerar novo QR'}</button></div>
        </div>
      </Modal>

      {printIds && printTables.length > 0 && (
        <div className="mq-print" aria-hidden="true" data-testid="mq-print-sheet">
          {printTables.map(table => (
            <div key={table.id} className="mq-poster">
              <div style={{ fontSize: 18, fontWeight: 800 }}>{activeTenant?.name}</div>
              <QRCodeSVG value={urlOf(table)} size={300} level="Q" marginSize={2} />
              <div style={{ fontSize: 44, fontWeight: 900, lineHeight: 1 }}>{table.label}</div>
              <div style={{ fontSize: 15 }}>Aponte a câmera e peça pela mesa</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
