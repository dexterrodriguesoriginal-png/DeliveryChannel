import React, { useState } from 'react';
import { BellRing, Check, Clock, Crown, Plus, Receipt, UserCheck, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { formatBRL } from '../../lib/pricing/money';
import { inviteUrl } from '../../lib/customer/tableAccess';
import type { TableStatusInfo } from '../../lib/salon/tableStatus';
import type { StaffHolderCode, WaiterCallRow, WaiterRound, WaiterSession, WaiterTab, WaiterTable } from '../../repositories/salonStaffRepository';
import { callTitle, type WaiterFeatures } from './waiterLogic';

const roundStatus = (s: string) => s === 'CONFIRMED' ? 'Recebido' : s === 'PREPARING' ? 'Preparando' : s === 'READY' ? 'Pronto' : s === 'DELIVERED' ? 'Entregue' : s;
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
  onRequestBill: () => void;
  onResetHolder: () => void;
  onChangeHolder?: () => void;
  onReleaseEmptyTab?: (reason: string) => void;
  onTransferHolder: (sessionId: string) => void;
}> = ({ table, tab, info, sessions, calls, rounds, holderSessionId, holderCode, tenantSlug, features, busy, message, onClose, onApprove, onReject, onHandleCall, onOpenTable, onOrder, onRequestBill, onResetHolder, onChangeHolder, onReleaseEmptyTab, onTransferHolder }) => {
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [releaseEmptyOpen, setReleaseEmptyOpen] = useState(false);
  const [releaseEmptyReason, setReleaseEmptyReason] = useState('Cliente desistiu');
  const [releaseEmptyCustomReason, setReleaseEmptyCustomReason] = useState('');
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
          {message && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{message}</p>}
          {!tab ? (
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              <p>Mesa livre, sem comanda aberta.</p>
              {features.openTable
                ? <button type="button" disabled={!!busy} onClick={onOpenTable} className={`${btn} mt-3 w-full bg-slate-900 text-white`}><Plus className="h-4 w-4" />Abrir mesa para o cliente</button>
                : <p className="mt-2 text-xs text-slate-500">Abrir a mesa pelo garçom chega com a próxima atualização do sistema. Enquanto isso, o cliente abre lendo o QR.</p>}
            </div>
          ) : (<>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Total</p><p className="text-lg font-black">{formatBRL(info.totalCents / 100)}</p></div>
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Pessoas</p><p className="text-lg font-black">{sessions.length}</p></div>
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Rodadas</p><p className="text-lg font-black">{rounds.length}</p></div>
            </div>

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
                {calls.map(c => <div key={c.id} className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3"><span className="font-bold">{callTitle(c.type)}</span><button type="button" disabled={!!busy} onClick={() => onHandleCall(c.id)} className={`${btn} h-11 bg-white text-slate-900 border border-slate-200`}><Check className="h-4 w-4" />Atendido</button></div>)}
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
              {rounds.map(r => <div key={r.id} className="rounded-2xl border border-slate-200 p-3"><div className="flex justify-between gap-2 font-bold"><span>Rodada {r.round_no} · #{r.order_number}</span><span>{formatBRL(Number(r.subtotal))}</span></div><p className="mt-0.5 text-sm text-slate-600">{r.customer_name} · {roundStatus(r.status)}</p><p className="text-xs text-slate-400"><Clock className="mr-1 inline h-3 w-3" />{new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p></div>)}
            </div>

            <div className="grid grid-cols-2 gap-2 pb-2">
              <button type="button" onClick={onOrder} className={`${btn} bg-slate-900 text-white`}><Plus className="h-4 w-4" />Lançar pedido</button>
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
              ) : features.requestBill ? (
                <button type="button" disabled={!!busy || tab.status === 'BILL_REQUESTED'} onClick={onRequestBill} className={`${btn} border border-violet-200 bg-violet-50 text-violet-800`}><Receipt className="h-4 w-4" />{tab.status === 'BILL_REQUESTED' ? 'Conta pedida' : 'Pedir a conta'}</button>
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
            <p className="pb-2 text-center text-xs text-slate-400">O fechamento e o pagamento da conta são feitos no painel (Salão) pelo caixa.</p>
          </>)}
        </div>
      </section>
    </div>
  );
};
