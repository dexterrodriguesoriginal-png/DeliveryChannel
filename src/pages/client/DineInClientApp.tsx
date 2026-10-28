import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleUserRound, Crown, Loader2, Minus, Plus, ReceiptText, ShoppingBag, Utensils, UserRound, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { publicStoreRepository } from '../../repositories/publicStoreRepository';
import { formatBRL } from '../../lib/pricing/money';
import type { Product, SelectedProductOption } from '../../types';
import { waiterV2Repository, type TableWaiter } from '../../repositories/waiterV2Repository';
import { initials } from '../../lib/waiter/waiterRouting';
import { billSplitAmounts, BillSplitMode, DineInPaymentMethod, parseTenderCents, tenderStatus } from '../../lib/customer/dineIn';
import { tenantModuleRepository } from '../../repositories/tenantModuleRepository';
import { productOptionRepository } from '../../repositories/productOptionRepository';
import { isModuleEnabled } from '../../lib/modules';
import { friendlyTableError, tableAppUrl } from '../../lib/salon/tableQr';
import { mesasQrRepository } from '../../repositories/mesasQrRepository';
import { tableAccessRepository, type InvitePreview } from '../../repositories/tableAccessRepository';
import {
  clearPendingMesa, endedMessage, friendlyAccessError, inviteUrl, readInviteParam, readPendingMesaDetails, rememberPendingMesa,
  PENDING_APPROVAL_TEXT, PENDING_APPROVAL_TITLE, PENDING_TABLE_TEXT,
  type TabInvite, type TabMember,
} from '../../lib/customer/tableAccess';
import { ConfirmLoggedUserGate, IdentityGate, InvitePanel, InviteWelcomeScreen, MembersPanel, TableInUseScreen } from '../../components/client/dinein/TableAccessPanels';
import { optionPriceCents, validateOptionSelection } from '../../lib/addons';
import { ProductOptionsSelector } from '../../components/client/customer/ProductOptionsSelector';
import {
  addDineInCartLine,
  changeDineInCartLineQuantity,
  dineInCartLineUnitPriceCents,
  dineInOptionLabels,
  dineInRoundItems,
  setDineInCartLineNotes,
  type DineInCartLine,
} from '../../lib/customer/dineInCart';

type TableResolution = { available: boolean; tenantSlug?: string; storeName?: string; tableLabel?: string };
type TabRound = { orderId: string; orderNumber: number; roundNo: number; status: string; customerName: string; mine?: boolean; subtotal: number; createdAt: string; items: Array<{ name: string; quantity: number; unitPrice: number; totalPrice: number }> };
type MyTab = { tabId: string; status: 'OPEN' | 'BILL_REQUESTED' | 'CLOSED' | 'CANCELLED'; mode: 'TABLE' | 'INDIVIDUAL'; tableLabel: string; serviceFeePercent: number; serviceFeeRemoved: boolean; rounds: TabRound[]; subtotal: number;
  /** Only with the table-access model (capabilities v2). */
  me?: { sessionId: string; role: 'RESPONSIBLE' | 'GUEST'; approved: boolean; displayName?: string; ended?: boolean; endedReason?: string | null };
  responsibleName?: string | null; members?: TabMember[]; ended?: boolean; endedReason?: string | null };

// LGPD: the name is optional and only a first name is ever sent; without one the tab shows "Cliente".
export const guestDisplayName = (value: string): string => value.trim().split(/\s+/)[0]?.slice(0, 40) || 'Cliente';

