import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, Clock, Plus, Receipt, RefreshCw, Utensils, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useModules } from '../../hooks/useModules';
import { supabase } from '../../lib/supabase';
import { newIdempotencyKey } from '../../lib/backend';
import { Product, SelectedProductOption } from '../../types';
import { productRepository } from '../../repositories/productRepository';
import { productOptionRepository } from '../../repositories/productOptionRepository';
import { formatBRL } from '../../lib/pricing/money';
import { playShortBeep } from '../../utils/audio';
import { Modal } from '../../components/ui/Modal';
import { ProductOptionsSelector } from '../../components/client/customer/ProductOptionsSelector';
import { validateOptionSelection } from '../../lib/addons';

type DiningTable = { id: string; label: string; area: string | null; seats: number; active: boolean };
type DiningTab = {
  id: string;
  table_id: string;
  status: 'OPEN' | 'BILL_REQUESTED' | 'CLOSED' | 'CANCELLED';
  opened_at: string;
  service_fee_percent: number;
  service_fee_removed: boolean;
};
type TabSession = { id: string; tab_id: string; display_name: string; approved_at: string | null; expires_at: string };
type WaiterCall = { id: string; tab_id: string; type: 'CALL' | 'BILL' | 'HELP'; status: string; created_at: string };
type DiningRound = {
  id: string;
  tab_id: string;
  order_number: number;
  customer_name: string;
  status: string;
  subtotal: number;
  created_at: string;
  round_no: number;
};
type PaymentMethod = 'CAIXA' | 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'PIX';
type PaymentLine = { method: PaymentMethod; amount: string; tendered: string };

const STAFF_ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER'];
const money = (value: number) => formatBRL(Number.isFinite(value) ? value : 0);
const missingSchema = (error: { code?: string; message?: string }) =>
  ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code || '') ||
  /could not find the (table|function)|does not exist/i.test(error.message || '');

