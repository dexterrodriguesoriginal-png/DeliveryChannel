import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CircleUserRound, Loader2, Minus, Plus, ReceiptText, Utensils, UserRound, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { publicStoreRepository } from '../../repositories/publicStoreRepository';
import { formatBRL } from '../../lib/pricing/money';
import type { Product, SelectedProductOption } from '../../types';
import { billSplitAmounts, BillSplitMode, DineInPaymentMethod, parseTenderCents, tenderStatus } from '../../lib/customer/dineIn';
import { tenantModuleRepository } from '../../repositories/tenantModuleRepository';
import { productOptionRepository } from '../../repositories/productOptionRepository';
import { isModuleEnabled } from '../../lib/modules';
import { optionPriceCents, validateOptionSelection } from '../../lib/addons';
import { ProductOptionsSelector } from '../../components/client/customer/ProductOptionsSelector';
import {
  addDineInCartLine,
  changeDineInCartLineQuantity,
  dineInCartLineUnitPriceCents,
  dineInOptionLabels,
  dineInRoundItems,
  type DineInCartLine,
} from '../../lib/customer/dineInCart';

type TableResolution = { available: boolean; tenantSlug?: string; storeName?: string; tableLabel?: string };
type TabRound = { orderId: string; orderNumber: number; roundNo: number; status: string; customerName: string; subtotal: number; createdAt: string; items: Array<{ name: string; quantity: number; unitPrice: number; totalPrice: number }> };
type MyTab = { tabId: string; status: 'OPEN' | 'BILL_REQUESTED' | 'CLOSED' | 'CANCELLED'; mode: 'TABLE' | 'INDIVIDUAL'; tableLabel: string; serviceFeePercent: number; serviceFeeRemoved: boolean; rounds: TabRound[]; subtotal: number };

const DEVICE_KEY = 'dc_dine_in_device_id';
const SESSION_KEY_PREFIX = 'dc_dine_in_session:';
const APPROVAL_RETRY_MS = 5000;

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return uuid();
  }
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message || '');
  return String(error || '');
}

function isProviderDisabled(error: unknown): boolean {
  return /anonymous.*(disabled|not enabled)|provider.*(disabled|not enabled)|anonymous sign-ins? (are )?disabled|signup is disabled/i.test(errorText(error));
}

function isMissingBillChoiceSignature(error: { code?: string; message?: string }): boolean {
  return ['PGRST202', '42883'].includes(error.code || '') && /request_bill|function/i.test(error.message || '');
}

const paymentChoices: Array<{ value: DineInPaymentMethod; label: string }> = [
  { value: 'CAIXA', label: 'Pagar no caixa' },
  { value: 'CARD', label: 'Maquininha na mesa (débito/crédito)' },
  { value: 'CASH', label: 'Dinheiro' },
  { value: 'PIX', label: 'PIX na mesa' },
];

