import React, { useCallback, useEffect, useState } from 'react';
import { ChefHat, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { kitchenClient } from '../../lib/kitchen/kitchenClient';
import { kitchenRepository, type KitchenContext } from '../../repositories/kitchenRepository';
import { formatPairCode, normalizePairCode, pairCodeFromHash, kitchenErrorMessage, kitchenErrorCode } from '../../lib/kitchen/kitchenBoard';
import { KitchenBoard } from './KitchenBoard';
import { BRAND_ACTION } from '../../utils/orderStatusTheme';

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
    <div className="max-w-md w-full bg-white rounded-3xl p-6 shadow-xl space-y-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center mx-auto"><ChefHat className="w-7 h-7" /></div>
      {children}
    </div>
  </div>
);

/** /cozinha/parear#c=CÓDIGO — o tablet lê o QR do painel e vira a Tela da Cozinha da loja. */
export const KitchenPairPage: React.FC = () => {
  const [code, setCode] = useState(() => pairCodeFromHash(typeof window !== 'undefined' ? window.location.hash : ''));
  const [name, setName] = useState('Tablet da cozinha');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await kitchenRepository.ensureDeviceSession();
      try { await kitchenRepository.redeem(normalizePairCode(code), name.trim() || 'Cozinha'); }
      catch (e) {
        if (kitchenErrorCode(e) !== 'KITCHEN_DEVICE_REVOKED') throw e;
        await kitchenRepository.resetDeviceSession(); await kitchenRepository.ensureDeviceSession();
        await kitchenRepository.redeem(normalizePairCode(code), name.trim() || 'Cozinha');
      }
      try { history.replaceState(null, '', '/cozinha'); } catch { /* ok */ }
      window.location.replace('/cozinha');
    } catch (e) { setErr(kitchenErrorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h1 className="text-xl font-black text-gray-950">Conectar Tela da Cozinha</h1>
      <p className="text-sm text-gray-600">Este aparelho vai mostrar só os pedidos para preparar. Sem preços nem dados de clientes.</p>
      <input value={formatPairCode(code)} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX" aria-label="Código"
        className="w-full text-center text-3xl font-black tracking-widest border-2 rounded-xl py-3 uppercase" data-testid="pair-code" />
      <input value={name} onChange={e => setName(e.target.value.slice(0, 40))} aria-label="Nome do aparelho" className="w-full border rounded-xl px-3 py-2" />
      {err && <p className="text-sm text-red-700 font-semibold" role="alert">{err}</p>}
      <button type="button" disabled={busy || normalizePairCode(code).length !== 8} onClick={submit} data-testid="pair-submit"
        className="w-full min-h-12 rounded-xl font-black disabled:opacity-50" style={{ backgroundColor: BRAND_ACTION.bg, color: BRAND_ACTION.text }}>{busy ? 'Conectando…' : 'Conectar'}</button>
    </Shell>
  );
};

const PinPad: React.FC<{ storeName: string; onUnlocked: () => void }> = ({ storeName, onUnlocked }) => {
  const [pin, setPin] = useState(''); const [err, setErr] = useState<string | null>(null);
  const go = async (p: string) => { try { await kitchenRepository.unlock(p); onUnlocked(); } catch (e) { setErr(kitchenErrorMessage(e)); setPin(''); } };
  const press = (d: string) => { const p = (pin + d).slice(0, 4); setPin(p); setErr(null); if (p.length === 4) go(p); };
  return (
    <Shell>
      <h1 className="text-xl font-black text-gray-950 flex items-center justify-center gap-2"><Lock className="w-5 h-5" />Cozinha · {storeName}</h1>
      <p className="text-sm text-gray-600">Digite o PIN da cozinha.</p>
      <div className="text-4xl tracking-[0.5em] font-black h-12" data-testid="pin-dots">{'●'.repeat(pin.length)}{'○'.repeat(4 - pin.length)}</div>
      {err && <p className="text-sm text-red-700 font-semibold" role="alert">{err}</p>}
      <div className="grid grid-cols-3 gap-2">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => d === '' ? <span key={i} /> : (
          <button key={i} type="button" onClick={() => d === '⌫' ? setPin(pin.slice(0, -1)) : press(d)} className="min-h-14 rounded-xl bg-gray-100 text-2xl font-black">{d}</button>
        ))}
      </div>
    </Shell>
  );
};

/** /cozinha — aparelho pareado (login anônimo próprio) ou equipe logada da loja ativa. */
export const KitchenPage: React.FC = () => {
  const { activeTenant, activeRole } = useAuth() as any;
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ctx'; ctx: KitchenContext } | { kind: 'msg'; text: string; repair?: boolean } | { kind: 'none' }>({ kind: 'loading' });
  const load = useCallback(async () => {
    try {
      if (await kitchenRepository.hasDeviceSession()) { setState({ kind: 'ctx', ctx: await kitchenRepository.context(kitchenClient()) }); return; }
      if (activeTenant?.id && ['OWNER', 'MANAGER', 'OPERATOR', 'CASHIER'].includes(activeRole)) {
        setState({ kind: 'ctx', ctx: await kitchenRepository.context(supabase, activeTenant.id) }); return;
      }
      setState({ kind: 'none' });
    } catch (e) {
      const c = kitchenErrorCode(e);
      setState({ kind: 'msg', text: kitchenErrorMessage(e), repair: c === 'KITCHEN_DEVICE_REVOKED' || c === 'NOT_PAIRED' });
    }
  }, [activeTenant?.id, activeRole]);
  useEffect(() => { load(); }, [load]);

  if (state.kind === 'loading') return <Shell><p className="text-gray-500">Carregando…</p></Shell>;
  if (state.kind === 'none') return (
    <Shell><h1 className="text-xl font-black">Tela da Cozinha</h1>
      <p className="text-sm text-gray-600">Para usar um tablet só da cozinha, peça ao dono para abrir <b>Tela da Cozinha → Conectar aparelho</b> no painel e leia o QR com este aparelho.</p>
      <a href="/" className="inline-block text-sm font-bold text-blue-700 underline">Entrar com minha conta</a></Shell>
  );
  if (state.kind === 'msg') return (
    <Shell><h1 className="text-xl font-black">Tela da Cozinha</h1><p className="text-sm text-gray-700 font-semibold" role="alert">{state.text}</p>
      {state.repair && <button type="button" className="text-sm font-bold text-blue-700 underline" onClick={async () => { await kitchenRepository.resetDeviceSession(); setState({ kind: 'none' }); }}>Conectar de novo</button>}</Shell>
  );
  const ctx = state.ctx;
  if (ctx.locked) return <PinPad storeName={ctx.store_name} onUnlocked={load} />;
  return (
    <KitchenBoard client={ctx.mode === 'device' ? kitchenClient() : supabase} tenantId={ctx.tenant_id} storeName={ctx.store_name} deviceName={ctx.device_name}
      mode={ctx.mode} canLock={ctx.mode === 'device' && ctx.pin_required} onLocked={load}
      onFatal={(code, text) => code === 'KITCHEN_LOCKED' ? load() : setState({ kind: 'msg', text, repair: code === 'KITCHEN_DEVICE_REVOKED' || code === 'NOT_PAIRED' })} />
  );
};