export const SalonPage: React.FC = () => {
  const { activeTenant, activeRole, securityContext } = useAuth();
  const { available, isModuleEnabled } = useModules();
  const enabled = available && isModuleEnabled('dine_in');
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [tabs, setTabs] = useState<DiningTab[]>([]);
  const [sessions, setSessions] = useState<TabSession[]>([]);
  const [calls, setCalls] = useState<WaiterCall[]>([]);
  const [rounds, setRounds] = useState<DiningRound[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [optionChoices, setOptionChoices] = useState<SelectedProductOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [closeRoles, setCloseRoles] = useState<string[]>(['OWNER', 'MANAGER', 'CASHIER']);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feeReason, setFeeReason] = useState('');
  const [orderOpen, setOrderOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: 'CAIXA', amount: '', tendered: '' }]);
  const seenCalls = useRef<Set<string>>(new Set());

  const selectedTab = useMemo(() => tabs.find(tab => tab.table_id === selectedTableId), [tabs, selectedTableId]);
  const selectedTable = useMemo(() => tables.find(table => table.id === selectedTableId), [tables, selectedTableId]);
  const selectedProduct = useMemo(() => catalogProducts.find(product => product.id === productId), [catalogProducts, productId]);
  const activeRounds = useMemo(
    () => (selectedTab ? rounds.filter(round => round.tab_id === selectedTab.id) : []),
    [rounds, selectedTab],
  );
  const activeSessions = useMemo(() => selectedTab ? sessions.filter(session => session.tab_id === selectedTab.id) : [], [sessions, selectedTab]);
  const activeCalls = useMemo(() => selectedTab ? calls.filter(call => call.tab_id === selectedTab.id && call.status === 'OPEN') : [], [calls, selectedTab]);

  const load = useCallback(async (quiet = false) => {
    if (!activeTenant?.id || !enabled || !STAFF_ROLES.includes(activeRole || '')) {
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const [tableResult, tabResult, configResult, productList] = await Promise.all([
        supabase.from('dining_tables').select('id,label,area,seats,active').eq('tenant_id', activeTenant.id).eq('active', true).order('label'),
        supabase.from('dining_tabs').select('id,table_id,status,opened_at,service_fee_percent,service_fee_removed').eq('tenant_id', activeTenant.id).in('status', ['OPEN', 'BILL_REQUESTED']).order('opened_at'),
        supabase.from('tenant_modules').select('config').eq('tenant_id', activeTenant.id).eq('module_key', 'dine_in').maybeSingle(),
        productRepository.getProducts(securityContext, activeTenant.id),
      ]);
      if (tableResult.error) throw tableResult.error;
      if (tabResult.error) throw tabResult.error;
      if (configResult.error && !missingSchema(configResult.error)) throw configResult.error;
      const loadedTables = (tableResult.data || []) as DiningTable[];
      const loadedTabs = (tabResult.data || []) as DiningTab[];
      setTables(loadedTables);
      setTabs(loadedTabs);
      setProducts(productList.filter(product => product.isActive));
      const config = configResult.data?.config as { close_roles?: string[] } | null;
      setCloseRoles(Array.isArray(config?.close_roles) ? config.close_roles : ['OWNER', 'MANAGER', 'CASHIER']);
      if (!loadedTabs.length) {
        setSessions([]);
        setCalls([]);
        setRounds([]);
      } else {
        const tabIds = loadedTabs.map(tab => tab.id);
        const [sessionResult, callResult, roundResult] = await Promise.all([
          supabase.from('tab_sessions').select('id,tab_id,display_name,approved_at,expires_at').eq('tenant_id', activeTenant.id).in('tab_id', tabIds).gt('expires_at', new Date().toISOString()),
          supabase.from('waiter_calls').select('id,tab_id,type,status,created_at').eq('tenant_id', activeTenant.id).in('tab_id', tabIds).eq('status', 'OPEN').order('created_at'),
          supabase.from('orders').select('id,tab_id,order_number,customer_name,status,subtotal,created_at,round_no').eq('tenant_id', activeTenant.id).eq('fulfillment_type', 'DINE_IN').in('tab_id', tabIds).neq('status', 'CANCELLED').order('round_no'),
        ]);
        if (sessionResult.error) throw sessionResult.error;
        if (callResult.error) throw callResult.error;
        if (roundResult.error) throw roundResult.error;
        setSessions((sessionResult.data || []) as TabSession[]);
        const nextCalls = (callResult.data || []) as WaiterCall[];
        const newCalls = nextCalls.filter(call => !seenCalls.current.has(call.id));
        if (seenCalls.current.size && newCalls.length) playShortBeep();
        seenCalls.current = new Set(nextCalls.map(call => call.id));
        setCalls(nextCalls);
        setRounds((roundResult.data || []) as DiningRound[]);
      }
      setMessage(null);
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (missingSchema(err)) setMessage('O Salão ainda não está disponível neste banco. Atualize as migrações para habilitar a operação.');
      else {
        console.error('[SalonPage] Erro ao carregar o salão:', error);
        setMessage(err.message || 'Não foi possível carregar o salão.');
      }
    } finally {
      setLoading(false);
    }
  }, [activeTenant?.id, activeRole, enabled, securityContext]);

  useEffect(() => {
    void load();
    if (!activeTenant?.id || !enabled) return;
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void load(true); }, 10000);
    return () => window.clearInterval(timer);
  }, [activeTenant?.id, enabled, load]);

  useEffect(() => {
    let alive = true;
    setCatalogProducts(products);
    setOptionsError(null);
    if (!orderOpen || !products.length) return () => { alive = false; };
    void productOptionRepository.getPublicForProducts(activeTenant?.id || '', products.map(product => product.id))
      .then(groups => {
        if (alive) setCatalogProducts(products.map(product => ({ ...product, optionGroups: groups.get(product.id) || [] })));
      })
      .catch(error => {
        if (alive) setOptionsError(error instanceof Error ? error.message : 'Não foi possível carregar os adicionais.');
      });
    return () => { alive = false; };
  }, [activeTenant?.id, orderOpen, products]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      await load(true);
    } catch (error) {
      const err = error as { message?: string };
      setMessage(err.message || 'Não foi possível concluir a ação.');
    } finally {
      setBusy(null);
    }
  };

  const approve = (sessionId: string) => run(`approve-${sessionId}`, async () => {
    const { error } = await supabase.rpc('approve_session', { p_session_id: sessionId });
    if (error) throw error;
  });

  const removeFee = () => {
    if (!selectedTab) return;
    if (!feeReason.trim()) { setMessage('Informe o motivo para remover a taxa.'); return; }
    void run('remove-fee', async () => {
      const { error } = await supabase.rpc('remove_service_fee', { p_tab_id: selectedTab.id, p_reason: feeReason.trim() });
      if (error) throw error;
      setFeeReason('');
    });
  };

  const markCallHandled = (callId: string) => run(`call-${callId}`, async () => {
    const { error } = await supabase.rpc('handle_waiter_call', { p_call_id: callId });
    if (error) throw error;
  });

  const submitStaffRound = () => {
    if (!selectedTab || !productId) return;
    const activeGroups = selectedProduct?.optionGroups?.filter(group => group.active) || [];
    const selection = validateOptionSelection(activeGroups, optionChoices);
    if (activeGroups.length && !selection.valid) {
      setMessage(selection.messages[0] || 'Confira os adicionais selecionados.');
      return;
    }
    void run('submit-round', async () => {
      const { error } = await supabase.rpc('submit_round', {
        p_items: [{ productId, quantity, notes: notes.trim(), options: optionChoices }],
        p_idempotency_key: newIdempotencyKey(),
        p_tab_id: selectedTab.id,
      });
      if (error) throw error;
      setOrderOpen(false);
      setProductId('');
      setOptionChoices([]);
      setQuantity(1);
      setNotes('');
    });
  };

  const subtotal = activeRounds.reduce((sum, round) => sum + Number(round.subtotal || 0), 0);
  const fee = selectedTab && !selectedTab.service_fee_removed
    ? Math.round(subtotal * Number(selectedTab.service_fee_percent) / 100 * 100) / 100
    : 0;
  const totalCents = Math.round((subtotal + fee) * 100);
  const canClose = activeRole === 'OWNER' || closeRoles.includes(activeRole || '');
  const closeTab = () => {
    if (!selectedTab) return;
    const lines = payments.map(payment => {
      const amountCents = Math.round(Number(payment.amount.replace(',', '.')) * 100);
      const tenderedCents = payment.method === 'CASH' && payment.tendered
        ? Math.round(Number(payment.tendered.replace(',', '.')) * 100)
        : amountCents;
      return { method: payment.method, amount_cents: amountCents, change_given_cents: Math.max(0, tenderedCents - amountCents) };
    });
    if (payments.some((payment, index) => payment.method === 'CASH' && payment.tendered &&
      Number(payment.tendered.replace(',', '.')) * 100 < lines[index].amount_cents)) {
      setMessage('O valor precisa ser maior que a conta.');
      return;
    }
    if (lines.some(line => !Number.isInteger(line.amount_cents) || line.amount_cents <= 0)) {
      setMessage('Informe valores de pagamento válidos.');
      return;
    }
    if (lines.reduce((sum, line) => sum + line.amount_cents, 0) !== totalCents) {
      setMessage('A soma dos pagamentos precisa ser igual ao total da conta.');
      return;
    }
    void run('close-tab', async () => {
      const { error } = await supabase.rpc('close_tab', { p_tab_id: selectedTab.id, p_payments: lines });
      if (error) throw error;
      setCloseOpen(false);
      setSelectedTableId(null);
    });
  };

  const statusFor = (table: DiningTable) => {
    const tab = tabs.find(item => item.table_id === table.id);
    if (!tab) return { tone: 'bg-gray-100 border-gray-300 text-gray-700', label: 'Livre' };
    if (tab.status === 'BILL_REQUESTED') return { tone: 'bg-green-100 border-green-500 text-green-900', label: 'Pediu a conta' };
    const hasCall = calls.some(call => call.tab_id === tab.id && call.status === 'OPEN') ||
      sessions.some(session => session.tab_id === tab.id && !session.approved_at);
    if (hasCall) return { tone: 'bg-yellow-100 border-yellow-500 text-yellow-950', label: 'Chamando / aguardando liberação' };
    const overdue = rounds.some(round => round.tab_id === tab.id &&
      ['CONFIRMED', 'PREPARING'].includes(round.status) && Date.now() - new Date(round.created_at).getTime() > 25 * 60_000);
    if (overdue) return { tone: 'bg-red-100 border-red-500 text-red-900', label: 'Rodada atrasada' };
    return { tone: 'bg-blue-100 border-blue-500 text-blue-900', label: `Ocupada · ${Math.max(0, Math.floor((Date.now() - new Date(tab.opened_at).getTime()) / 60000))} min` };
  };

  if (!enabled) return <div className="rounded-2xl bg-white p-6 text-sm text-gray-600">O módulo Mesa/Comanda está desativado.</div>;
  if (!activeTenant) return null;

  return (
    <div className="space-y-4" data-testid="salon-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-black text-gray-950">Salão</h1><p className="text-sm text-gray-600">Mapa de mesas e comandas em andamento</p></div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-bold"><RefreshCw className="h-4 w-4" />Atualizar</button>
      </header>
      {message && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{message}</div>}
      <div className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-white" role="status" data-testid="salon-alerts">
        <Bell className="h-5 w-5" />
        <span className="font-bold">{calls.filter(call => call.type !== 'BILL').length} chamados · {tabs.filter(tab => tab.status === 'BILL_REQUESTED').length} contas</span>
      </div>
      {loading ? <p className="text-sm text-gray-500">Carregando o salão…</p> : tables.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-sm text-gray-600">Nenhuma mesa ativa. Cadastre mesas em Módulos → Mesa/Comanda → Configurar.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {tables.map(table => {
            const status = statusFor(table);
            const tab = tabs.find(item => item.table_id === table.id);
            return <button key={table.id} type="button" onClick={() => setSelectedTableId(table.id)}
              className={`min-h-32 rounded-2xl border-2 p-4 text-left shadow-sm transition hover:shadow-md ${status.tone}`}
              data-testid={`salon-table-${table.id}`} aria-label={`${table.label}, ${status.label}`}>
              <div className="flex items-start justify-between gap-2"><Utensils className="h-5 w-5" /><span className="text-xs font-bold">{tab ? sessions.filter(session => session.tab_id === tab.id).length : ''}</span></div>
              <div className="mt-3 text-xl font-black">{table.label}</div>
              <div className="text-xs font-semibold">{table.area || `${table.seats} lugares`}</div>
              <div className="mt-2 text-xs font-bold">{status.label}</div>
            </button>;
          })}
        </div>
      )}
      {selectedTable && <div className="fixed inset-0 z-40 flex justify-end bg-black/40" role="presentation" onClick={event => { if (event.target === event.currentTarget) setSelectedTableId(null); }}>
        <section className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl" role="dialog" aria-label={`Comanda ${selectedTable.label}`}>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-xl font-black">{selectedTable.label} · {selectedTable.area || 'Salão'}</h2><p className="text-sm text-gray-500">{selectedTable.seats} lugares</p></div>
            <button type="button" onClick={() => setSelectedTableId(null)} aria-label="Fechar detalhes"><X className="h-5 w-5" /></button>
          </div>
          {!selectedTab ? <p className="mt-6 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">Mesa livre, sem comanda aberta.</p> : <>
            <div className="mt-5 space-y-3">
              <h3 className="font-black">Pessoas e liberação</h3>
              {activeSessions.map(session => <div key={session.id} className="flex items-center justify-between gap-2 rounded-xl border p-3">
                <div><div className="font-bold">{session.display_name}</div><div className="text-xs text-gray-500">{session.approved_at ? 'Liberada' : 'Aguardando liberação'}</div></div>
                {!session.approved_at && <button type="button" disabled={busy === `approve-${session.id}`} onClick={() => void approve(session.id)} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white">Liberar</button>}
              </div>)}
              {activeSessions.length === 0 && <p className="text-sm text-gray-500">Sem sessões ativas.</p>}
            </div>
            <div className="mt-5 space-y-2">
              <h3 className="font-black">Chamados</h3>
              {activeCalls.map(call => <div key={call.id} className="flex items-center justify-between rounded-xl border p-3">
                <span className="font-semibold">{call.type === 'BILL' ? 'Pediu a conta' : call.type === 'HELP' ? 'Precisa de ajuda' : 'Chamou o garçom'}</span>
                <button type="button" disabled={busy === `call-${call.id}`} onClick={() => void markCallHandled(call.id)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-bold"><Check className="h-4 w-4" />Marcar atendido</button>
              </div>)}
              {activeCalls.length === 0 && <p className="text-sm text-gray-500">Sem chamados abertos.</p>}
            </div>
            <div className="mt-5 space-y-2">
              <h3 className="font-black">Rodadas</h3>
              {activeRounds.map(round => <div key={round.id} className="rounded-xl border p-3">
                <div className="flex justify-between gap-2 font-bold"><span>Rodada {round.round_no} · Pedido #{round.order_number}</span><span>{money(Number(round.subtotal))}</span></div>
                <div className="mt-1 text-sm text-gray-600">{round.customer_name} · {round.status === 'CONFIRMED' ? 'Recebido' : round.status === 'PREPARING' ? 'Preparando' : round.status === 'READY' ? 'Pronto' : round.status === 'DELIVERED' ? 'Entregue' : round.status}</div>
                <div className="text-xs text-gray-500"><Clock className="mr-1 inline h-3 w-3" />{new Date(round.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>)}
              {activeRounds.length === 0 && <p className="text-sm text-gray-500">Nenhuma rodada enviada.</p>}
            </div>
            <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><b>{money(subtotal)}</b></div>
              <div className="flex justify-between"><span>Taxa de serviço (opcional)</span><b>{money(fee)}</b></div>
              {selectedTab.service_fee_percent > 0 && !selectedTab.service_fee_removed && <>
                <input aria-label="Motivo para remover a taxa" value={feeReason} onChange={event => setFeeReason(event.target.value)} placeholder="Motivo para remover a taxa" className="mt-3 w-full rounded-lg border px-3 py-2" />
                <button type="button" onClick={removeFee} disabled={!!busy} className="mt-2 rounded-lg border border-amber-400 px-3 py-2 text-sm font-bold text-amber-900">Remover taxa</button>
              </>}
              <div className="mt-2 flex justify-between border-t pt-2 text-base font-black"><span>Total</span><span>{money(subtotal + fee)}</span></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setOrderOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-bold text-white"><Plus className="h-4 w-4" />Lançar pedido</button>
              {canClose && <button type="button" disabled={totalCents <= 0} onClick={() => {
                setPayments([{ method: 'CAIXA', amount: (totalCents / 100).toFixed(2), tendered: '' }]);
                setCloseOpen(true);
              }} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white"><Receipt className="h-4 w-4" />Fechar conta</button>}
            </div>
          </>}
        </section>
      </div>}
      <Modal isOpen={orderOpen} onClose={() => setOrderOpen(false)} title="Lançar pedido na mesa">
        <div className="space-y-3">
          <label className="block text-sm font-semibold">Produto
            <select aria-label="Produto" value={productId} onChange={event => setProductId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="">Selecione um produto</option>{catalogProducts.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          {optionsError && <p role="alert" className="text-sm text-rose-700">{optionsError}</p>}
          {selectedProduct?.optionGroups?.some(group => group.active) && <ProductOptionsSelector
            groups={selectedProduct.optionGroups}
            selections={optionChoices}
            onChange={setOptionChoices}
          />}
          <label className="block text-sm font-semibold">Quantidade<input aria-label="Quantidade" type="number" min={1} value={quantity} onChange={event => setQuantity(Math.max(1, Number(event.target.value)))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="block text-sm font-semibold">Observação<input aria-label="Observação" value={notes} onChange={event => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <button type="button" disabled={!productId || !!busy} onClick={submitStaffRound} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white">Enviar para a cozinha</button>
        </div>
      </Modal>
      <Modal isOpen={closeOpen} onClose={() => setCloseOpen(false)} title="Revisar e fechar conta">
        <div className="space-y-3">
          <p className="text-lg font-black">Total: {money(totalCents / 100)}</p>
          {payments.map((payment, index) => <div key={index} className="grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-3">
            <select aria-label={`Forma de pagamento ${index + 1}`} value={payment.method} onChange={event => setPayments(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, method: event.target.value as PaymentMethod } : row))} className="rounded-lg border px-2 py-2">
              <option value="CAIXA">Ir ao caixa</option><option value="CASH">Dinheiro</option><option value="CREDIT_CARD">Crédito</option><option value="DEBIT_CARD">Débito</option><option value="PIX">PIX na mesa</option>
            </select>
            <input aria-label={`Valor do pagamento ${index + 1}`} value={payment.amount} onChange={event => setPayments(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} placeholder="Valor" inputMode="decimal" className="rounded-lg border px-2 py-2" />
            {payment.method === 'CASH' ? <input aria-label="Troco para" value={payment.tendered} onChange={event => setPayments(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, tendered: event.target.value } : row))} placeholder="Troco para R$" inputMode="decimal" className="rounded-lg border px-2 py-2" /> : <span />}
          </div>)}
          <div className="flex gap-2">
            <button type="button" onClick={() => setPayments(rows => [...rows, { method: 'CASH', amount: '', tendered: '' }])} className="rounded-lg border px-3 py-2 text-sm font-bold">Adicionar pagamento</button>
            {payments.length > 1 && <button type="button" onClick={() => setPayments(rows => rows.slice(0, -1))} className="rounded-lg border px-3 py-2 text-sm font-bold">Remover último</button>}
          </div>
          {payments.some(payment => payment.method === 'CASH' && payment.tendered && Number(payment.tendered.replace(',', '.')) * 100 < Number(payment.amount.replace(',', '.')) * 100) && <p role="alert" className="text-sm font-bold text-red-700">O valor precisa ser maior que a conta</p>}
          <button type="button" disabled={!!busy} onClick={closeTab} className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">Confirmar fechamento</button>
        </div>
      </Modal>
    </div>
  );
};