export const DineInClientApp: React.FC<{ token: string }> = ({ token }) => {
  const { supabaseUser } = useAuth();
  const [resolution, setResolution] = useState<TableResolution | null>(null);
  const [storeName, setStoreName] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState(() => {
    try { return localStorage.getItem('adegafood_cust_name')?.trim().split(/\s+/)[0] || ''; } catch { return ''; }
  });
  const [sessionId, setSessionId] = useState('');
  const [tab, setTab] = useState<MyTab | null>(null);
  const [cart, setCart] = useState<DineInCartLine[]>([]);
  const [optionsProduct, setOptionsProduct] = useState<Product | null>(null);
  const [optionChoices, setOptionChoices] = useState<SelectedProductOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingApproval, setPendingApproval] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<DineInPaymentMethod>('CAIXA');
  const [tendered, setTendered] = useState('');
  const [splitParts, setSplitParts] = useState('2');
  const [splitMode, setSplitMode] = useState<BillSplitMode>('ALL');
  const [customShare, setCustomShare] = useState('');
  const [notice, setNotice] = useState('');
  const [tabClosed, setTabClosed] = useState(false);
  const deviceIdRef = useRef('');
  const submitKeyRef = useRef(uuid());
  const submitLockRef = useRef(false);
  const openedUserRef = useRef('');

  const subtotalCents = Math.round((tab?.subtotal || 0) * 100);
  const serviceFeeCents = tab && !tab.serviceFeeRemoved
    ? Math.round(subtotalCents * tab.serviceFeePercent / 100)
    : 0;
  const accountTotalCents = subtotalCents + serviceFeeCents;
  const cashTenderStatus = tenderStatus(accountTotalCents, parseTenderCents(tendered));
  const orderingDisabled = pendingApproval || tabClosed || tab?.status === 'BILL_REQUESTED';
  const split = useMemo(() => {
    const customCents = parseTenderCents(customShare) || 0;
    try { return billSplitAmounts(accountTotalCents, splitMode, Number(splitParts), customCents); } catch { return []; }
  }, [accountTotalCents, splitMode, splitParts, customShare]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setResolution(null);
    setError('');
    void (async () => {
      if (!isSupabaseConfigured) {
        if (alive) setError('Este QR Code não está disponível agora. Peça ajuda a um atendente.');
        return;
      }
      const { data, error: resolveError } = await supabase.rpc('resolve_table_qr', { p_qr_token: token });
      if (!alive) return;
      if (resolveError) {
        setError('Não foi possível verificar esta mesa. Confira sua conexão ou peça ajuda a um atendente.');
        return;
      }
      const result = data as TableResolution | null;
      if (!result?.available || !result.tenantSlug) {
        setResolution({ available: false });
        setError('Salão indisponível no momento. Confira o QR Code ou chame um atendente.');
        return;
      }
      setResolution(result);
      try {
        const store = await publicStoreRepository.loadPublicStore(result.tenantSlug);
        if (!alive) return;
        if (store.status !== 'ok') {
          setError('Não foi possível carregar o cardápio desta mesa. Tente novamente ou chame um atendente.');
          return;
        }
        const enabledModules = await tenantModuleRepository.getPublicEnabled(store.data.tenant.id);
        const optionGroups = isModuleEnabled(enabledModules, 'addons')
          ? await productOptionRepository.getPublicForProducts(store.data.tenant.id, store.data.products.map(product => product.id))
          : new Map();
        setStoreName(result.storeName || store.data.tenant.name);
        setProducts(store.data.products
          .filter(product => product.isActive && product.isAvailable)
          .map(product => ({ ...product, optionGroups: optionGroups.get(product.id) || [] })));
      } catch (loadError) {
        if (alive) setError(errorText(loadError) || 'Não foi possível carregar o cardápio desta mesa. Tente novamente ou chame um atendente.');
      } finally {
        if (alive) setLoading(false);
      }
    })().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    deviceIdRef.current = deviceId();
    try {
      const cached = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${token}`);
      if (cached) setSessionId(cached);
    } catch { /* storage may be unavailable */ }
  }, [token]);

  const openOrJoin = useCallback(async () => {
    if (!supabaseUser || !resolution?.available || !firstName.trim() || !deviceIdRef.current) return;
    if (openedUserRef.current === supabaseUser.id) return;
    openedUserRef.current = supabaseUser.id;
    setBusy(true);
    setNotice('');
    const { data, error: openError } = await supabase.rpc('open_or_join_tab', {
      p_qr_token: token,
      p_display_name: firstName.trim().split(/\s+/)[0],
      p_device_id: deviceIdRef.current,
    });
    if (openError || !data?.sessionId) {
      openedUserRef.current = '';
      setNotice(errorText(openError) || 'Não foi possível abrir sua comanda.');
      setBusy(false);
      return;
    }
    const id = String(data.sessionId);
    setSessionId(id);
    try { sessionStorage.setItem(`${SESSION_KEY_PREFIX}${token}`, id); } catch { /* best effort */ }
    setNotice('');
    setBusy(false);
  }, [firstName, resolution?.available, supabaseUser, token]);

  useEffect(() => {
    if (supabaseUser && resolution?.available && firstName.trim()) void openOrJoin();
  }, [supabaseUser, resolution?.available, firstName, openOrJoin]);

  const loadAccount = useCallback(async (silent = false) => {
    if (!sessionId) return;
    if (!silent) setBusy(true);
    const { data, error: accountError } = await supabase.rpc('get_my_tab', { p_session_id: sessionId });
    if (accountError) {
      const message = errorText(accountError);
      if (/TAB_CLOSED|comanda encerrada/i.test(message)) {
        setTabClosed(true);
        setTab(current => current ? { ...current, status: 'CLOSED' } : current);
      } else if (!silent) setNotice(message || 'Não foi possível atualizar a conta.');
    } else if (data) {
      setTab(data as MyTab);
      if ((data as MyTab).status === 'CLOSED' || (data as MyTab).status === 'CANCELLED') setTabClosed(true);
    }
    if (!silent) setBusy(false);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    void loadAccount(true);
    const interval = window.setInterval(() => void loadAccount(true), 15000);
    return () => window.clearInterval(interval);
  }, [sessionId, loadAccount]);

  const submitRound = useCallback(async () => {
    if (!sessionId || cart.length === 0 || submitLockRef.current || tabClosed) return;
    submitLockRef.current = true;
    setBusy(true);
    setNotice('');
    const items = dineInRoundItems(cart);
    const { data, error: submitError } = await supabase.rpc('submit_round', {
      p_items: items,
      p_idempotency_key: submitKeyRef.current,
      p_session_id: sessionId,
      p_tab_id: null,
    });
    submitLockRef.current = false;
    setBusy(false);
    if (submitError) {
      const message = errorText(submitError);
      if (/SESSION_NOT_APPROVED/i.test(message)) {
        setPendingApproval(true);
        setNotice('Aguardando o garçom liberar sua mesa. Tentaremos enviar novamente em 5 segundos.');
      } else if (/TAB_CLOSED/i.test(message)) {
        setTabClosed(true);
        setNotice('Conta encerrada. Para pedir de novo, chame o garçom.');
      } else {
        setNotice(message || 'Não foi possível enviar sua rodada. Tente novamente.');
      }
      return;
    }
    if (data) {
      setPendingApproval(false);
      setCart([]);
      submitKeyRef.current = uuid();
      setNotice('Pedido enviado para a cozinha!');
      await loadAccount(true);
    }
  }, [cart, loadAccount, sessionId, tabClosed]);

  useEffect(() => {
    if (!pendingApproval || tabClosed) return;
    const retry = window.setInterval(() => void submitRound(), APPROVAL_RETRY_MS);
    return () => window.clearInterval(retry);
  }, [pendingApproval, submitRound, tabClosed]);

  const addItem = (product: Product) => {
    if (product.optionGroups?.some(group => group.active)) {
      setOptionsProduct(product);
      setOptionChoices([]);
      return;
    }
    setCart(current => addDineInCartLine(current, product));
  };
  const addConfiguredItem = () => {
    if (!optionsProduct) return;
    const groups = optionsProduct.optionGroups?.filter(group => group.active) || [];
    const validation = validateOptionSelection(groups, optionChoices);
    if (!validation.valid) {
      setNotice(validation.messages[0] || 'Confira os adicionais selecionados.');
      return;
    }
    setCart(current => addDineInCartLine(current, optionsProduct, optionChoices));
    setOptionsProduct(null);
    setOptionChoices([]);
    setNotice('');
  };
  const changeQuantity = (productId: string, delta: number) => setCart(current => {
    const line = [...current].reverse().find(item => item.product.id === productId);
    return line ? changeDineInCartLineQuantity(current, line.key, delta) : current;
  });
  const changeLineQuantity = (key: string, delta: number) =>
    setCart(current => changeDineInCartLineQuantity(current, key, delta));

  const enterAsGuest = async () => {
    const name = firstName.trim().split(/\s+/)[0];
    if (!name) { setNotice('Informe seu primeiro nome para continuar.'); return; }
    setFirstName(name);
    try { localStorage.setItem('adegafood_cust_name', name); } catch { /* best effort */ }
    setAuthBusy(true);
    setNotice('');
    const { error: authError } = await supabase.auth.signInAnonymously({ options: { data: { display_name: name, full_name: name } } });
    setAuthBusy(false);
    if (authError) {
      if (isProviderDisabled(authError)) {
        setShowLogin(true);
        setNotice('Entre com sua conta para pedir na mesa.');
      } else {
        setNotice(`Não foi possível continuar como visitante. ${errorText(authError)}`);
      }
    }
  };

  const loginWithPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthBusy(true);
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setAuthBusy(false);
    if (loginError) setNotice(errorText(loginError));
    else setNotice('');
  };

  const loginWithGoogle = async (link = false) => {
    const name = firstName.trim().split(/\s+/)[0];
    if (!name) {
      setNotice('Informe seu primeiro nome para continuar.');
      return;
    }
    setFirstName(name);
    try { localStorage.setItem('adegafood_cust_name', name); } catch { /* best effort */ }
    setAuthBusy(true);
    const redirectTo = window.location.href;
    const result = link
      ? await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo } })
      : await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    setAuthBusy(false);
    if (result.error) setNotice(errorText(result.error));
  };

  const requestWaiter = async () => {
    if (!sessionId) return;
    setBusy(true);
    const { error: callError } = await supabase.rpc('call_waiter', { p_session_id: sessionId, p_type: 'CALL' });
    setBusy(false);
    setNotice(callError ? errorText(callError) : 'Chamamos o garçom. Ele já vai até sua mesa.');
  };

  const requestBill = async () => {
    if (!sessionId) return;
    if (paymentMethod === 'CASH' && cashTenderStatus !== 'ok') {
      setNotice(cashTenderStatus === 'missing' ? 'Informe quanto vai pagar em dinheiro.' : 'O valor informado é menor que o total da conta.');
      return;
    }
    setBusy(true);
    let legacyFallback = false;
    let billResult = await supabase.rpc('request_bill', {
      p_session_id: sessionId,
      p_choice: paymentMethod,
      p_cash_tendered_cents: paymentMethod === 'CASH' ? parseTenderCents(tendered) : null,
    });
    if (billResult.error && isMissingBillChoiceSignature(billResult.error)) {
      legacyFallback = true;
      billResult = await supabase.rpc('request_bill', { p_session_id: sessionId });
    }
    setBusy(false);
    if (billResult.error) {
      const message = errorText(billResult.error);
      if (/TAB_CLOSED/i.test(message)) setTabClosed(true);
      setNotice(message || 'Não foi possível chamar o garçom para fechar a conta.');
      return;
    }
    setBillOpen(false);
    setTab(current => current ? { ...current, status: 'BILL_REQUESTED' } : current);
    setNotice(legacyFallback
      ? 'Solicitação enviada. Este salão ainda não registra a forma de pagamento escolhida.'
      : `Garçom chamado para fechar a conta. Preferência: ${paymentChoices.find(choice => choice.value === paymentMethod)?.label}.`);
  };

  const unavailable = !loading && (!resolution?.available || Boolean(error));
  const totalCartCents = cart.reduce((sum, line) => sum + dineInCartLineUnitPriceCents(line) * line.quantity, 0);
  const totalCart = totalCartCents / 100;

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-700"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando mesa e cardápio…</div>;
  if (unavailable) {
    return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><section className="max-w-sm rounded-3xl bg-white p-7 text-center shadow-xl"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-amber-600" /><h1 className="text-xl font-extrabold">Salão indisponível no momento</h1><p className="mt-2 text-sm text-slate-600">{error || 'Confira o QR Code ou chame um atendente.'}</p></section></main>;
  }

  if (!supabaseUser || !sessionId) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-xl">
          <div className="mb-5 flex items-center gap-3"><Utensils className="h-8 w-8 text-emerald-700" /><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{storeName}</p><h1 className="text-xl font-black">Mesa {resolution?.tableLabel}</h1></div></div>
          <h2 className="text-lg font-bold">Como podemos te chamar?</h2>
          <p className="mb-4 mt-1 text-sm text-slate-600">Informe seu primeiro nome para abrir sua comanda.</p>
          {!showLogin ? (
            <>
              <input aria-label="Seu primeiro nome" value={firstName} onChange={event => setFirstName(event.target.value)} autoComplete="given-name" className="w-full rounded-xl border border-slate-300 px-4 py-3" placeholder="Primeiro nome" />
              <button type="button" onClick={() => void enterAsGuest()} disabled={authBusy || !firstName.trim()} className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">{authBusy ? 'Conectando…' : 'Continuar como visitante'}</button>
              <button type="button" onClick={() => setShowLogin(true)} className="mt-3 w-full py-2 text-sm font-semibold text-emerald-800">Já tenho uma conta</button>
            </>
          ) : (
            <form onSubmit={loginWithPassword} className="space-y-3">
              <label className="block text-sm font-semibold">Seu primeiro nome<input aria-label="Seu primeiro nome" value={firstName} onChange={event => setFirstName(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
              <label className="block text-sm font-semibold">E-mail<input type="email" value={email} onChange={event => setEmail(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
              <label className="block text-sm font-semibold">Senha<input type="password" value={password} onChange={event => setPassword(event.target.value)} required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
              <button disabled={authBusy} className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">{authBusy ? 'Entrando…' : 'Entrar'}</button>
              <button type="button" onClick={() => void loginWithGoogle()} disabled={authBusy} className="w-full rounded-xl border border-slate-300 px-4 py-3 font-semibold">Continuar com Google</button>
              <button type="button" onClick={() => setShowLogin(false)} className="w-full py-2 text-sm text-slate-600">Voltar</button>
            </form>
          )}
          {notice && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-28">
      <header className="sticky top-0 z-20 border-b bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div><p className="font-extrabold">Você está na Mesa {tab?.tableLabel || resolution?.tableLabel} · {storeName}</p></div>
          <button type="button" onClick={() => { setAccountOpen(true); void loadAccount(); }} aria-label="Ver minha conta" className="rounded-full bg-slate-100 p-2"><CircleUserRound className="h-6 w-6" /></button>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-4 py-5">
        <h2 className="mb-3 text-lg font-black">Cardápio</h2>
        {products.length ? <div className="space-y-3">{products.map(product => {
          const quantity = cart.filter(line => line.product.id === product.id).reduce((sum, line) => sum + line.quantity, 0);
          return <article key={product.id} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
            {product.imageUrl && <img src={product.imageUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />}
            <div className="min-w-0 flex-1"><h3 className="font-bold">{product.name}</h3><p className="line-clamp-2 text-xs text-slate-500">{product.description}</p><p className="mt-1 font-bold">{formatBRL(product.price)}</p></div>
            <div className="flex items-center gap-2">
              {quantity > 0 && <button type="button" aria-label={`Remover ${product.name}`} onClick={() => changeQuantity(product.id, -1)} disabled={orderingDisabled || busy} className="rounded-full bg-slate-100 p-2 disabled:opacity-40"><Minus className="h-4 w-4" /></button>}
              {quantity > 0 && <span className="min-w-4 text-center font-bold">{quantity}</span>}
              <button type="button" aria-label={`Adicionar ${product.name}`} onClick={() => addItem(product)} disabled={orderingDisabled} className="rounded-full bg-emerald-700 p-2 text-white disabled:opacity-40"><Plus className="h-4 w-4" /></button>
            </div>
          </article>;
        })}</div> : <p className="rounded-xl bg-white p-4 text-sm text-slate-600">Nenhum item disponível no cardápio agora.</p>}
        {cart.length > 0 && <section className="mt-5 rounded-2xl border border-emerald-200 bg-white p-4">
          <h2 className="font-extrabold">Sua rodada</h2>
          {cart.map(line => {
            const optionLabels = dineInOptionLabels(line.product, line.options);
            return <div key={line.key} className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">{line.quantity}× {line.product.name}</p>
                {optionLabels.map(label => <p key={label} className="text-xs text-slate-500">{label}</p>)}
                <p className="text-xs text-slate-500">{formatBRL(dineInCartLineUnitPriceCents(line) / 100)} cada</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" aria-label={`Remover uma unidade de ${line.product.name}`} onClick={() => changeLineQuantity(line.key, -1)} disabled={orderingDisabled || busy} className="rounded-full bg-slate-100 p-1.5 disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                <span>{formatBRL(dineInCartLineUnitPriceCents(line) * line.quantity / 100)}</span>
                <button type="button" aria-label={`Adicionar uma unidade de ${line.product.name}`} onClick={() => changeLineQuantity(line.key, 1)} disabled={orderingDisabled || busy} className="rounded-full bg-slate-100 p-1.5 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
              </div>
            </div>;
          })}
          <div className="flex justify-between border-t pt-3 font-bold"><span>Subtotal estimado</span><span>{formatBRL(totalCart)}</span></div>
          <button type="button" onClick={() => void submitRound()} disabled={busy || orderingDisabled} className="mt-3 w-full rounded-xl bg-emerald-700 p-3 font-bold text-white disabled:opacity-50">{busy ? 'Enviando…' : 'Enviar para a cozinha'}</button>
          {pendingApproval && <p className="mt-2 text-xs font-semibold text-amber-800">Aguardando aprovação do garçom. A rodada será enviada automaticamente quando a mesa for liberada.</p>}
          {tab?.status === 'BILL_REQUESTED' && <p className="mt-2 text-xs font-semibold text-amber-800">A conta já foi solicitada. Chame o garçom se precisar reabrir a comanda.</p>}
        </section>}
        {optionsProduct && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOptionsProduct(null); }}>
          <section role="dialog" aria-modal="true" aria-label={`Personalizar ${optionsProduct.name}`} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-black">Personalizar {optionsProduct.name}</h2><p className="text-sm text-slate-500">Escolha os adicionais para este item.</p></div>
              <button type="button" onClick={() => { setOptionsProduct(null); setOptionChoices([]); }} aria-label="Fechar personalização"><X className="h-5 w-5" /></button>
            </div>
            <ProductOptionsSelector
              groups={optionsProduct.optionGroups || []}
              selections={optionChoices}
              onChange={setOptionChoices}
            />
            <p className="mt-3 text-right text-base font-black">
              {formatBRL((Math.round(optionsProduct.price * 100) + optionPriceCents(optionsProduct.optionGroups || [], optionChoices)) / 100)}
            </p>
            <button
              type="button"
              onClick={addConfiguredItem}
              disabled={!validateOptionSelection(optionsProduct.optionGroups || [], optionChoices).valid}
              className="mt-4 w-full rounded-xl bg-emerald-700 p-3 font-bold text-white disabled:opacity-50"
            >
              Adicionar à rodada
            </button>
          </section>
        </div>}
        {tabClosed && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Conta encerrada. Para pedir de novo, chame o garçom.</div>}
        {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      </section>

      <nav aria-label="Ações da mesa" className="fixed inset-x-0 bottom-0 z-30 border-t bg-white px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-[0_-6px_20px_rgba(15,23,42,.08)]">
        <div className="mx-auto grid max-w-2xl grid-cols-3 gap-2">
          <button type="button" onClick={() => void requestWaiter()} disabled={busy || tabClosed} className="flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-bold text-slate-800 disabled:opacity-40"><UserRound className="h-5 w-5" />Chamar garçom</button>
          <button type="button" onClick={() => { setBillOpen(true); void loadAccount(true); }} disabled={busy || tabClosed} className="flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-bold text-slate-800 disabled:opacity-40"><ReceiptText className="h-5 w-5" />Pedir a conta</button>
          <button type="button" onClick={() => { setAccountOpen(true); void loadAccount(); }} className="flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-bold text-slate-800"><CircleUserRound className="h-5 w-5" />Minha conta</button>
        </div>
      </nav>

      {accountOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAccountOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-label="Minha conta" className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-black">Minha conta</h2><button type="button" onClick={() => setAccountOpen(false)} aria-label="Fechar"><X /></button></div>
          <p className="text-sm text-slate-600">Mesa {tab?.tableLabel || resolution?.tableLabel} · {tab?.status === 'BILL_REQUESTED' ? 'Conta solicitada' : tab?.status === 'CLOSED' ? 'Encerrada' : 'Aberta'}</p>
          <div className="my-4 space-y-3">{tab?.rounds?.length ? tab.rounds.map(round => <article key={round.orderId} className="rounded-xl bg-slate-50 p-3">
            <div className="mb-2 flex justify-between font-bold"><span>Rodada {round.roundNo}</span><span>{formatBRL(round.subtotal)}</span></div>
            <p className="mb-2 text-xs text-slate-500">{round.customerName} · {round.status === 'CONFIRMED' ? 'Recebido' : round.status === 'PREPARING' ? 'Preparando' : round.status === 'READY' ? 'Pronto' : round.status === 'DELIVERED' ? 'Entregue' : round.status}</p>
            {round.items.map((item, index) => <p key={`${round.orderId}-${index}`} className="text-sm text-slate-600">{item.quantity}× {item.name}</p>)}
          </article>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Ainda não há pedidos nesta conta.</p>}</div>
          <div className="space-y-2 border-t pt-3 text-sm">
            <div className="flex justify-between"><span>Subtotal da conta</span><b>{formatBRL(tab?.subtotal || 0)}</b></div>
            {tab && tab.serviceFeePercent > 0 && !tab.serviceFeeRemoved && <div className="flex justify-between"><span>Taxa de serviço (opcional, {tab.serviceFeePercent}%)</span><b>{formatBRL(serviceFeeCents / 100)}</b></div>}
            <div className="flex justify-between text-base font-black"><span>Total</span><span>{formatBRL(accountTotalCents / 100)}</span></div>
          </div>
          {tabClosed && supabaseUser.is_anonymous && <>
            <button type="button" onClick={() => void loginWithGoogle(true)} disabled={authBusy} className="mt-5 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold">Salvar seus pontos e histórico: entrar com Google</button>
            <p className="mt-2 text-center text-xs text-slate-500">Vincule sua identidade Google para guardar seus pontos e histórico.</p>
          </>}
        </section>
      </div>}

      {billOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
        <section role="dialog" aria-modal="true" aria-label="Pedir a conta" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-black">Pedir a conta</h2><button type="button" onClick={() => setBillOpen(false)} aria-label="Fechar"><X /></button></div>
          <p className="mb-4 text-sm text-slate-600">O pagamento é feito com a equipe da loja. Escolha como prefere pagar para avisarmos o garçom.</p>
          <div className="grid grid-cols-2 gap-2">{paymentChoices.map(choice => <button key={choice.value} type="button" onClick={() => setPaymentMethod(choice.value)} className={`rounded-xl border p-3 text-sm font-bold ${paymentMethod === choice.value ? 'border-emerald-700 bg-emerald-50 text-emerald-900' : 'border-slate-200'}`}>{choice.label}</button>)}</div>
          <div className="my-4 rounded-xl bg-slate-50 p-4">
            <p className="flex justify-between text-sm"><span>Subtotal</span><b>{formatBRL(subtotalCents / 100)}</b></p>
            {serviceFeeCents > 0 && <p className="mt-1 flex justify-between text-sm"><span>Taxa de serviço opcional ({tab?.serviceFeePercent}%)</span><b>{formatBRL(serviceFeeCents / 100)}</b></p>}
            <p className="mt-2 flex justify-between border-t pt-2 font-black"><span>Total da conta</span><span>{formatBRL(accountTotalCents / 100)}</span></p>
          </div>
          {paymentMethod === 'CASH' && <label className="block text-sm font-semibold">Quanto vai pagar em dinheiro?<input inputMode="decimal" value={tendered} onChange={event => setTendered(event.target.value)} placeholder="Ex.: 100,00" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>}
          {paymentMethod === 'CASH' && <p className={`mt-2 text-sm ${cashTenderStatus === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{cashTenderStatus === 'ok' ? `Troco: ${formatBRL((parseTenderCents(tendered)! - accountTotalCents) / 100)}` : cashTenderStatus === 'missing' ? 'Informe o valor recebido para conferir o troco.' : 'O valor precisa ser maior que a conta.'}</p>}
          <div className="mt-4 rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-sm font-bold">Como deseja dividir?</p>
            <div className="flex flex-wrap gap-2">
              {([['ALL', 'Pagar tudo'], ['EQUAL', 'Dividir igual por N'], ['CUSTOM', 'Outro valor']] as const).map(([mode, label]) =>
                <button key={mode} type="button" onClick={() => setSplitMode(mode)} aria-pressed={splitMode === mode} className={`rounded-lg border px-3 py-2 text-xs font-bold ${splitMode === mode ? 'border-emerald-700 bg-emerald-50' : 'border-slate-200'}`}>{label}</button>)}
            </div>
            {splitMode === 'EQUAL' && <label className="mt-2 flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" />Dividir em<input type="number" min="1" max="100" value={splitParts} onChange={event => setSplitParts(event.target.value)} className="w-16 rounded-lg border px-2 py-1" />partes</label>}
            {splitMode === 'CUSTOM' && <label className="mt-2 block text-sm font-semibold">Valor da sua parte<input inputMode="decimal" value={customShare} onChange={event => setCustomShare(event.target.value)} placeholder="Ex.: 25,00" className="mt-1 w-full rounded-lg border px-3 py-2" /></label>}
            {split.length > 0 && <p className="mt-2 text-sm text-slate-600">Cada parte: {split.map((amount, index) => <React.Fragment key={index}>{index > 0 ? ', ' : ''}{formatBRL(amount / 100)}</React.Fragment>)}</p>}
          </div>
          <button type="button" onClick={() => void requestBill()} disabled={busy || (paymentMethod === 'CASH' && cashTenderStatus !== 'ok')} className="mt-4 w-full rounded-xl bg-emerald-700 p-3 font-bold text-white disabled:opacity-50">{busy ? 'Chamando garçom…' : 'Chamar garçom para fechar a conta'}</button>
          <p className="mt-2 text-center text-xs text-slate-500">Nenhum pagamento é processado pelo aplicativo.</p>
        </section>
      </div>}
    </main>
  );
};

export { APPROVAL_RETRY_MS, DEVICE_KEY, SESSION_KEY_PREFIX };
