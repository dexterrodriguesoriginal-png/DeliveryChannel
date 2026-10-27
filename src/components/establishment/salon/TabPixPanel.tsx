import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertTriangle, CheckCircle2, Copy, Loader2, QrCode, RefreshCw, XCircle } from 'lucide-react';
import { formatBRL } from '../../../lib/pricing/money';
import { paymentRepository, type TabPix } from '../../../repositories/paymentRepository';
import './salon.css';

export const PIX_POLL_MS = 4000;

export interface TabPixPanelProps {
  tabId: string;
  totalCents: number;
  /** a PIX is live (QR on screen): the parent blocks manual closing so the customer can't pay twice */
  onLiveChange: (live: boolean) => void;
  /** the PIX was confirmed by the provider and the tab is closed on the server */
  onSettled: () => void;
}

type View = { kind: 'idle' } | { kind: 'loading' } | { kind: 'pix'; pix: TabPix } | { kind: 'error'; message: string };

export function pixSecondsLeft(expiresAt: string | null, now: number): number | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : null;
}
export const mmss = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

export const TabPixPanel: React.FC<TabPixPanelProps> = ({ tabId, totalCents, onLiveChange, onSettled }) => {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const settledRef = useRef(false);
  const alive = useRef(true);
  // Callbacks live in refs so a parent re-render can never restart polling.
  const liveRef = useRef(onLiveChange); liveRef.current = onLiveChange;
  const settledCb = useRef(onSettled); settledCb.current = onSettled;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const apply = useCallback((pix: TabPix | null) => {
    if (!alive.current) return;
    setView(pix ? { kind: 'pix', pix } : { kind: 'idle' });
    liveRef.current(!!pix && pix.status === 'pending' && (!pix.expiresAt || Date.parse(pix.expiresAt) > Date.now()));
    if (pix && pix.status === 'paid' && pix.tabClosed && !settledRef.current) {
      settledRef.current = true;
      window.setTimeout(() => { if (alive.current) settledCb.current(); }, 1800);
    }
  }, []);

  // Show a charge that already exists (created earlier / on another device) without creating a new one.
  useEffect(() => {
    let cancelled = false;
    void paymentRepository.tabPixStatus(tabId)
      .then(r => { if (!cancelled) apply(r.pix && ['pending', 'paid'].includes(r.pix.status) ? r.pix : null); })
      .catch(() => { if (!cancelled) setView({ kind: 'idle' }); });
    return () => { cancelled = true; liveRef.current(false); };
  }, [tabId, apply]);

  const pix = view.kind === 'pix' ? view.pix : null;
  const polling = !!pix && pix.status === 'pending';
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void paymentRepository.tabPixStatus(tabId).then(r => apply(r.pix)).catch(() => { /* transient: keep polling */ });
    }, PIX_POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, tabId, apply]);
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [polling]);

  const generate = async () => {
    setView({ kind: 'loading' }); setCopied(false);
    try { apply((await paymentRepository.createTabPix(tabId)).pix); }
    catch (error) { setView({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível gerar o PIX.' }); liveRef.current(false); }
  };
  const cancel = async () => {
    try { await paymentRepository.cancelTabPix(tabId); apply(null); }
    catch (error) { setView({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível cancelar o PIX.' }); }
  };
  const copy = async () => {
    if (!pix?.brcode) return;
    try { await navigator.clipboard.writeText(pix.brcode); setCopied(true); window.setTimeout(() => setCopied(false), 2200); } catch { /* clipboard blocked */ }
  };

  const left = pix ? pixSecondsLeft(pix.expiresAt, now) : null;
  const expired = !!pix && pix.status === 'pending' && left === 0;

  return (
    <section aria-label="Pagar com PIX (Mercado Pago)" className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4" data-testid="tab-pix-panel">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-700 text-white"><QrCode className="h-5 w-5" aria-hidden="true" /></span>
        <div><h3 className="text-sm font-black text-slate-900">PIX da conta · Mercado Pago</h3><p className="text-xs text-slate-600">O cliente paga no celular e a mesa é liberada sozinha.</p></div>
      </div>

      {view.kind === 'loading' && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Preparando…</p>}

      {view.kind === 'error' && <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-900"><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{view.message}</div>}

      {(view.kind === 'idle' || view.kind === 'error' || expired || (pix && ['expired', 'cancelled', 'failed'].includes(pix.status))) && (
        <button type="button" onClick={() => void generate()} disabled={totalCents <= 0}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 font-extrabold text-white shadow-sm transition hover:bg-teal-800 active:scale-[.99] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
          {expired || (pix && pix.status !== 'pending') ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <QrCode className="h-4 w-4" aria-hidden="true" />}
          {expired || (pix && pix.status !== 'pending') ? 'Gerar novo QR PIX' : `Gerar QR PIX de ${formatBRL(totalCents / 100)}`}
        </button>
      )}

      {pix && pix.status === 'pending' && !expired && pix.brcode && (
        <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <div className="rounded-2xl bg-white p-3 shadow-[0_8px_24px_-12px_rgba(15,118,110,.6)] ring-1 ring-teal-100" data-testid="tab-pix-qr">
            <QRCodeSVG value={pix.brcode} size={196} level="M" marginSize={1} title="QR Code PIX da conta" />
          </div>
          <div className="w-full min-w-0 space-y-2 text-center sm:text-left">
            <p className="text-2xl font-black tabular-nums text-slate-900">{formatBRL(pix.amountCents / 100)}</p>
            <p role="status" className="flex items-center justify-center gap-2 text-sm font-bold text-teal-900 sm:justify-start"><Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />Aguardando o pagamento…</p>
            {left !== null && <p className="text-xs font-semibold tabular-nums text-slate-600">Expira em {mmss(left)}</p>}
            <button type="button" onClick={() => void copy()} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-teal-300 bg-white px-3 text-sm font-extrabold text-teal-900 transition hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
              {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{copied ? 'Código copiado' : 'Copiar PIX copia e cola'}
            </button>
            <button type="button" onClick={() => void cancel()} className="min-h-10 w-full rounded-xl px-3 text-sm font-bold text-slate-600 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-700">Cancelar este PIX (pagar no caixa)</button>
          </div>
        </div>
      )}

      {pix && pix.status === 'paid' && pix.tabClosed && (
        <div role="status" className="mt-4 flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-900"><CheckCircle2 className="h-8 w-8 shrink-0" aria-hidden="true" /><div><p className="font-black">Pagamento confirmado!</p><p className="text-sm">Conta fechada e mesa liberada.</p></div></div>
      )}
      {pix && pix.status === 'paid' && !pix.tabClosed && (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-amber-950"><AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" /><div><p className="font-black">PIX de {formatBRL(pix.amountCents / 100)} recebido — confira</p><p className="text-sm">{pix.reviewReason || 'O total da conta mudou depois do PIX.'}. A conta continua aberta: feche pelo caixa informando o PIX já recebido como parte do pagamento.</p></div></div>
      )}
    </section>
  );
};