/** "Mesa 03" already carries the word; older numeric labels ("7") still read "Mesa 7". */
export const mesaTitle = (label?: string): string => {
  const value = (label || '').trim();
  return /^mesa\b/i.test(value) ? value : `Mesa ${value}`.trim();
};

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
  const { supabaseUser, signOut } = useAuth();
  const [resolution, setResolution] = useState<TableResolution | null>(null);
  const [storeName, setStoreName] = useState('');
  const [storeLogoUrl, setStoreLogoUrl] = useState<string | null>(null);
  const [storePrimaryColor, setStorePrimaryColor] = useState<string | null>(null);
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
  const [qrPaused, setQrPaused] = useState(false);
  // Modelo de acesso (Responsável / convidado): só liga quando o banco declara capabilities v2+.
  const [access, setAccess] = useState(false);
  const [entered, setEntered] = useState(false);
  const [entryDone, setEntryDone] = useState(false);
  const [inUse, setInUse] = useState(false);
  const [entryApproved, setEntryApproved] = useState<boolean | null>(null);
  const [entryRole, setEntryRole] = useState<'RESPONSIBLE' | 'GUEST' | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinMessage, setJoinMessage] = useState('');
  const [invite, setInvite] = useState<TabInvite | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [membersBusy, setMembersBusy] = useState(false);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const fromUrl = readInviteParam(window.location.search);
    if (fromUrl) return fromUrl;
    const saved = typeof localStorage !== 'undefined' ? readPendingMesaDetails(localStorage) : null;
    return saved?.token === token && saved.inviteCode ? saved.inviteCode : null;
  });
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [addedToast, setAddedToast] = useState<{ name: string; quantity: number; seq: number } | null>(null);
  const [bagBounce, setBagBounce] = useState(false);
  const [confirmOrderOpen, setConfirmOrderOpen] = useState(false);
  const [awaitingReleaseModalOpen, setAwaitingReleaseModalOpen] = useState(false);
  const [tableWaiter, setTableWaiter] = useState<TableWaiter | null>(null);

  useEffect(() => {
    if (!sessionId) { setTableWaiter(null); return; }
    let alive = true;
    waiterV2Repository.myTableWaiter(sessionId)
      .then(res => { if (alive) setTableWaiter(res); })
      .catch(() => { if (alive) setTableWaiter(null); });
    return () => { alive = false; };
  }, [sessionId, tab?.status]);
  const inviteParamRef = useRef<string | null>(inviteCode);
  const deviceIdRef = useRef('');
  const submitKeyRef = useRef(uuid());
  const submitLockRef = useRef(false);
  const openedUserRef = useRef('');
  const pingedRef = useRef('');

  const subtotalCents = Math.round((tab?.subtotal || 0) * 100);
  const serviceFeeCents = tab && !tab.serviceFeeRemoved
    ? Math.round(subtotalCents * tab.serviceFeePercent / 100)
    : 0;
  const accountTotalCents = subtotalCents + serviceFeeCents;
  const cashTenderStatus = tenderStatus(accountTotalCents, parseTenderCents(tendered));
  const needsIdentity = access && (!supabaseUser || supabaseUser.is_anonymous === true);
  const myRole = tab?.me?.role || entryRole;
  const approvedNow = tab?.me ? tab.me.approved : entryApproved;
  const awaitingRelease = access ? approvedNow === false : pendingApproval;
  // Parte E: Enquanto aguarda liberação, o cardápio fica visível e o cliente pode montar a sacola.
  const orderingDisabled = qrPaused || tabClosed || tab?.status === 'BILL_REQUESTED';
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
      // Qual modelo de acesso o banco entende? Falha = modelo antigo (nunca bloqueia o salão).
      const caps = await mesasQrRepository.capabilities();
      if (!alive) return;
      setAccess(caps.tableAccess);
      const urlInvite = caps.tableAccess ? readInviteParam(window.location.search) : null;
      const savedPending = caps.tableAccess && typeof localStorage !== 'undefined' ? readPendingMesaDetails(localStorage) : null;
      const resolvedInvite = urlInvite || (savedPending?.token === token ? savedPending.inviteCode || null : null);
      inviteParamRef.current = resolvedInvite;
      setInviteCode(resolvedInvite);
      if (resolvedInvite && typeof tableAccessRepository.resolveInvite === 'function') {
        void tableAccessRepository.resolveInvite(token, resolvedInvite).then(preview => {
          if (alive && preview) {
            setInvitePreview(preview);
            if (preview.logoUrl) setStoreLogoUrl(preview.logoUrl);
            if (preview.primaryColor) setStorePrimaryColor(preview.primaryColor);
          }
        });
      }
      // The store can pause QR ordering. Older databases do not have this function: then it is simply "not paused".
      void Promise.resolve(supabase.rpc('get_table_qr_status', { p_qr_token: token }))
        .then(({ data: status, error: statusError }) => { if (alive && !statusError && (status as { paused?: boolean } | null)?.paused === true) setQrPaused(true); })
        .catch(() => { /* fail open */ });
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
        setStoreName(result.storeName || store.data.theme?.storeName || store.data.tenant.name);
        if (store.data.theme?.logoUrl) setStoreLogoUrl(store.data.theme.logoUrl);
        if (store.data.theme?.primaryColor) setStorePrimaryColor(store.data.theme.primaryColor);
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
      if (cached) {
        setSessionId(cached);
        setIdentityConfirmed(true);
      }
    } catch { /* storage may be unavailable */ }
  }, [token]);

  const displayNameForEntry = useCallback((overrideName?: string) => {
    const meta = (supabaseUser?.user_metadata || {}) as { name?: unknown; full_name?: unknown };
    const fromAccount = typeof meta.name === 'string' ? meta.name : typeof meta.full_name === 'string' ? meta.full_name : '';
    const emailPrefix = supabaseUser?.email ? supabaseUser.email.split('@')[0] : '';
    return guestDisplayName(overrideName || firstName || fromAccount || emailPrefix);
  }, [firstName, supabaseUser]);

  const applyEntry = useCallback((entry: { state: string; sessionId?: string; approved?: boolean }) => {
    if (entry.state === 'IN_USE' || !entry.sessionId) {
      setInUse(true);
      return;
    }
    setInUse(false);
    setEntryRole(entry.state === 'RESPONSIBLE' ? 'RESPONSIBLE' : 'GUEST');
    setEntryApproved(entry.approved === true);
    setEndedReason(null);
    setSessionId(entry.sessionId);
    setEntered(true);
    setInviteCode(null);
    inviteParamRef.current = null;
    clearPendingMesa(typeof localStorage !== 'undefined' ? localStorage : null);
    try { sessionStorage.setItem(`${SESSION_KEY_PREFIX}${token}`, entry.sessionId); } catch { /* best effort */ }
    // Tira o código de convite do endereço: ele já foi usado.
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('convite')) { url.searchParams.delete('convite'); window.history.replaceState(null, '', url.pathname + url.search + url.hash); }
    } catch { /* ignore */ }
  }, [token]);

  const openOrJoin = useCallback(async (overrideName?: string) => {
    if (!supabaseUser || !resolution?.available || !deviceIdRef.current) return;
    if (access && supabaseUser.is_anonymous) return;
    if (openedUserRef.current === supabaseUser.id) return;
    openedUserRef.current = supabaseUser.id;
    setBusy(true);
    setJoinBusy(true);
    setNotice('');
    setJoinMessage('');
    const chosenName = displayNameForEntry(overrideName);
    if (access) {
      try {
        // Parte F (DETALHE DO BUG): Quando há convite (&convite=CODIGO), chama joinWithCode DIRETAMENTE,
        // sem chamar enterTable antes (evitando corrida que exibia "Esta mesa já está em uso").
        const pendingInvite = inviteParamRef.current || inviteCode;
        if (pendingInvite) {
          const joined = await tableAccessRepository.joinWithCode(token, pendingInvite, chosenName, deviceIdRef.current);
          if (joined.entry) {
            applyEntry(joined.entry);
            return;
          }
          if (joined.free) {
            inviteParamRef.current = null;
            setInviteCode(null);
            const entry = await tableAccessRepository.enterTable(token, chosenName, deviceIdRef.current);
            applyEntry(entry);
            return;
          }
          if (joined.invalid) {
            openedUserRef.current = '';
            setJoinMessage('Código inválido ou expirado. Peça um novo convite a quem abriu a mesa.');
            return;
          }
        }
        const entry = await tableAccessRepository.enterTable(token, chosenName, deviceIdRef.current);
        applyEntry(entry);
      } catch (openError) {
        openedUserRef.current = '';
        const message = errorText(openError);
        if (/QR_PAUSED/i.test(message)) setQrPaused(true);
        const friendly = friendlyAccessError(message);
        setNotice(friendly);
        if (inviteParamRef.current || inviteCode) setJoinMessage(friendly);
      } finally {
        setEntryDone(true);
        setBusy(false);
        setJoinBusy(false);
      }
      return;
    }
    const { data, error: openError } = await supabase.rpc('open_or_join_tab', {
      p_qr_token: token,
      p_display_name: guestDisplayName(overrideName || firstName),
      p_device_id: deviceIdRef.current,
    });
    if (openError || !data?.sessionId) {
      openedUserRef.current = '';
      if (/QR_PAUSED/i.test(errorText(openError))) setQrPaused(true);
      setNotice(friendlyTableError(errorText(openError)) || 'Não foi possível abrir sua comanda.');
      setBusy(false);
      setJoinBusy(false);
      return;
    }
    const id = String(data.sessionId);
    setSessionId(id);
    try { sessionStorage.setItem(`${SESSION_KEY_PREFIX}${token}`, id); } catch { /* best effort */ }
    setNotice('');
    setBusy(false);
    setJoinBusy(false);
  }, [access, applyEntry, displayNameForEntry, firstName, inviteCode, resolution?.available, supabaseUser, token]);

  // Parte E: Com conta já logada no aparelho, exige confirmação ("Entrar como <Nome>?") antes de entrar na mesa.
  useEffect(() => {
    if (!supabaseUser || !resolution?.available) return;
    if (access) {
      if (!supabaseUser.is_anonymous && identityConfirmed) void openOrJoin();
      return;
    }
    if (!qrPaused) void openOrJoin();
  }, [supabaseUser, resolution?.available, qrPaused, access, identityConfirmed, openOrJoin]);

  const submitInviteCode = useCallback(async (code: string) => {
    if (!supabaseUser || !deviceIdRef.current) return;
    setJoinBusy(true);
    setJoinMessage('');
    try {
      const result = await tableAccessRepository.joinWithCode(token, code, displayNameForEntry(), deviceIdRef.current);
      if (result.entry) applyEntry(result.entry);
      else if (result.free) { openedUserRef.current = ''; setInUse(false); void openOrJoin(); }
      else setJoinMessage('Código inválido ou expirado. Confira com quem abriu a mesa ou peça um novo convite.');
    } catch (joinError) {
      setJoinMessage(friendlyAccessError(errorText(joinError)));
    } finally { setJoinBusy(false); }
  }, [applyEntry, displayNameForEntry, openOrJoin, supabaseUser, token]);

  // Cadastro novo ou convite: lembra a mesa e o código de convite para voltar depois do e-mail de confirmação.
  useEffect(() => {
    if (needsIdentity || inviteCode) {
      rememberPendingMesa(typeof localStorage !== 'undefined' ? localStorage : null, token, Date.now(), inviteCode);
    }
  }, [needsIdentity, token, inviteCode]);

  const loadAccount = useCallback(async (silent = false) => {
    if (!sessionId) return;
    if (!silent) setBusy(true);
    const { data, error: accountError } = await supabase.rpc('get_my_tab', { p_session_id: sessionId });
    if (accountError) {
      const message = errorText(accountError);
      if (/TAB_CLOSED|comanda encerrada/i.test(message)) {
        setTabClosed(true);
        setTab(current => current ? { ...current, status: 'CLOSED' } : current);
      } else if (access && /TAB_NOT_FOUND/i.test(message)) {
        // Sessão antiga/expirada: o servidor decide de novo (a conta do cliente restaura a mesa).
        setSessionId(''); setEntered(false); setTab(null); openedUserRef.current = '';
        try { sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${token}`); } catch { /* ignore */ }
      } else if (!silent) setNotice(message || 'Não foi possível atualizar a conta.');
    } else if (data) {
      const next = data as MyTab;
      if (next.ended && next.endedReason !== 'TAB_CLOSED') {
        // Removido / recusado / reiniciado pela equipe: explica e permite entrar de novo.
        setEndedReason(next.endedReason || 'ENDED');
        setTab(null);
        setSessionId('');
        setEntered(false);
        try { sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${token}`); } catch { /* ignore */ }
      } else {
        setTab(next);
        if (next.me) { setEntryRole(next.me.role); setEntryApproved(next.me.approved); }
        if (next.status === 'CLOSED' || next.status === 'CANCELLED') setTabClosed(true);
      }
    }
    if (!silent) setBusy(false);
  }, [access, sessionId, token]);

  useEffect(() => {
    if (!sessionId) return;
    void loadAccount(true);
    // Enquanto a mesa aguarda liberação, confere com mais frequência + escuta Realtime para liberar a tela assim que o garçom aprovar.
    const interval = window.setInterval(() => void loadAccount(true), access && awaitingRelease ? 3000 : 15000);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (typeof supabase?.channel === 'function') {
      try {
        channel = supabase
          .channel(`dinein-session-${sessionId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tab_sessions', filter: `id=eq.${sessionId}` }, () => { void loadAccount(true); })
          .subscribe();
      } catch {
        channel = null;
      }
    }
    return () => {
      window.clearInterval(interval);
      if (channel && typeof supabase?.removeChannel === 'function') void supabase.removeChannel(channel);
    };
  }, [sessionId, loadAccount, access, awaitingRelease]);

  useEffect(() => {
    if (!awaitingRelease && awaitingReleaseModalOpen) {
      setAwaitingReleaseModalOpen(false);
    }
  }, [awaitingRelease, awaitingReleaseModalOpen]);

  useEffect(() => {
    if (!access || !sessionId || approvedNow !== false || pingedRef.current === sessionId) return;
    pingedRef.current = sessionId;
    void tableAccessRepository.pingPending(sessionId);
  }, [access, sessionId, approvedNow]);

  useEffect(() => {
    if (!addedToast) return;
    const t = window.setTimeout(() => setAddedToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [addedToast]);

  useEffect(() => {
    if (!bagBounce) return;
    const t = window.setTimeout(() => setBagBounce(false), 500);
    return () => window.clearTimeout(t);
  }, [bagBounce]);

  const triggerAddedFeedback = useCallback((productName: string, quantity = 1) => {
    setAddedToast(prev => ({ name: productName, quantity, seq: (prev?.seq || 0) + 1 }));
    setBagBounce(true);
  }, []);

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
        setConfirmOrderOpen(false);
        setPendingApproval(true);
        setAwaitingReleaseModalOpen(true);
        if (access) { setEntryApproved(false); void tableAccessRepository.pingPending(sessionId); }
      } else if (/TAB_CLOSED/i.test(message)) {
        setConfirmOrderOpen(false);
        setTabClosed(true);
        setNotice('Conta encerrada. Para pedir de novo, chame o garçom.');
      } else {
        if (/QR_PAUSED/i.test(message)) setQrPaused(true);
        setNotice(friendlyTableError(message) || 'Não foi possível enviar sua rodada. Tente novamente.');
      }
      return;
    }
    if (data) {
      setConfirmOrderOpen(false);
      setPendingApproval(false);
      setAwaitingReleaseModalOpen(false);
      if (access) setEntryApproved(true);
      setCart([]);
      submitKeyRef.current = uuid();
      setNotice('Pedido feito! A cozinha já recebeu.');
      await loadAccount(true);
    }
  }, [access, cart, loadAccount, sessionId, tabClosed]);

  useEffect(() => {
    if (!pendingApproval || tabClosed) return;
    const retry = window.setInterval(() => void submitRound(), APPROVAL_RETRY_MS);
    return () => window.clearInterval(retry);
  }, [pendingApproval, submitRound, tabClosed]);

  const handleRequestOrder = () => {
    if (cart.length === 0 || orderingDisabled || busy) return;
    if (awaitingRelease) {
      setAwaitingReleaseModalOpen(true);
      if (sessionId) void tableAccessRepository.pingPending(sessionId);
      return;
    }
    setConfirmOrderOpen(true);
  };

  const addItem = (product: Product) => {
    if (product.optionGroups?.some(group => group.active)) {
      setOptionsProduct(product);
      setOptionChoices([]);
      return;
    }
    setCart(current => addDineInCartLine(current, product));
    triggerAddedFeedback(product.name, 1);
  };
  const addConfiguredItem = () => {
    if (!optionsProduct) return;
    const groups = optionsProduct.optionGroups?.filter(group => group.active) || [];
    const validation = validateOptionSelection(groups, optionChoices);
    if (!validation.valid) {
      setNotice(validation.messages[0] || 'Confira os adicionais selecionados.');
      return;
    }
    const addedName = optionsProduct.name;
    setCart(current => addDineInCartLine(current, optionsProduct, optionChoices));
    setOptionsProduct(null);
    setOptionChoices([]);
    setNotice('');
    triggerAddedFeedback(addedName, 1);
  };
  const changeQuantity = (productId: string, delta: number) => {
    if (delta > 0) {
      const p = products.find(item => item.id === productId);
      if (p) triggerAddedFeedback(p.name, delta);
    }
    setCart(current => {
      const line = [...current].reverse().find(item => item.product.id === productId);
      return line ? changeDineInCartLineQuantity(current, line.key, delta) : current;
    });
  };
  const changeLineQuantity = (key: string, delta: number) => {
    if (delta > 0) {
      const line = cart.find(item => item.key === key);
      if (line) triggerAddedFeedback(line.product.name, delta);
    }
    setCart(current => changeDineInCartLineQuantity(current, key, delta));
  };
  const changeLineNotes = (key: string, lineNotes: string) =>
    setCart(current => setDineInCartLineNotes(current, key, lineNotes));

  const handleSwitchAccount = async () => {
    try { sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${token}`); } catch { /* ignore */ }
    setSessionId('');
    setEntered(false);
    setIdentityConfirmed(false);
    openedUserRef.current = '';
    try {
      if (typeof signOut === 'function') await signOut();
      else await supabase.auth.signOut();
    } catch {
      // ignore
    }
  };

  const enterAsGuest = async () => {
    const name = guestDisplayName(firstName);
    setFirstName(firstName.trim() ? name : '');
    setAuthBusy(true);
    setNotice('');
    const { error: authError } = await supabase.auth.signInAnonymously({ options: { data: { display_name: name } } });
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
    setFirstName(firstName.trim() ? guestDisplayName(firstName) : '');
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

  // Convite (só o Responsável): código curto que expira, revogável.
  const createInvite = async () => {
    if (!sessionId) return;
    setInviteBusy(true);
    try { setInvite(await tableAccessRepository.createInvite(sessionId, 15)); setNotice(''); }
    catch (inviteError) { setNotice(friendlyAccessError(errorText(inviteError))); }
    finally { setInviteBusy(false); }
  };
  const revokeInvite = async () => {
    if (!sessionId) return;
    setInviteBusy(true);
    try { await tableAccessRepository.revokeInvite(sessionId); setInvite(null); }
    catch (inviteError) { setNotice(friendlyAccessError(errorText(inviteError))); }
    finally { setInviteBusy(false); }
  };
  const removeMember = async (member: TabMember) => {
    setMembersBusy(true);
    try { await tableAccessRepository.removeGuest(sessionId, member.sessionId); setNotice(`${member.displayName} foi removido da mesa.`); await loadAccount(true); }
    catch (memberError) { setNotice(friendlyAccessError(errorText(memberError))); }
    finally { setMembersBusy(false); }
  };
  const transferTo = async (member: TabMember) => {
    setMembersBusy(true);
    try { await tableAccessRepository.transferResponsibility(sessionId, member.sessionId); setNotice(`${member.displayName} agora é o responsável pela mesa.`); setInvite(null); await loadAccount(true); }
    catch (memberError) { setNotice(friendlyAccessError(errorText(memberError))); }
    finally { setMembersBusy(false); }
  };

  useEffect(() => {
    if (!access || !accountOpen || myRole !== 'RESPONSIBLE' || !sessionId) return;
    let alive = true;
    void tableAccessRepository.getInvite(sessionId).then(current => { if (alive) setInvite(current); }).catch(() => { /* optional */ });
    return () => { alive = false; };
  }, [access, accountOpen, myRole, sessionId]);

  const unavailable = !loading && (!resolution?.available || Boolean(error));
  const totalCartCents = cart.reduce((sum, line) => sum + dineInCartLineUnitPriceCents(line) * line.quantity, 0);
  const totalCart = totalCartCents / 100;
  const totalCartItems = cart.reduce((sum, line) => sum + line.quantity, 0);
  const customerDisplayName = tab?.me?.displayName || displayNameForEntry();

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-700"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando mesa e cardápio…</div>;
  if (unavailable) {
    return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><section className="max-w-sm rounded-3xl bg-white p-7 text-center shadow-xl"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-amber-600" /><h1 className="text-xl font-extrabold">Salão indisponível no momento</h1><p className="mt-2 text-sm text-slate-600">{error || 'Confira o QR Code ou chame um atendente.'}</p></section></main>;
  }

  if (qrPaused && !sessionId && (!access || needsIdentity || entryDone)) {
    return <main className="min-h-screen grid place-items-center bg-slate-50 p-6" data-testid="dine-in-paused"><section className="max-w-sm rounded-3xl bg-white p-7 text-center shadow-xl"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-amber-600" /><h1 className="text-xl font-black">Pedidos pelo QR pausados</h1><p className="mt-2 text-sm text-slate-600">{storeName || 'O estabelecimento'} pausou os pedidos pelo celular por enquanto. Chame um atendente para pedir.</p></section></main>;
  }

  const tableName = mesaTitle(invitePreview?.tableLabel || resolution?.tableLabel);
  const displayStoreName = invitePreview?.storeName || storeName || resolution?.storeName || '';
  if (access && endedReason && !sessionId) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8" data-testid="dine-in-ended">
        <section className="mx-auto max-w-md rounded-3xl bg-white p-6 text-center shadow-xl">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-amber-600" />
          <h1 className="text-xl font-black">{tableName}</h1>
          <p className="mt-2 text-sm text-slate-600">{endedMessage(endedReason)}</p>
          <button type="button" onClick={() => { setEndedReason(null); setInUse(false); setEntryDone(false); openedUserRef.current = ''; setIdentityConfirmed(true); void openOrJoin(); }} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">Entrar na mesa de novo</button>
        </section>
      </main>
    );
  }
  // Parte F: Quem abriu um link de convite (&convite=CODIGO) vai DIRETO para a tela de boas-vindas da loja,
  // nunca vendo "Esta mesa já está em uso".
  if (access && inviteCode && !sessionId && !inUse) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <InviteWelcomeScreen
          storeName={displayStoreName}
          tableLabel={tableName}
          responsibleName={invitePreview?.responsibleName || 'Responsável'}
          inviteCode={inviteCode}
          logoUrl={invitePreview?.logoUrl ?? storeLogoUrl}
          primaryColor={invitePreview?.primaryColor ?? storePrimaryColor}
          identifiedUser={!needsIdentity}
          loggedUserName={displayNameForEntry()}
          loggedUserEmail={supabaseUser?.email}
          busy={joinBusy || busy}
          message={joinMessage || notice}
          onJoinLoggedUser={() => {
            openedUserRef.current = '';
            setIdentityConfirmed(true);
            void openOrJoin();
          }}
          onSwitchAccount={() => void handleSwitchAccount()}
          onGoogle={() => void loginWithGoogle(false)}
          onSignedUp={info => {
            if (info.name) setFirstName(guestDisplayName(info.name));
            if (!info.requiresEmailConfirmation) setIdentityConfirmed(true);
          }}
          onAuthenticated={name => {
            const cleanName = name ? guestDisplayName(name) : undefined;
            if (cleanName) setFirstName(cleanName);
            openedUserRef.current = '';
            setIdentityConfirmed(true);
          }}
        />
      </main>
    );
  }
  if (needsIdentity) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <IdentityGate
          storeName={displayStoreName}
          tableLabel={tableName}
          initialName={firstName}
          intro="A primeira pessoa a abrir a mesa fica como responsável. Pedimos seus dados para a loja saber quem está na mesa."
          onGoogle={() => void loginWithGoogle(false)}
          onSignedUp={info => {
            if (info.name) setFirstName(guestDisplayName(info.name));
            if (!info.requiresEmailConfirmation) setIdentityConfirmed(true);
          }}
          onAuthenticated={name => {
            if (name) setFirstName(guestDisplayName(name));
            openedUserRef.current = '';
            setIdentityConfirmed(true);
          }}
        />
        {notice && <p role="alert" className="mx-auto mt-4 max-w-md rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
      </main>
    );
  }
  // Parte E: Com conta já logada no aparelho, mostra sempre "Entrar como <Nome>?" antes de entrar sozinho.
  if (access && !sessionId && !identityConfirmed) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <ConfirmLoggedUserGate
          storeName={displayStoreName}
          tableLabel={tableName}
          userName={displayNameForEntry()}
          userEmail={supabaseUser?.email}
          logoUrl={storeLogoUrl}
          primaryColor={storePrimaryColor}
          busy={busy}
          message={notice}
          onConfirm={() => {
            openedUserRef.current = '';
            setIdentityConfirmed(true);
          }}
          onSwitchAccount={() => void handleSwitchAccount()}
        />
      </main>
    );
  }
  if (access && inUse && !sessionId) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <TableInUseScreen storeName={displayStoreName} tableLabel={tableName} busy={joinBusy} message={joinMessage} onSubmitCode={code => void submitInviteCode(code)} />
      </main>
    );
  }
  if (access && !sessionId) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6" data-testid="dine-in-entering">
        <section className="max-w-sm rounded-3xl bg-white p-7 text-center shadow-xl">
          {notice
            ? <><AlertCircle className="mx-auto mb-3 h-10 w-10 text-amber-600" /><p role="alert" className="text-sm text-slate-700">{notice}</p><button type="button" onClick={() => { openedUserRef.current = ''; void openOrJoin(); }} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">Tentar de novo</button></>
            : <><Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-emerald-700" /><p className="text-sm font-semibold text-slate-700">Abrindo a {tableName}…</p></>}
        </section>
      </main>
    );
  }

  if (!supabaseUser || !sessionId) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <section className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-xl">
          <div className="mb-5 flex items-center gap-3"><Utensils className="h-8 w-8 text-emerald-700" /><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{storeName}</p><h1 className="text-xl font-black">{mesaTitle(resolution?.tableLabel)}</h1></div></div>
          <h2 className="text-lg font-bold">Como podemos te chamar? <span className="text-sm font-semibold text-slate-500">(opcional)</span></h2>
          <p className="mb-4 mt-1 text-sm text-slate-600">Seu nome ajuda o garçom a te encontrar. Pode pular: não guardamos dados que você não informar.</p>
          {!showLogin ? (
            <>
              <input aria-label="Seu primeiro nome" value={firstName} onChange={event => setFirstName(event.target.value)} autoComplete="given-name" className="w-full rounded-xl border border-slate-300 px-4 py-3" placeholder="Primeiro nome (opcional)" />
              <button type="button" onClick={() => void enterAsGuest()} disabled={authBusy} className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">{authBusy ? 'Conectando…' : 'Continuar como visitante'}</button>
              <button type="button" onClick={() => setShowLogin(true)} className="mt-3 w-full py-2 text-sm font-semibold text-emerald-800">Já tenho uma conta</button>
            </>
          ) : (
            <form onSubmit={loginWithPassword} className="space-y-3">
              <label className="block text-sm font-semibold">Seu primeiro nome (opcional)<input aria-label="Seu primeiro nome" value={firstName} onChange={event => setFirstName(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
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
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <div>
            <p className="font-extrabold">Você está na {mesaTitle(tab?.tableLabel || resolution?.tableLabel)} · {storeName}</p>
            {access && myRole && <p data-testid="role-chip" className="mt-0.5 flex items-center gap-1 text-xs font-bold text-slate-500">{myRole === 'RESPONSIBLE' ? <><Crown className="h-3.5 w-3.5 text-amber-500" />Você é o responsável pela mesa</> : <>Convidado{tab?.responsibleName ? ` de ${tab.responsibleName}` : ''}</>}</p>}
            {tableWaiter && (
              <div data-testid="my-table-waiter" className="mt-1 flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                <span>Seu garçom:</span>
                {tableWaiter.photoUrl ? (
                  <img src={tableWaiter.photoUrl} alt={tableWaiter.name} className="h-5 w-5 rounded-full object-cover" />
                ) : (
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-100 text-[10px] font-black text-emerald-800">
                    {initials(tableWaiter.name)}
                  </span>
                )}
                <span className="font-bold text-slate-900">{tableWaiter.name}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div
              data-testid="dinein-bag-counter"
              aria-label={`Sacola com ${totalCartItems} ${totalCartItems === 1 ? 'item' : 'itens'}`}
              className={`relative flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-900 transition-transform duration-300 ${bagBounce ? 'scale-110 ring-2 ring-emerald-500 animate-bounce' : 'scale-100'}`}
            >
              <ShoppingBag className="h-4 w-4 text-emerald-700" />
              <span>{totalCartItems}</span>
            </div>
            <button type="button" onClick={() => { setAccountOpen(true); void loadAccount(); }} aria-label="Ver minha conta" className="rounded-full bg-slate-100 p-2"><CircleUserRound className="h-6 w-6" /></button>
          </div>
        </div>
      </header>
      {addedToast && (
        <div
          aria-live="polite"
          data-testid="added-to-bag-toast"
          className="fixed inset-x-4 top-16 z-40 mx-auto flex max-w-sm items-center gap-2.5 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-xl transition-all"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
          <span className="truncate">Adicionado à sacola · {addedToast.quantity}× {addedToast.name}</span>
        </div>
      )}
      {awaitingRelease && !qrPaused && (
        <div role="status" data-testid="awaiting-release" className="mx-auto mt-3 flex max-w-2xl items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-amber-700" />
          <div>
            <p className="font-extrabold">Aguarde a liberação da mesa · {PENDING_APPROVAL_TITLE}</p>
            <p>{cart.length ? PENDING_APPROVAL_TEXT : PENDING_TABLE_TEXT}</p>
          </div>
        </div>
      )}
      {qrPaused && <div role="status" className="mx-auto mt-3 max-w-2xl rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">Pedidos pelo QR pausados no momento. Chame um atendente para pedir.</div>}

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
            return <div key={line.key} className="border-b border-slate-100 py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{line.quantity}× {line.product.name}</p>
                  {optionLabels.map(label => <p key={label} className="text-xs text-slate-500">{label}</p>)}
                  {line.notes && <p className="text-xs italic text-slate-600">Obs.: {line.notes}</p>}
                  <p className="text-xs text-slate-500">{formatBRL(dineInCartLineUnitPriceCents(line) / 100)} cada</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" aria-label={`Remover uma unidade de ${line.product.name}`} onClick={() => changeLineQuantity(line.key, -1)} disabled={orderingDisabled || busy} className="rounded-full bg-slate-100 p-1.5 disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                  <span>{formatBRL(dineInCartLineUnitPriceCents(line) * line.quantity / 100)}</span>
                  <button type="button" aria-label={`Adicionar uma unidade de ${line.product.name}`} onClick={() => changeLineQuantity(line.key, 1)} disabled={orderingDisabled || busy} className="rounded-full bg-slate-100 p-1.5 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <input
                type="text"
                aria-label={`Observação de ${line.product.name}`}
                value={line.notes || ''}
                onChange={e => changeLineNotes(line.key, e.target.value)}
                placeholder="Alguma observação? (ex.: sem gelo, bem passado)"
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-emerald-600"
              />
            </div>;
          })}
          <div className="flex justify-between border-t pt-3 font-bold"><span>Subtotal estimado</span><span>{formatBRL(totalCart)}</span></div>
          <button type="button" onClick={handleRequestOrder} disabled={busy || orderingDisabled} className="mt-3 w-full rounded-xl bg-emerald-700 p-3 font-bold text-white disabled:opacity-50">{busy ? 'Enviando…' : 'Fazer pedido'}</button>
          {(pendingApproval || awaitingRelease) && <p className="mt-2 text-xs font-semibold text-amber-800">Aguarde a liberação da mesa. {PENDING_APPROVAL_TITLE}. {PENDING_APPROVAL_TEXT}</p>}
          {tab?.status === 'BILL_REQUESTED' && <p className="mt-2 text-xs font-semibold text-amber-800">A conta já foi solicitada. Chame o garçom se precisar reabrir a comanda.</p>}
        </section>}
        {awaitingReleaseModalOpen && awaitingRelease && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setAwaitingReleaseModalOpen(false); }}>
            <section role="dialog" aria-modal="true" aria-label="Aguarde a liberação da mesa" data-testid="awaiting-release-modal" className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl">
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-amber-700">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
              <h2 className="text-xl font-black text-slate-900">Aguarde a liberação da mesa</h2>
              <p className="mt-2 text-sm text-slate-600">
                O garçom já foi chamado para liberar a <b>{mesaTitle(tab?.tableLabel || resolution?.tableLabel)}</b>. Assim que ele aprovar, este aviso some sozinho e você poderá confirmar seu pedido.
              </p>
              <button
                type="button"
                onClick={() => setAwaitingReleaseModalOpen(false)}
                className="mt-5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700"
              >
                Continuar olhando o cardápio
              </button>
            </section>
          </div>
        )}
        {confirmOrderOpen && cart.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setConfirmOrderOpen(false); }}>
            <section role="dialog" aria-modal="true" aria-label="Confirmar pedido na mesa" data-testid="confirm-order-modal" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-wide text-emerald-700" data-testid="confirm-order-identity">
                    {mesaTitle(tab?.tableLabel || resolution?.tableLabel)} · {customerDisplayName}
                  </p>
                  <h2 className="text-xl font-black text-slate-900">Confira seu pedido</h2>
                </div>
                <button type="button" disabled={busy} onClick={() => setConfirmOrderOpen(false)} aria-label="Fechar confirmação"><X className="h-5 w-5" /></button>
              </div>
              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2">
                {cart.map(line => {
                  const unitCents = dineInCartLineUnitPriceCents(line);
                  const lineTotalCents = unitCents * line.quantity;
                  const optionLabels = dineInOptionLabels(line.product, line.options);
                  return (
                    <div key={line.key} className="py-2.5 text-sm">
                      <div className="flex items-start justify-between gap-2 font-bold text-slate-900">
                        <span>{line.quantity}× {line.product.name}</span>
                        <span>{formatBRL(lineTotalCents / 100)}</span>
                      </div>
                      <p className="text-xs text-slate-500">Valor unitário: {formatBRL(unitCents / 100)}</p>
                      {optionLabels.map(label => <p key={label} className="text-xs text-slate-600">{label}</p>)}
                      {line.notes?.trim() && <p className="mt-0.5 text-xs font-semibold text-amber-900">Obs.: {line.notes.trim()}</p>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3 text-base font-black text-slate-900">
                <span>Total desta rodada</span>
                <span>{formatBRL(totalCart)}</span>
              </div>
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  data-testid="confirm-order-submit"
                  disabled={busy || submitLockRef.current}
                  onClick={() => void submitRound()}
                  className="w-full rounded-xl bg-emerald-700 px-4 py-3.5 text-base font-black text-white disabled:opacity-50"
                >
                  {busy ? 'Enviando pedido…' : 'Confirmar pedido na mesa'}
                </button>
                <button
                  type="button"
                  data-testid="confirm-order-cancel"
                  disabled={busy}
                  onClick={() => setConfirmOrderOpen(false)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-50"
                >
                  Voltar e editar
                </button>
              </div>
            </section>
          </div>
        )}
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
          <p className="text-sm text-slate-600">{mesaTitle(tab?.tableLabel || resolution?.tableLabel)} · {tab?.status === 'BILL_REQUESTED' ? 'Conta solicitada' : tab?.status === 'CLOSED' ? 'Encerrada' : 'Aberta'}</p>
          {access && myRole === 'RESPONSIBLE' && !tabClosed && tab?.status !== 'CLOSED' && <div className="mt-4 space-y-3">
            <InvitePanel invite={invite} busy={inviteBusy} link={invite && resolution?.tenantSlug ? inviteUrl(window.location.origin, resolution.tenantSlug, token, invite.code) : ''} onCreate={() => void createInvite()} onRevoke={() => void revokeInvite()} />
            <MembersPanel members={tab?.members || []} mySessionId={sessionId} busy={membersBusy} onRemove={member => void removeMember(member)} onTransfer={member => void transferTo(member)} />
          </div>}
          <div className="my-4 space-y-3">{tab?.rounds?.length ? tab.rounds.map(round => <article key={round.orderId} className="rounded-xl bg-slate-50 p-3">
            <div className="mb-2 flex justify-between font-bold"><span>Rodada {round.roundNo}</span><span>{formatBRL(round.subtotal)}</span></div>
            <p className="mb-2 text-xs text-slate-500">{access ? `Pedido de ${round.mine ? 'você' : round.customerName}` : round.customerName} · {round.status === 'CONFIRMED' ? 'Recebido' : round.status === 'PREPARING' ? 'Preparando' : round.status === 'READY' ? 'Pronto' : round.status === 'DELIVERED' ? 'Entregue' : round.status}</p>
            {round.items.map((item, index) => <p key={`${round.orderId}-${index}`} className="text-sm text-slate-600">{item.quantity}× {item.name}</p>)}
          </article>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Ainda não há pedidos nesta conta.</p>}</div>
          <div className="space-y-2 border-t pt-3 text-sm">
            <div className="flex justify-between"><span>Subtotal da conta</span><b>{formatBRL(tab?.subtotal || 0)}</b></div>
            {tab && tab.serviceFeePercent > 0 && !tab.serviceFeeRemoved && <div className="flex justify-between"><span>Taxa de serviço (opcional, {tab.serviceFeePercent}%)</span><b>{formatBRL(serviceFeeCents / 100)}</b></div>}
            <div className="flex justify-between text-base font-black"><span>Total</span><span>{formatBRL(accountTotalCents / 100)}</span></div>
          </div>
          {tabClosed && supabaseUser.is_anonymous && !access && <>
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
