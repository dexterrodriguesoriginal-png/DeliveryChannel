import React, { useEffect, useRef, useState } from 'react';
import { BellRing, Check, Clock, Crown, Plus, Receipt, UserCheck, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatBRL } from '../../lib/pricing/money';
import { statusColorStyle, statusColorTokens } from '../../lib/orders/statusColors';
import { inviteUrl } from '../../lib/customer/tableAccess';
import type { TableStatusInfo } from '../../lib/salon/tableStatus';
import type { StaffHolderCode, TabTableMoveRow, WaiterCallRow, WaiterRound, WaiterSession, WaiterTab, WaiterTable } from '../../repositories/salonStaffRepository';
import { callTitle, canDeliverRound, waiterOrderStatus, type WaiterFeatures } from './waiterLogic';
import { WaiterBillPanel } from './WaiterBillPanel';
import { TabPaymentConfirmation } from '../../components/establishment/salon/TabPaymentConfirmation';

const btn = 'inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-black disabled:opacity-50';

/** Detalhe de uma mesa no celular: pessoas, liberação, chamados, rodadas e as ações do garçom. */
export const WaiterTableSheet: React.FC<{
  table: WaiterTable;
  tab: WaiterTab | undefined;
  info: TableStatusInfo;
  sessions: WaiterSession[];
  calls: WaiterCallRow[];
  rounds: WaiterRound[];
  holderSessionId: string | null | undefined;
  holderCode?: StaffHolderCode | null;
  tenantSlug?: string | null;
  features: WaiterFeatures;
  busy: string | null;
  message: string;
  onClose: () => void;
  onApprove: (sessionId: string) => void;
  onReject: (sessionId: string) => void;
  onHandleCall: (callId: string) => void;
  onOpenTable: () => void;
  onOrder: () => void;
  canCollect?: boolean;
  onConfirmPayment?: (method: 'CASH' | 'CREDIT_CARD') => Promise<boolean> | void;
  onPaymentSettled?: () => void;
  onReopenBill?: () => void;
  onMarkDelivered?: (orderId: string, code?: string) => void;
  requireDeliveryCode?: boolean;
  joinedTables?: WaiterTable[];
  onSeparateTable?: (tableId: string) => void;
  tableMoves?: TabTableMoveRow[];
  onResetHolder: () => void;
  onChangeHolder?: () => void;
  onReleaseEmptyTab?: (reason: string) => void;
  onTransferHolder: (sessionId: string) => void;
  currentUserId?: string;
  onAcceptCall?: (callId: string) => void;
  canHelp?: boolean;
  onHelpTable?: () => void;
  helpSuccess?: boolean;
}> = ({ table, tab, info, sessions, calls, rounds, holderSessionId, holderCode, tenantSlug, features, busy, message, onClose, onApprove, onReject, onHandleCall, onOpenTable, onOrder, canCollect, onConfirmPayment, onPaymentSettled, onReopenBill, onMarkDelivered, requireDeliveryCode = false, joinedTables = [], onSeparateTable, tableMoves = [], onResetHolder, onChangeHolder, onReleaseEmptyTab, onTransferHolder, currentUserId, onAcceptCall, canHelp, onHelpTable, helpSuccess }) => {
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [releaseEmptyOpen, setReleaseEmptyOpen] = useState(false);
  const [releaseEmptyReason, setReleaseEmptyReason] = useState('Cliente desistiu');
  const [releaseEmptyCustomReason, setReleaseEmptyCustomReason] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [deliveryCodes, setDeliveryCodes] = useState<Record<string, string>>({});
  // Active snapshots remove the tab after the webhook closes it. Keep this bill's
  // payment panel mounted until the waiter finishes reading/sending the receipt.
  const [billContext, setBillContext] = useState<{ tableId: string; tab: WaiterTab; totalCents: number } | null>(null);
  const [manualSettled, setManualSettled] = useState<{ tabId: string; totalCents: number; method: 'CASH' | 'CREDIT_CARD'; paidAt: string } | null>(null);
  useEffect(() => {
    setManualSettled(prev => (prev && billContext && prev.tabId === billContext.tab.id ? prev : null));
  }, [table.id, billContext]);
  useEffect(() => {
    setBillContext(previous => {
      if (previous && previous.tableId !== table.id) previous = null;
      if (tab) return canCollect ? { tableId: table.id, tab, totalCents: info.totalCents } : null;
      return previous;
    });
  }, [table.id, tab, canCollect, info.totalCents]);
  const bill = tab
    ? (canCollect ? { tableId: table.id, tab, totalCents: info.totalCents } : null)
    : (billContext?.tableId === table.id ? billContext : null);
  const paymentContext = useRef({ tableId: table.id, tabId: bill?.tab.id });
  paymentContext.current = { tableId: table.id, tabId: bill?.tab.id };
  useEffect(() => { setPaymentError(''); setDeliveryCodes({}); }, [table.id, tab?.id]);
  const focusBillClosing = () => {
    const el = document.getElementById('waiter-bill-select') || document.getElementById('waiter-bill-panel');
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    (el as HTMLElement | null)?.focus?.();
  };
  const pending = sessions.filter(s => !s.approved_at);
  const approved = sessions.filter(s => s.approved_at);
  const isEmptyTab = info.totalCents === 0 && rounds.length === 0;
  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-slate-950/60 backdrop-blur-sm" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={table.label} data-testid="waiter-table-sheet" className="max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] bg-white text-slate-900 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-white/95 px-5 pb-3 pt-5 backdrop-blur">
          <div><h2 className="text-2xl font-black text-slate-900">{table.label}</h2><p className="text-sm text-slate-500">{info.kind === 'FREE' ? `Livre · ${table.seats} lugares` : `${info.label} · aberta há ${info.elapsedLabel}`}</p></div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 px-5">
          {paymentError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{paymentError}</p>}
          {message && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p>}
          {manualSettled && manualSettled.tabId === bill?.tab.id ? (
            <TabPaymentConfirmation
              tabId={manualSettled.tabId}
              amountCents={manualSettled.totalCents}
              tableLabel={table.label}
              method={manualSettled.method}
              paidAt={manualSettled.paidAt}
              onDone={() => { setManualSettled(null); (onPaymentSettled ?? onClose)(); }}
            />
          ) : (
            bill && onConfirmPayment && (
              <WaiterBillPanel
                key={bill.tab.id}
                tabId={bill.tab.id}
                tableLabel={table.label}
                status={bill.tab.status}
                totalCents={bill.totalCents}
                busy={!!busy}
                onManualConfirm={method => {
                  const targetTabId = bill.tab.id;
                  const targetTableId = table.id;
                  const isCurrent = () => paymentContext.current.tableId === targetTableId && paymentContext.current.tabId === targetTabId;
                  const targetTotal = bill.totalCents;
                  setPaymentError('');
                  Promise.resolve().then<boolean | void>(() => onConfirmPayment(method)).then(confirmed => {
                    if (!isCurrent()) return;
                    if (confirmed === true) setManualSettled({ tabId: targetTabId, totalCents: targetTotal, method, paidAt: new Date().toISOString() });
                    else setPaymentError('O pagamento não foi confirmado. Confira a conta antes de tentar novamente.');
                  }).catch(() => { if (isCurrent()) setPaymentError('Não foi possível confirmar o pagamento. Confira a conta e tente novamente.'); });
                }}
                onSettled={onPaymentSettled ?? onClose}
              />
            )
          )}
          {!tab ? (
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              <p>{bill ? 'Acompanhe a confirmação da conta acima.' : 'Mesa livre, sem comanda aberta.'}</p>
              {!bill && (features.openTable
                ? <button type="button" disabled={!!busy} onClick={onOpenTable} className={`${btn} mt-3 w-full bg-slate-900 text-white`}><Plus className="h-4 w-4" />Abrir mesa para o cliente</button>
                : <p className="mt-2 text-xs text-slate-500">Abrir a mesa pelo garçom chega com a próxima atualização do sistema. Enquanto isso, o cliente abre lendo o QR.</p>)}
            </div>
          ) : (<>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Total</p><p className="text-lg font-black">{formatBRL(info.totalCents / 100)}</p></div>
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Pessoas</p><p className="text-lg font-black">{sessions.length}</p></div>
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Rodadas</p><p className="text-lg font-black">{rounds.length}</p></div>
            </div>

            {tab.status === 'BILL_REQUESTED' && <p role="status" className="salon-bill-alert rounded-2xl border p-4 text-sm font-bold" style={statusColorStyle('BILL')}>Conta solicitada pelo cliente. Aguarde o caixa autorizar o fechamento.</p>}
            {tab.status === 'WAITER_AUTHORIZED' && <p role="status" className="rounded-2xl border p-4 text-sm font-bold" style={statusColorStyle('AUTHORIZED')}>Garçom autorizado a fechar esta conta.</p>}
            {tab.status === 'AWAITING_PAYMENT' && !canCollect && <p role="status" className="rounded-2xl border p-4 text-sm font-bold" style={statusColorStyle('AWAITING_PAYMENT')}>Aguardando PIX.</p>}
            {onReopenBill && ['BILL_REQUESTED', 'WAITER_AUTHORIZED'].includes(tab.status) && <button type="button" disabled={!!busy} onClick={onReopenBill} data-testid="waiter-reopen-tab" className={`${btn} w-full border border-[#1E8E38] bg-[#2DBE4E] text-[#0F172A]`} style={{ backgroundColor: '#2DBE4E', borderColor: '#1E8E38', color: '#0F172A' }}>Reabrir conta · Pedir mais</button>}

            {pending.length > 0 && (
              <div className="space-y-2" data-testid="waiter-sheet-pending">
                <h3 className="flex items-center gap-2 text-sm font-black text-amber-800"><UserCheck className="h-4 w-4" />Aguardando liberação</h3>
                {pending.map(s => (
                  <div key={s.id} className="rounded-2xl border border-amber-300 bg-amber-50 p-3">
                    <p className="font-bold text-slate-900">{s.display_name} <span className="font-normal text-slate-600">quer pedir</span></p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {features.reject ? <button type="button" disabled={!!busy} onClick={() => setConfirmReject(s.id)} className={`${btn} border border-rose-200 bg-white text-rose-700`}>Recusar</button> : <span />}
                      <button type="button" disabled={!!busy} onClick={() => onApprove(s.id)} aria-label={`Aprovar ${s.display_name}`} className={`${btn} bg-emerald-600 text-white`}><Check className="h-4 w-4" />Aprovar</button>
                    </div>
                    {confirmReject === s.id && <div role="alertdialog" aria-label="Confirmar recusa" className="mt-2 rounded-xl bg-white p-3 text-sm"><p className="font-semibold">Recusar {s.display_name}?</p><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => setConfirmReject(null)} className={`${btn} border border-slate-200`}>Voltar</button><button type="button" disabled={!!busy} onClick={() => { setConfirmReject(null); onReject(s.id); }} className={`${btn} bg-rose-600 text-white`}>Recusar</button></div></div>}
                  </div>
                ))}
              </div>
            )}

            {calls.length > 0 && (
              <div className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-black text-rose-700"><BellRing className="h-4 w-4" />Chamados</h3>
                {calls.map(c => {
                  const isAcceptedByMe = c.accepted_by === currentUserId;
                  const needsAccept = !c.accepted_by && onAcceptCall;
                  return (
                    <div key={c.id} className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3">
                      <div>
                        <span className="font-bold">{callTitle(c.type)}</span>
                        {isAcceptedByMe && <p className="text-[11px] text-emerald-700 font-semibold">Você está atendendo</p>}
                      </div>
                      {needsAccept ? (
                        <button type="button" disabled={!!busy} onClick={() => onAcceptCall(c.id)} className={`${btn} h-11 bg-emerald-600 text-white`}>
                          Vou atender
                        </button>
                      ) : (
                        <button type="button" disabled={!!busy} onClick={() => onHandleCall(c.id)} className={`${btn} h-11 bg-white text-slate-900 border border-slate-200`}>
                          <Check className="h-4 w-4" />Atendido
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {canHelp && onHelpTable && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-slate-900">
                <p className="text-xs font-bold text-emerald-950">Modo Híbrido ativo</p>
                <p className="text-xs text-slate-600 mt-0.5">Esta mesa pertence a outro garçom, mas você pode ajudar neste atendimento.</p>
                <button
                  type="button"
                  disabled={!!busy || helpSuccess}
                  onClick={onHelpTable}
                  className={`${btn} mt-2 w-full bg-emerald-600 text-white`}
                >
                  {helpSuccess ? 'Registrado como ajudante!' : 'Ajudar nesta mesa'}
                </button>
              </div>
            )}

            {(approved.length > 0 || features.holder) && (
              <div className="space-y-2" data-testid="waiter-sheet-holder">
                <h3 className="text-sm font-black text-slate-700">Na mesa</h3>
                {approved.length > 0 ? (
                  <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
                    {approved.map(s => <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm"><span className="flex items-center gap-1.5 font-semibold">{holderSessionId === s.id && <Crown className="h-4 w-4 text-amber-500" aria-label="Responsável" />}{s.display_name}</span>{holderSessionId === s.id && <span className="text-xs font-bold text-slate-500">Responsável</span>}</li>)}
                  </ul>
                ) : (
                  <p className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">Sem responsável (mesa travada): ninguém assume sozinho pelo QR da mesa. Use Trocar responsável na frente do cliente.</p>
                )}
                {features.holder && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button type="button" disabled={!!busy} onClick={onChangeHolder ?? onResetHolder} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">Trocar responsável</button>
                    {approved.some(s => s.id !== holderSessionId) && <button type="button" disabled={!!busy} onClick={() => setTransferOpen(o => !o)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">Passar responsável</button>}
                  </div>
                )}
                {holderCode && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-slate-900" data-testid="waiter-holder-code">
                    <p className="text-xs font-black uppercase tracking-wide text-amber-900">Código único para o novo responsável (5 min)</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {holderCode.qrToken && (holderCode.tenantSlug || tenantSlug) && typeof window !== 'undefined' && (
                        <div className="rounded-xl bg-white p-2 shadow-sm">
                          <QRCodeSVG
                            value={inviteUrl(window.location.origin, holderCode.tenantSlug || tenantSlug || '', holderCode.qrToken, holderCode.code)}
                            size={108}
                          />
                        </div>
                      )}
                      <div className="space-y-1">
                        <p className="font-mono text-2xl font-black tracking-[0.22em] text-slate-900">{holderCode.code}</p>
                        <p className="text-xs font-semibold text-amber-950">Uso único · Expira em 5 minutos · Fica só na tela da equipe</p>
                      </div>
                    </div>
                  </div>
                )}
                {transferOpen && <div className="space-y-1" role="group" aria-label="Passar responsável para">{approved.filter(s => s.id !== holderSessionId).map(s => <button key={s.id} type="button" disabled={!!busy} onClick={() => { setTransferOpen(false); onTransferHolder(s.id); }} className="block w-full rounded-xl border border-slate-200 px-3 py-3 text-left font-semibold">{s.display_name}</button>)}</div>}
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-black text-slate-700">Rodadas</h3>
              {rounds.length === 0 && <p className="text-sm text-slate-500">Nenhuma rodada enviada.</p>}
              {rounds.map(r => {
                const status = waiterOrderStatus(r.status);
                const needsCode = r.delivery_code_required === true;
                const codeVal = deliveryCodes[r.id] || '';
                return (
                  <div key={r.id} className="rounded-2xl border p-3" style={{ borderColor: statusColorTokens(r.status).border }}>
                    <div className="flex justify-between gap-2 font-bold"><span>Rodada {r.round_no} · #{r.order_number}</span><span>{formatBRL(Number(r.subtotal))}</span></div>
                    <p className="mt-1 rounded-lg border px-2 py-1 text-sm font-bold" style={statusColorStyle(r.status)}>{status.label}</p>
                    <p className="mt-1 text-xs text-slate-500"><Clock className="mr-1 inline h-3 w-3" />{new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                    {r.delivered_at && r.status === 'DELIVERED' && <p className="mt-1 text-xs font-semibold" style={{ color: statusColorTokens('DELIVERED').fg }}>Entregue às {new Date(r.delivered_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{r.delivery_confirmed_with_code ? ' · Confirmado com código' : ''}</p>}
                    {onMarkDelivered && !['DELIVERED', 'CANCELLED'].includes(r.status) && (
                      <>
                        {needsCode && canDeliverRound(r.status) && (
                          <div className="mt-2">
                            <label className="block text-xs font-bold text-slate-700" htmlFor={`waiter-delivery-code-${r.id}`}>
                              Código de entrega (4 dígitos do cliente)
                            </label>
                            <input
                              id={`waiter-delivery-code-${r.id}`}
                              data-testid={`waiter-delivery-code-${r.id}`}
                              inputMode="numeric"
                              maxLength={4}
                              value={codeVal}
                              onChange={e => setDeliveryCodes(prev => ({ ...prev, [r.id]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                              placeholder="Ex.: 1234"
                              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-base font-bold tracking-widest text-slate-900"
                            />
                          </div>
                        )}
                        <button
                          type="button"
                          title={canDeliverRound(r.status) ? undefined : 'Aguardando balcão'}
                          disabled={!!busy || !canDeliverRound(r.status) || (needsCode && codeVal.length !== 4)}
                          onClick={() => needsCode ? onMarkDelivered(r.id, codeVal) : onMarkDelivered(r.id)}
                          className={`${btn} mt-3 w-full`}
                          style={{ backgroundColor: statusColorTokens('DELIVERED').solid, color: '#fff' }}
                        >
                          <Check className="h-4 w-4" aria-hidden="true" />Entregue
                        </button>
                      </>
                    )}
                    {onMarkDelivered && !['DELIVERED', 'CANCELLED'].includes(r.status) && !canDeliverRound(r.status) && <p className="mt-1 text-xs text-slate-500">Aguardando balcão</p>}
                  </div>
                );
              })}
            </div>

            {joinedTables.length > 1 && (
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3" data-testid="waiter-joined-tables">
                <h3 className="text-sm font-black text-slate-800">Mesas juntas nesta conta ({joinedTables.map(t => t.label).join(' + ')})</h3>
                <div className="flex flex-wrap gap-2">
                  {joinedTables.map(jt => (
                    <div key={jt.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800">
                      <span>{jt.label}</span>
                      {onSeparateTable && (
                        <button
                          type="button"
                          disabled={!!busy}
                          data-testid={`waiter-separate-table-${jt.id}`}
                          onClick={() => onSeparateTable(jt.id)}
                          className="rounded-lg bg-rose-50 px-2 py-0.5 text-[11px] font-black text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                        >
                          Separar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tableMoves.length > 0 && (
              <div className="space-y-1.5 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700" data-testid="waiter-table-moves">
                <h3 className="font-black text-slate-800">Histórico de mesas</h3>
                <ul className="space-y-1">
                  {tableMoves.map(m => (
                    <li key={m.id}>
                      <b>{m.from_label} → {m.to_label}</b> ({m.action === 'JOIN' ? 'Juntou' : m.action === 'SEPARATE' ? 'Separou' : 'Mudou'})
                      {m.actor_name ? ` · ${m.actor_name}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 pb-2">
              <button type="button" disabled={!!busy || tab.status !== 'OPEN'} onClick={onOrder} className={`${btn} bg-slate-900 text-white`}><Plus className="h-4 w-4" />Lançar pedido</button>
              {isEmptyTab && onReleaseEmptyTab ? (
                <button
                  type="button"
                  data-testid="waiter-release-empty-btn"
                  disabled={!!busy}
                  onClick={() => setReleaseEmptyOpen(true)}
                  className={`${btn} border border-rose-200 bg-rose-50 text-rose-800`}
                >
                  Liberar mesa (sem consumo)
                </button>
              ) : canCollect ? (
                <button
                  type="button"
                  data-testid="waiter-close-tab-btn"
                  disabled={!!busy}
                  onClick={focusBillClosing}
                  className={`${btn} bg-[#9B4DE0] text-white`}
                  style={{ backgroundColor: '#9B4DE0', color: '#FFFFFF' }}
                >
                  <Receipt className="h-4 w-4" />{tab.status === 'AWAITING_PAYMENT' ? 'Ver pagamento pendente' : 'Fechar conta'}
                </button>
              ) : <span />}
            </div>
            {releaseEmptyOpen && onReleaseEmptyTab && (
              <div role="alertdialog" aria-label="Liberar mesa sem consumo" data-testid="waiter-release-empty-dialog" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-slate-900">
                <p className="font-black text-rose-900">Liberar {table.label} sem consumo?</p>
                <p className="mt-1 text-xs text-slate-700">A comanda será encerrada como cancelada (R$ 0,00) e a mesa voltará para Livre.</p>
                <label className="mt-3 block text-xs font-bold text-slate-700">
                  Motivo (opcional)
                  <select
                    aria-label="Motivo para liberar a mesa"
                    value={releaseEmptyReason}
                    onChange={e => setReleaseEmptyReason(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"
                  >
                    <option value="Cliente desistiu">Cliente desistiu</option>
                    <option value="Aberta por engano">Aberta por engano</option>
                    <option value="Outro">Outro</option>
                  </select>
                </label>
                {releaseEmptyReason === 'Outro' && (
                  <input
                    aria-label="Descreva o motivo"
                    value={releaseEmptyCustomReason}
                    onChange={e => setReleaseEmptyCustomReason(e.target.value)}
                    placeholder="Descreva o motivo (opcional)"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setReleaseEmptyOpen(false)} className={`${btn} border border-slate-200 bg-white text-slate-700`}>Voltar</button>
                  <button
                    type="button"
                    data-testid="waiter-release-empty-confirm"
                    disabled={!!busy}
                    onClick={() => {
                      const finalReason = releaseEmptyReason === 'Outro' ? (releaseEmptyCustomReason.trim() || 'Outro') : releaseEmptyReason;
                      setReleaseEmptyOpen(false);
                      onReleaseEmptyTab(finalReason);
                    }}
                    className={`${btn} bg-rose-600 text-white`}
                  >
                    Confirmar liberação
                  </button>
                </div>
              </div>
            )}
            <p className="pb-2 text-center text-xs text-slate-500">O cliente ou o caixa pede a conta. O garçom só cobra depois da autorização do caixa.</p>
          </>)}
        </div>
      </section>
    </div>
  );
};
