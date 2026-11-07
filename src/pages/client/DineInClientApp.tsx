import { tableMoveApprovalRepository, type TableMoveRequest } from '../../repositories/tableMoveApprovalRepository';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleUserRound, Crown, Loader2, ReceiptText, ShoppingBag, UserRound, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { publicStoreRepository } from '../../repositories/publicStoreRepository';
import { formatBRL } from '../../lib/pricing/money';
import type { Category, Product, SelectedProductOption } from '../../types';
import type { MenuTheme } from '../../types/menuTheme';
import type { MenuOptions } from '../../types/menuOptions';
import { DEFAULT_MENU_OPTIONS } from '../../lib/menu/menuOptions';
import { TotemKioskLayer } from '../../components/client/totem/TotemKioskLayer';
import { productToPricingLine } from '../../lib/pricing/fulfillmentPricing';
import { useSmartUpsell } from '../../hooks/useSmartUpsell';
import { UpsellSheet } from '../../components/client/customer/UpsellSheet';
import type { UpsellCartItem } from '../../types/upsell';
import { waiterV2Repository, type TableWaiter } from '../../repositories/waiterV2Repository';
import { initials } from '../../lib/waiter/waiterRouting';
import { billSplitAmounts, BillSplitMode, DineInPaymentMethod, parseTenderCents, tenderStatus } from '../../lib/customer/dineIn';
import { canReopenBill } from '../../lib/customer/billReopen';
import './DineInClientApp.css';
import { tenantModuleRepository } from '../../repositories/tenantModuleRepository';
import { productOptionRepository } from '../../repositories/productOptionRepository';
import { isModuleEnabled, type ModuleKey } from '../../lib/modules';
import { friendlyTableError } from '../../lib/salon/tableQr';
import { mesasQrRepository } from '../../repositories/mesasQrRepository';
import { tableAccessRepository, type FreeSalonTable, type InvitePreview } from '../../repositories/tableAccessRepository';
import {
  clearPendingMesa, endedMessage, friendlyAccessError, inviteUrl, readInviteParam, readPendingMesaDetails, rememberPendingMesa,
  PENDING_APPROVAL_TEXT, PENDING_APPROVAL_TITLE, PENDING_TABLE_TEXT,
  type TabInvite, type TabMember,
} from '../../lib/customer/tableAccess';
import { ConfirmLoggedUserGate, IdentityGate, InvitePanel, InviteWelcomeScreen, MembersPanel, TableInUseScreen } from '../../components/client/dinein/TableAccessPanels';
import { optionPriceCents, validateOptionSelection } from '../../lib/addons';
import { ProductOptionsSelector } from '../../components/client/customer/ProductOptionsSelector';
import { DineInCartSheet } from '../../components/client/dinein/DineInCartSheet';
import { StoreHomeScreen } from '../../components/client/storeHome/StoreHomeScreen';
import { DEFAULT_HOME_DESIGN, type HomeAction, type StoreHomeDesign } from '../../lib/storeHome/storeHome.model';
import { homeActionAvailability, type HomeVisibilityContext } from '../../lib/storeHome/storeHomeVisibility';
import { storeHomeRepository } from '../../repositories/storeHomeRepository';

import { DineInTotemMenu } from '../../components/client/dinein/DineInTotemMenu';
import { DineInPremiumMenuAdapter } from '../../components/client/totem/DineInPremiumMenuAdapter';
import { menuOutdoorRepository, type PublicMenuOutdoorSlide } from '../../repositories/menuOutdoorRepository';
import { safeHomeImageUrl } from '../../lib/storeHome/storeHome.model';
import { DineInDeliveryCode, DineInDeliveryNotice, DineInTracking } from '../../components/client/dinein/DineInTracking';
import { dineInStatus, type DineInTrackedRound } from '../../lib/customer/dineInTracking';
import { canDisputeDelivery, deliveryNoticeLabel, type DeliveryState } from '../../lib/customer/deliveryDispute';
import { statusColorStyle } from '../../lib/orders/statusColors';
import { restoreDineInCart, saveDineInCart } from '../../lib/customer/dineInCartStorage';
import { applyStoreIdentity } from '../../lib/pwa/applyStoreIdentity';
import { clearDeferredPrompt, getDeferredPrompt } from '../../lib/pwa/installState';
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
type TabRound = DineInTrackedRound & DeliveryState & { customerName: string; mine?: boolean; subtotal: number; items: Array<{ name: string; quantity: number; unitPrice: number; totalPrice: number; deliveredAt?: string | null }> };
type MyTab = { tabId: string; status: 'OPEN' | 'BILL_REQUESTED' | 'WAITER_AUTHORIZED' | 'AWAITING_PAYMENT' | 'CLOSED' | 'CANCELLED'; pixStatus?: string | null; mode: 'TABLE' | 'INDIVIDUAL'; tableId?: string; tableLabel: string; joinedTables?: Array<{ id: string; label: string }>; tableMoves?: Array<{ id: string; action: 'MOVE' | 'JOIN' | 'SEPARATE'; fromLabel: string; toLabel: string; actorKind: string; actorName?: string; createdAt: string }>; serviceFeePercent: number; serviceFeeRemoved: boolean; rounds: TabRound[]; subtotal: number;
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
  const [resolvedToken, setResolvedToken] = useState('');
  const [storeName, setStoreName] = useState('');
  const [storeLogoUrl, setStoreLogoUrl] = useState<string | null>(null);
  const [storePrimaryColor, setStorePrimaryColor] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuTheme, setMenuTheme] = useState<MenuTheme>();
  const [menuOptions, setMenuOptions] = useState<MenuOptions>({ ...DEFAULT_MENU_OPTIONS });
  const [ownOutdoor, setOwnOutdoor] = useState<{slug: string; slides: PublicMenuOutdoorSlide[]}>({slug:'',slides:[]});
  const [appOutdoorSlides, setAppOutdoorSlides] = useState<PublicMenuOutdoorSlide[]>([]);
  const [storeHomeDesign, setStoreHomeDesign] = useState<StoreHomeDesign>(DEFAULT_HOME_DESIGN);
  const [enabledModules, setEnabledModules] = useState<ReadonlySet<ModuleKey> | null>(null);
  const [storeFulfillment, setStoreFulfillment] = useState<{ delivery: boolean; pickup: boolean }>({ delivery: true, pickup: true });

  const [storeTenantId, setStoreTenantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [firstName, setFirstName] = useState(() => {
    try { return localStorage.getItem('adegafood_cust_name')?.trim().split(/\s+/)[0] || ''; } catch { return ''; }
  });
  const [sessionId, setSessionId] = useState('');
  const [tab, setTab] = useState<MyTab | null>(null);
  const [cart, setCart] = useState<DineInCartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  // QR leva diretamente ao cardápio; Início só aparece após navegação explícita.
  const [view, setView] = useState<'HOME' | 'MENU'>('MENU');
  const [cartHydratedToken, setCartHydratedToken] = useState('');
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutIdentityOpen, setCheckoutIdentityOpen] = useState(false);
  const [optionsProduct, setOptionsProduct] = useState<Product | null>(null);
  const [optionChoices, setOptionChoices] = useState<SelectedProductOption[]>([]);
  const optionsFromUpsell = useRef(false);
  const pendingUpsellAdd = useRef<{ product: Product; items: UpsellCartItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
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
  const [accessReady, setAccessReady] = useState(false);
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
  const [disputeBusyId, setDisputeBusyId] = useState<string | null>(null);
  const [moveTableOpen, setMoveTableOpen] = useState(false);
  const [freeTables, setFreeTables] = useState<FreeSalonTable[]>([]);
  const [moveTableBusy, setMoveTableBusy] = useState(false);
  const [moveQrTokenInput, setMoveQrTokenInput] = useState('');
  const [moveTableError, setMoveTableError] = useState('');
  const [moveRequest, setMoveRequest] = useState<TableMoveRequest | null>(null);
  const moveRequestRefresh = useRef(0);

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
  const premiumFinanceLockRef = useRef(false);
  const openedUserRef = useRef('');
  const pingedRef = useRef('');
  const activeIdentityRef = useRef({ token, userId: supabaseUser?.id, sessionId, generation: 0 });
  const generation = activeIdentityRef.current.generation + (activeIdentityRef.current.token !== token || activeIdentityRef.current.userId !== supabaseUser?.id ? 1 : 0);
  activeIdentityRef.current = { token, userId: supabaseUser?.id, sessionId, generation };
  const contextMatches = useCallback((source: typeof activeIdentityRef.current, includeSession = true) => (
    source.token === token && source.userId === supabaseUser?.id && source.generation === activeIdentityRef.current.generation
    && (!includeSession || source.sessionId === activeIdentityRef.current.sessionId)
  ), [token, supabaseUser?.id]);
  const previousUserRef = useRef(supabaseUser?.id);
  const identitySwitchPendingRef = useRef(false);

  useEffect(() => {
    if (previousUserRef.current && previousUserRef.current !== supabaseUser?.id) {
      identitySwitchPendingRef.current = true;
      setView('MENU');
      setSessionId(''); setTab(null); setTabClosed(false); setAccountOpen(false); setBillOpen(false);
      setBusy(false); setJoinBusy(false); setInviteBusy(false); setMembersBusy(false);
      setDisputeBusyId(null);
      setEntryRole(null); setEntryApproved(null); setInUse(false); setInvite(null); setEndedReason(null);
      setConfirmOrderOpen(false); setPendingApproval(false); setAwaitingReleaseModalOpen(false);
      setOptionsProduct(null); setOptionChoices([]);
      pendingUpsellAdd.current = null; optionsFromUpsell.current = false;
      submitLockRef.current = false; submitKeyRef.current = uuid();
      setIdentityConfirmed(false); openedUserRef.current = '';
      try { sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${token}`); } catch { /* storage optional */ }
    }
    previousUserRef.current = supabaseUser?.id;
  }, [supabaseUser?.id, token]);

  useEffect(() => {
    setMoveTableOpen(false); setFreeTables([]); setMoveQrTokenInput('');
    setMoveTableError(''); setMoveTableBusy(false); setMoveRequest(null); moveRequestRefresh.current++;
  }, [token, supabaseUser?.id, sessionId]);

  const subtotalCents = Math.round((tab?.subtotal || 0) * 100);
  const serviceFeeCents = tab && !tab.serviceFeeRemoved
    ? Math.round(subtotalCents * tab.serviceFeePercent / 100)
    : 0;
  const accountTotalCents = subtotalCents + serviceFeeCents;
  const cashTenderStatus = tenderStatus(accountTotalCents, parseTenderCents(tendered));
  const needsIdentity = !supabaseUser || supabaseUser.is_anonymous === true;
  const myRole = tab?.me?.role || entryRole;
  const approvedNow = tab?.me ? tab.me.approved : entryApproved;
  const awaitingRelease = access ? approvedNow === false : pendingApproval;
  // Parte E: Enquanto aguarda liberação, o cardápio fica visível e o cliente pode montar a sacola.
  const billRequested = !!tab && ['BILL_REQUESTED', 'WAITER_AUTHORIZED', 'AWAITING_PAYMENT'].includes(tab.status);
  const billReopenAllowed = !!sessionId && !tabClosed && !qrPaused && canReopenBill(tab?.status, tab?.pixStatus);
  const awaitingPix = tab?.status === 'AWAITING_PAYMENT';
  const billStatusLabel = awaitingPix ? 'Aguardando PIX' : 'Conta pedida';
  const billColors = statusColorStyle(awaitingPix ? 'AWAITING_PAYMENT' : tab?.status === 'WAITER_AUTHORIZED' ? 'AUTHORIZED' : 'BILL');
  const orderingDisabled = qrPaused || tabClosed || billRequested;
  const upsell = useSmartUpsell({
    slug: resolution?.tenantSlug || '',
    identityKey: needsIdentity ? null : supabaseUser!.id,
    cartScopeKey: token,
    products, channel: 'TOTEM',
    hidden: loading || view !== 'MENU' || busy || orderingDisabled || !!optionsProduct
      || checkoutIdentityOpen || confirmOrderOpen || accountOpen || billOpen || awaitingReleaseModalOpen || moveTableOpen,
    onAcceptProduct: product => addItem(product, true),
  });
  const { trackOrder: trackUpsellOrder, beforeCheckout: beforeUpsellCheckout, notifyAdded: notifyUpsellAdded } = upsell;
  const reviewRound = useCallback(() => {
    void beforeUpsellCheckout(cart.map(line => ({ productId: line.product.id, quantity: line.quantity })), () => setConfirmOrderOpen(true));
  }, [beforeUpsellCheckout, cart]);
  // Modo totem: após a inatividade, descarta a sacola e volta ao início do QR.
  const kioskActive = menuOptions.totemMode && view === 'MENU';
  // Apenas o modo totem de QR de mesa: nunca /app/:slug ou vitrine mobile.
  const premiumTotemActive = kioskActive && Boolean(storeTenantId);
  const outdoorSlides = menuOptions.reuseAppBanners
    ? appOutdoorSlides
    : (ownOutdoor.slug === resolution?.tenantSlug ? ownOutdoor.slides : []);
  const resetKioskSession = useCallback(() => {
    upsell.clear();
    setCart([]); setCheckoutPending(false);
    setCartOpen(false); setConfirmOrderOpen(false); setCheckoutIdentityOpen(false);
    setOptionsProduct(null); setOptionChoices([]);
    pendingUpsellAdd.current = null; optionsFromUpsell.current = false;
    setView('HOME');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upsell.clear]);
  const resetPremiumKioskSession = useCallback(() => {
    // O mesmo reset visual do quiosque, agora com invalidação de identidade.
    activeIdentityRef.current.generation += 1;
    upsell.clear();
    setCart([]);
    setCheckoutPending(false);
    setCartOpen(false); setConfirmOrderOpen(false); setCheckoutIdentityOpen(false);
    setOptionsProduct(null); setOptionChoices([]);
    setBillOpen(false); setAccountOpen(false);
    setAwaitingReleaseModalOpen(false);
    setTab(null); setTabClosed(false); setSessionId('');
    setEntered(false); setEntryDone(false); setEntryApproved(null); setEntryRole(null);
    setIdentityConfirmed(false); setPendingApproval(false);
    openedUserRef.current = '';
    submitLockRef.current = false;
    submitKeyRef.current = uuid();
    pendingUpsellAdd.current = null; optionsFromUpsell.current = false;
    setView('HOME');
    try { sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${token}`); } catch { /* optional */ }
    saveDineInCart(typeof localStorage !== 'undefined' ? localStorage : null, token, [], false);
    // Dispositivo compartilhado: não conservar o usuário anterior autenticado.
    if (supabaseUser) void Promise.resolve(signOut()).catch(() => {
      setNotice('Sessão anterior encerrada localmente. Faça nova identificação.');
    });
  }, [token, supabaseUser, signOut, upsell.clear]);

  useEffect(() => {
    const added = pendingUpsellAdd.current;
    if (!added || optionsProduct) return;
    pendingUpsellAdd.current = null;
    void notifyUpsellAdded(added.product, added.items);
  }, [cart, optionsProduct, notifyUpsellAdded]);
  const split = useMemo(() => {
    const customCents = parseTenderCents(customShare) || 0;
    try { return billSplitAmounts(accountTotalCents, splitMode, Number(splitParts), customCents); } catch { return []; }
  }, [accountTotalCents, splitMode, splitParts, customShare]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setAccessReady(false);
    setResolution(null);
    setResolvedToken('');
    setStoreName(''); setStoreLogoUrl(null); setStorePrimaryColor(null); setProducts([]);
    setCategories([]); setMenuTheme(undefined); setStoreTenantId('');
    setOwnOutdoor({slug:'', slides:[]}); setAppOutdoorSlides([]);
    setQrPaused(false); setInvitePreview(null);
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
      setResolvedToken(token);
      setAccessReady(true);
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
        if (!alive) return;
        const optionGroups = isModuleEnabled(enabledModules, 'addons')
          ? await productOptionRepository.getPublicForProducts(store.data.tenant.id, store.data.products.map(product => product.id))
          : new Map();
        if (!alive) return;
        setStoreName(result.storeName || store.data.theme?.storeName || store.data.tenant.name);
        setStoreTenantId(store.data.tenant.id);
        setCategories(store.data.categories || []);
        setMenuTheme(store.data.menuTheme);
        setMenuOptions(store.data.menuOptions ?? { ...DEFAULT_MENU_OPTIONS });
        // Mídia PUBLICADA da mesma loja, já autorizada pelo get_public_store.
        const appBanners: PublicMenuOutdoorSlide[] = store.data.offers
          .filter(offer => offer.tenantId === store.data.tenant.id && offer.isActive === true)
          .flatMap(offer => {
            const src = safeHomeImageUrl(offer.mediaUrl || offer.imageUrl);
            if (!src) return [];
            const duration = Number(offer.durationSeconds);
            return [{ id: `app:${offer.id}`, title: offer.title,
              ...(offer.mediaType === 'VIDEO' ? {videoUrl: src} : {imageUrl: src}),
              imageDurationSeconds: Number.isInteger(duration) && duration >= 1 && duration <= 120 ? duration : 6 }];
          });
        setAppOutdoorSlides(appBanners);
        setEnabledModules(enabledModules);
        setStoreFulfillment({
          delivery: store.data.settings?.deliveryEnabled !== false,
          pickup: store.data.settings?.pickupEnabled !== false,
        });
        void storeHomeRepository.loadPublic(result.tenantSlug).then(design => {
          if (alive) setStoreHomeDesign(design ?? DEFAULT_HOME_DESIGN);
        }).catch(() => { if (alive) setStoreHomeDesign(DEFAULT_HOME_DESIGN); });

        if (store.data.theme?.logoUrl) setStoreLogoUrl(store.data.theme.logoUrl);
        if (store.data.theme?.primaryColor) setStorePrimaryColor(store.data.theme.primaryColor);
        void applyStoreIdentity({ id: store.data.tenant.id, slug: result.tenantSlug, name: store.data.tenant.name,
          theme: { storeName: store.data.theme?.storeName, logoUrl: store.data.theme?.logoUrl, primaryColor: store.data.theme?.primaryColor } }).catch(() => { /* install hint remains optional */ });
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

  // Outdoor por estabelecimento: nenhuma consulta a dados pessoais nem mídias privadas.
  useEffect(() => {
    const slug = resolution?.tenantSlug || '';
    let active = true;
    if (!slug || menuOptions.reuseAppBanners) return () => { active = false; };
    setOwnOutdoor({slug: '', slides: []});
    void menuOutdoorRepository.getPublicSlides(slug)
      .then(slides => { if (active) setOwnOutdoor({slug, slides}); })
      .catch(() => { if (active) setOwnOutdoor({slug, slides: []}); });
    return () => { active = false; };
  }, [resolution?.tenantSlug, menuOptions.reuseAppBanners]);

  // Browsing never requires login. Only IDs/options are saved, under this QR, so OAuth/e-mail
  // confirmation can return to checkout without retaining customer data or stale prices.
  useEffect(() => {
    if (loading || cartHydratedToken === token) return;
    const draft = restoreDineInCart(typeof localStorage !== 'undefined' ? localStorage : null, token, products);
    setCart(draft.cart);
    setCheckoutPending(draft.checkoutPending);
    setCartHydratedToken(token);
  }, [loading, products, token, cartHydratedToken]);
  useEffect(() => {
    if (cartHydratedToken !== token) return;
    saveDineInCart(typeof localStorage !== 'undefined' ? localStorage : null, token, cart, checkoutPending);
  }, [cart, checkoutPending, token, cartHydratedToken]);

  useEffect(() => {
    deviceIdRef.current = deviceId();
    setView('MENU');
    setTab(null);
    setTabClosed(false);
    setSessionId('');
    setEntered(false);
    setBusy(false); setJoinBusy(false); setInviteBusy(false); setMembersBusy(false);
    setDisputeBusyId(null);
    setEntryRole(null); setEntryApproved(null); setInUse(false); setEntryDone(false); setEndedReason(null); setInvite(null);
    setAccountOpen(false); setBillOpen(false); setCartOpen(false); setConfirmOrderOpen(false); setCheckoutIdentityOpen(false);
    setOptionsProduct(null); setOptionChoices([]);
    pendingUpsellAdd.current = null; optionsFromUpsell.current = false;
    setPendingApproval(false); setAwaitingReleaseModalOpen(false);
    submitLockRef.current = false; submitKeyRef.current = uuid();
    setIdentityConfirmed(false);
    openedUserRef.current = '';
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
    if (loading || menuOptions.serviceMode === 'COUNTER' || !supabaseUser || resolvedToken !== token || !accessReady || !resolution?.available || !deviceIdRef.current) return;
    if (supabaseUser.is_anonymous || sessionId) return;
    // A saved session remains the account identity after moving tables. Never
    // reopen the original QR's now-free table while restoring that session.
    const source = activeIdentityRef.current;
    if (!contextMatches(source, false)) return;
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
          if (!contextMatches(source, false)) return;
          if (joined.entry) {
            applyEntry(joined.entry);
            return;
          }
          if (joined.free) {
            inviteParamRef.current = null;
            setInviteCode(null);
            const entry = await tableAccessRepository.enterTable(token, chosenName, deviceIdRef.current);
            if (!contextMatches(source, false)) return;
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
        if (!contextMatches(source, false)) return;
        applyEntry(entry);
      } catch (openError) {
        if (!contextMatches(source, false)) return;
        openedUserRef.current = '';
        const message = errorText(openError);
        if (/QR_PAUSED/i.test(message)) setQrPaused(true);
        const friendly = friendlyAccessError(message);
        setNotice(friendly);
        if (inviteParamRef.current || inviteCode) setJoinMessage(friendly);
      } finally {
        if (contextMatches(source, false)) {
          setEntryDone(true);
          setBusy(false);
          setJoinBusy(false);
        }
      }
      return;
    }
    const { data, error: openError } = await supabase.rpc('open_or_join_tab', {
      p_qr_token: token,
      p_display_name: guestDisplayName(overrideName || firstName),
      p_device_id: deviceIdRef.current,
    });
    if (!contextMatches(source, false)) return;
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
  }, [access, accessReady, applyEntry, contextMatches, displayNameForEntry, firstName, inviteCode, loading, menuOptions.serviceMode, resolution?.available, resolvedToken, sessionId, supabaseUser, token]);

  // Entrada pelo QR: o vínculo/ocupação é criado SOMENTE pelas RPCs
  // enterTable/open_or_join_tab depois da autenticação. Nunca por estado local.
  // Em tablet compartilhado, o reset por inatividade encerra a identidade anterior.
  useEffect(() => {
    if (access && accessReady && resolvedToken === token && resolution?.available &&
      !needsIdentity && !sessionId && !inviteCode && !identityConfirmed &&
      !identitySwitchPendingRef.current && menuOptions.serviceMode !== 'COUNTER') {
      setIdentityConfirmed(true);
    }
  }, [access, accessReady, resolvedToken, token, resolution?.available,
      needsIdentity, sessionId, inviteCode, identityConfirmed, menuOptions.serviceMode]);

  // Parte E: Com conta já logada no aparelho, exige confirmação ("Entrar como <Nome>?") antes de entrar na mesa.
  useEffect(() => {
    // The reset above and this effect run in the same flush. Do not reuse the
    // preceding account's confirmation before React applies its state reset.
    if (identitySwitchPendingRef.current) { identitySwitchPendingRef.current = false; return; }
    if (loading || menuOptions.serviceMode === 'COUNTER' || !supabaseUser || supabaseUser.is_anonymous || !resolution?.available) return;
    if (access) {
      if (!supabaseUser.is_anonymous && identityConfirmed) void openOrJoin();
      return;
    }
    if (!qrPaused) void openOrJoin();
  }, [supabaseUser, resolution?.available, qrPaused, access, identityConfirmed, openOrJoin, loading, menuOptions.serviceMode]);

  // Once registration/login returns, continue with the preserved cart; never send an order
  // automatically: the customer still reviews and confirms the items.
  useEffect(() => {
    if (!checkoutPending || needsIdentity || !sessionId || !cart.length || busy) return;
    if (checkoutIdentityOpen) { setCheckoutIdentityOpen(false); return; }
    if (awaitingRelease) { setAwaitingReleaseModalOpen(true); return; }
    if (!orderingDisabled) { setCheckoutPending(false); reviewRound(); }
  }, [checkoutPending, checkoutIdentityOpen, needsIdentity, sessionId, cart.length, busy, awaitingRelease, orderingDisabled, reviewRound]);

  const submitInviteCode = useCallback(async (code: string) => {
    if (!supabaseUser || !deviceIdRef.current) return;
    const source = activeIdentityRef.current;
    if (!contextMatches(source, false)) return;
    setJoinBusy(true);
    setJoinMessage('');
    try {
      const result = await tableAccessRepository.joinWithCode(token, code, displayNameForEntry(), deviceIdRef.current);
      if (!contextMatches(source, false)) return;
      if (result.entry) applyEntry(result.entry);
      else if (result.free) { openedUserRef.current = ''; setInUse(false); void openOrJoin(); }
      else setJoinMessage('Código inválido ou expirado. Confira com quem abriu a mesa ou peça um novo convite.');
    } catch (joinError) {
      if (contextMatches(source, false)) setJoinMessage(friendlyAccessError(errorText(joinError)));
    } finally { if (contextMatches(source, false)) setJoinBusy(false); }
  }, [applyEntry, contextMatches, displayNameForEntry, openOrJoin, supabaseUser, token]);

  // Cadastro novo ou convite: lembra a mesa e o código de convite para voltar depois do e-mail de confirmação.
  useEffect(() => {
    if (needsIdentity || inviteCode) {
      rememberPendingMesa(typeof localStorage !== 'undefined' ? localStorage : null, token, Date.now(), inviteCode);
    }
  }, [needsIdentity, token, inviteCode]);

  const loadAccount = useCallback(async (silent = false) => {
    if (!sessionId) return;
    const source = activeIdentityRef.current;
    if (!contextMatches(source)) return;
    if (!silent) setBusy(true);
    const moveRefresh = ++moveRequestRefresh.current;
    const { data, error: accountError } = await supabase.rpc('get_my_tab', { p_session_id: sessionId });
    if (!contextMatches(source)) return;
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
    if (!accountError && data && (data as MyTab).me?.approved === true) {
      try {
        const requests = await tableMoveApprovalRepository.mine(sessionId);
        if (contextMatches(source) && moveRefresh === moveRequestRefresh.current) setMoveRequest(requests[0] || null);
      } catch { /* Keep a pending request visible when the status refresh is offline. */ }
    }
    if (!silent && contextMatches(source)) setBusy(false);
  }, [access, contextMatches, sessionId, token]);

  useEffect(() => {
    if (!sessionId) return;
    void loadAccount(true);
    // Enquanto a mesa aguarda liberação, confere com mais frequência + escuta Realtime para liberar a tela assim que o garçom aprovar.
    const interval = window.setInterval(() => void loadAccount(true), access && awaitingRelease ? 3000 : 15000);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (typeof supabase?.channel === 'function') {
      try {
        channel = supabase
          .channel(`dinein-session-${sessionId}-${uuid()}`)
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
    if (!tab?.tabId || typeof supabase?.channel !== 'function') return;
    // The revision row contains only tenant/tab IDs and a timestamp, with server RLS.
    // Never subscribe to other customers' orders to calculate a queue position.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const refresh = () => { void loadAccount(true); };
    try {
      channel = supabase.channel(`dinein-tracking-${tab.tabId}-${uuid()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tracking_revisions', filter: `tab_id=eq.${tab.tabId}` }, refresh)
        .subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
    } catch { /* periodic refresh remains available if realtime is offline */ }
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      if (channel && typeof supabase?.removeChannel === 'function') void supabase.removeChannel(channel);
    };
  }, [tab?.tabId, loadAccount]);

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
    const source = activeIdentityRef.current;
    if (!contextMatches(source) || source.sessionId !== sessionId) return;
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
    if (!contextMatches(source)) return;
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
      if (typeof data.orderId === 'string') void trackUpsellOrder(data.orderId);
      setConfirmOrderOpen(false);
      setPendingApproval(false);
      setAwaitingReleaseModalOpen(false);
      if (access) setEntryApproved(true);
      setCart([]);
      setCartOpen(false);
      setCheckoutPending(false);
      submitKeyRef.current = uuid();
      setNotice('Pedido feito! A cozinha já recebeu.');
      await loadAccount(true);
    }
  }, [access, cart, contextMatches, loadAccount, sessionId, tabClosed, trackUpsellOrder]);

  useEffect(() => {
    if (!pendingApproval || tabClosed) return;
    const retry = window.setInterval(() => void submitRound(), APPROVAL_RETRY_MS);
    return () => window.clearInterval(retry);
  }, [pendingApproval, submitRound, tabClosed]);

  const handleRequestOrder = () => {
    if (cart.length === 0 || orderingDisabled || busy) return;
    setCartOpen(false);
    if (needsIdentity) {
      setCheckoutPending(true);
      setCheckoutIdentityOpen(true);
      rememberPendingMesa(typeof localStorage !== 'undefined' ? localStorage : null, token, Date.now(), inviteCode);
      return;
    }
    if (!sessionId) {
      setCheckoutPending(true);
      setIdentityConfirmed(true);
      void openOrJoin();
      return;
    }
    if (awaitingRelease) {
      setAwaitingReleaseModalOpen(true);
      if (sessionId) void tableAccessRepository.pingPending(sessionId);
      return;
    }
    reviewRound();
  };

  const addItem = (product: Product, fromUpsell = false) => {
    if (orderingDisabled || busy || !products.some(item => item.id === product.id)) return;
    if (product.optionGroups?.some(group => group.active)) {
      optionsFromUpsell.current = fromUpsell;
      setOptionsProduct(product);
      setOptionChoices([]);
      return;
    }
    const next = addDineInCartLine(cart, product);
    if (!fromUpsell) pendingUpsellAdd.current = { product, items: next.map(line => ({ productId: line.product.id, quantity: line.quantity })) };
    setCart(next);
    triggerAddedFeedback(product.name, 1);
  };
  const addConfiguredItem = () => {
    if (!optionsProduct || orderingDisabled || busy || !products.some(item => item.id === optionsProduct.id)) return;
    const groups = optionsProduct.optionGroups?.filter(group => group.active) || [];
    const validation = validateOptionSelection(groups, optionChoices);
    if (!validation.valid) {
      setNotice(validation.messages[0] || 'Confira os adicionais selecionados.');
      return;
    }
    const addedName = optionsProduct.name;
    const next = addDineInCartLine(cart, optionsProduct, optionChoices);
    if (!optionsFromUpsell.current) pendingUpsellAdd.current = { product: optionsProduct, items: next.map(line => ({ productId: line.product.id, quantity: line.quantity })) };
    optionsFromUpsell.current = false;
    setCart(next);
    setOptionsProduct(null);
    setOptionChoices([]);
    setNotice('');
    triggerAddedFeedback(addedName, 1);
  };
  const changeLineQuantity = (key: string, delta: number) => {
    if (delta > 0) {
      const line = cart.find(item => item.key === key);
      if (line) triggerAddedFeedback(line.product.name, delta);
    }
    const next = changeDineInCartLineQuantity(cart, key, delta);
    setCart(next);
    if (!next.length) upsell.clear();
  };
  const changeLineNotes = (key: string, lineNotes: string) =>
    setCart(current => setDineInCartLineNotes(current, key, lineNotes));

  const handleSwitchAccount = async () => {
    try { sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${token}`); } catch { /* ignore */ }
    setSessionId('');
    setTab(null);
    setTabClosed(false);
    setAccountOpen(false);
    setBillOpen(false);
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
    const source = activeIdentityRef.current;
    setBusy(true);
    const { error: callError } = await supabase.rpc('call_waiter', { p_session_id: sessionId, p_type: 'CALL' });
    if (!contextMatches(source)) return;
    setBusy(false);
    setNotice(callError ? errorText(callError) : 'Chamamos o garçom. Ele já vai até sua mesa.');
  };

  const requestBill = async () => {
    if (!sessionId || billRequested) return;
    const source = activeIdentityRef.current;
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
    if (!contextMatches(source)) return;
    if (billResult.error && isMissingBillChoiceSignature(billResult.error)) {
      legacyFallback = true;
      billResult = await supabase.rpc('request_bill', { p_session_id: sessionId });
      if (!contextMatches(source)) return;
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
      : `Conta solicitada. Aguardando autorização do caixa. Preferência: ${paymentChoices.find(choice => choice.value === paymentMethod)?.label}.`);
  };

  const reopenBill = async () => {
    if (!billReopenAllowed || busy) return;
    const source = activeIdentityRef.current;
    setBusy(true);
    try {
      const { error: reopenError } = await supabase.rpc('reopen_tab_from_bill', { p_session_id: sessionId });
      if (!contextMatches(source)) return;
      if (reopenError) {
        const message = errorText(reopenError);
        setNotice(/PIX|PAYMENT|TAB_CLOSED/i.test(message)
          ? 'O pagamento já está em andamento ou foi confirmado. Chame o garçom para conferir.'
          : /RATE|LIMIT/i.test(message)
            ? 'Aguarde um pouco antes de tentar reabrir a conta novamente.'
            : 'Não foi possível reabrir a conta. Chame o garçom para ajudar.');
      } else {
        setBillOpen(false);
        setNotice('Comanda reaberta. Você já pode pedir mais; a equipe foi avisada.');
      }
      await loadAccount(true);
    } catch {
      if (contextMatches(source)) setNotice('Não foi possível reabrir a conta. Confira sua conexão e tente novamente.');
    } finally {
      if (contextMatches(source)) setBusy(false);
    }
  };

  // Integração financeira exclusiva do TOTEM Premium.
  // Uma escolha é sempre explicitamente enviada, sem fallback de assinatura antiga.
  const premiumSession = () => {
    const source = activeIdentityRef.current;
    if (!access || !sessionId || needsIdentity || tabClosed || !tab ||
      !tab.me?.approved || tab.me.sessionId !== sessionId ||
      source.sessionId !== sessionId || !contextMatches(source)) {
      throw new Error('Sessão não autorizada ou expirada. Entre novamente na mesa.');
    }
    return source;
  };
  const refreshPremiumExpenses = async (): Promise<void> => {
    const source = premiumSession();
    const { data, error: rpcError } = await supabase.rpc('get_my_tab', { p_session_id: source.sessionId });
    if (!contextMatches(source)) throw new Error('A sessão mudou durante a consulta.');
    if (rpcError || !data) throw new Error(errorText(rpcError) || 'Não foi possível atualizar a comanda.');
    const updated = data as MyTab;
    // Não confiar só na identidade do navegador ou no ID em storage.
    if (updated.me?.sessionId !== source.sessionId || updated.me?.approved !== true) {
      throw new Error('A resposta do servidor não pertence à sessão autorizada.');
    }
    setTab(updated);
    if (updated.status === 'CLOSED' || updated.status === 'CANCELLED') setTabClosed(true);
  };
  const premiumFinancialOperation = async (action: (sid: string) => Promise<void>) => {
    const source = premiumSession();
    if (busy || premiumFinanceLockRef.current) throw new Error('Aguarde a operação anterior.');
    premiumFinanceLockRef.current = true;
    setBusy(true);
    try {
      await action(source.sessionId);
      if (!contextMatches(source)) throw new Error('A sessão mudou durante a operação.');
      try { await refreshPremiumExpenses(); }
      catch { if (contextMatches(source)) setNotice('Solicitação enviada. Atualize a comanda para consultar o novo status.'); }
    } finally {
      premiumFinanceLockRef.current = false;
      if (contextMatches(source)) setBusy(false);
    }
  };
  const requestPremiumBill = async (choice: 'CARD' | 'PIX' | 'CAIXA') => {
    if (tab?.status !== 'OPEN') throw new Error('Esta comanda não está aberta.');
    await premiumFinancialOperation(async sid => {
      const { error: rpcError } = await supabase.rpc('request_bill', {
        p_session_id: sid, p_choice: choice, p_cash_tendered_cents: null,
      });
      if (rpcError) throw new Error(errorText(rpcError) || 'Não foi possível solicitar a conta.');
      setNotice('Conta solicitada. A equipe foi avisada.');
    });
  };
  const callWaiterFromPremium = async () => {
    await premiumFinancialOperation(async sid => {
      const { error: rpcError } = await supabase.rpc('call_waiter', { p_session_id: sid, p_type: 'CALL' });
      if (rpcError) throw new Error(errorText(rpcError) || 'Não foi possível chamar o garçom.');
      setNotice('Garçom chamado. Aguarde o atendimento.');
    });
  };
  const reopenBillFromPremium = async () => {
    if (!canReopenBill(tab?.status, tab?.pixStatus)) throw new Error('Comanda não pode ser reaberta agora.');
    await premiumFinancialOperation(async sid => {
      const { error: rpcError } = await supabase.rpc('reopen_tab_from_bill', { p_session_id: sid });
      if (rpcError) throw new Error(errorText(rpcError) || 'Não foi possível reabrir a comanda.');
      setNotice('Comanda reaberta após autorização do servidor.');
    });
  };

  const disputeDelivery = async (orderId: string) => {
    const round = tab?.rounds?.find(item => item.orderId === orderId && item.mine !== false);
    if (!sessionId || disputeBusyId || !round || !canDisputeDelivery(round)) return;
    const source = activeIdentityRef.current;
    setDisputeBusyId(orderId);
    try {
      const { error: disputeError } = await supabase.rpc('customer_dispute_delivery', { p_session_id: sessionId, p_order: orderId });
      if (!contextMatches(source)) return;
      if (disputeError) {
        const message = errorText(disputeError);
        setNotice(/WINDOW|EXPIRED|TIME|5_MIN/i.test(message)
          ? 'O prazo de 5 minutos terminou. Chame o garçom para conferir sua entrega.'
          : 'Não foi possível avisar sobre a entrega. Chame o garçom para ajudar.');
      } else setNotice('Avisamos a equipe de que você não recebeu o pedido. O garçom vai conferir.');
      await loadAccount(true);
    } catch {
      if (contextMatches(source)) setNotice('Não foi possível avisar sobre a entrega. Confira sua conexão e tente novamente.');
    } finally {
      if (contextMatches(source)) setDisputeBusyId(null);
    }
  };

  // Convite (só o Responsável): código curto que expira, revogável.
  const createInvite = async () => {
    if (!sessionId) return;
    const source = activeIdentityRef.current;
    setInviteBusy(true);
    try { const next = await tableAccessRepository.createInvite(sessionId, 15); if (contextMatches(source)) { setInvite(next); setNotice(''); } }
    catch (inviteError) { if (contextMatches(source)) setNotice(friendlyAccessError(errorText(inviteError))); }
    finally { if (contextMatches(source)) setInviteBusy(false); }
  };
  const revokeInvite = async () => {
    if (!sessionId) return;
    const source = activeIdentityRef.current;
    setInviteBusy(true);
    try { await tableAccessRepository.revokeInvite(sessionId); if (contextMatches(source)) setInvite(null); }
    catch (inviteError) { if (contextMatches(source)) setNotice(friendlyAccessError(errorText(inviteError))); }
    finally { if (contextMatches(source)) setInviteBusy(false); }
  };
  const removeMember = async (member: TabMember) => {
    const source = activeIdentityRef.current;
    setMembersBusy(true);
    try { await tableAccessRepository.removeGuest(sessionId, member.sessionId); if (contextMatches(source)) { setNotice(`${member.displayName} foi removido da mesa.`); await loadAccount(true); } }
    catch (memberError) { if (contextMatches(source)) setNotice(friendlyAccessError(errorText(memberError))); }
    finally { if (contextMatches(source)) setMembersBusy(false); }
  };
  const transferTo = async (member: TabMember) => {
    const source = activeIdentityRef.current;
    setMembersBusy(true);
    try { await tableAccessRepository.transferResponsibility(sessionId, member.sessionId); if (contextMatches(source)) { setNotice(`${member.displayName} agora é o responsável pela mesa.`); setInvite(null); await loadAccount(true); } }
    catch (memberError) { if (contextMatches(source)) setNotice(friendlyAccessError(errorText(memberError))); }
    finally { if (contextMatches(source)) setMembersBusy(false); }
  };

  const openMoveTableModal = async () => {
    if (!sessionId || tabClosed || billRequested || moveRequest?.status === 'PENDING') return;
    const source = activeIdentityRef.current;
    setMoveTableError('');
    setFreeTables([]);
    setMoveQrTokenInput('');
    setMoveTableOpen(true);
    setMoveTableBusy(true);
    try {
      const list = await tableAccessRepository.listFreeTables(source.sessionId);
      if (contextMatches(source)) setFreeTables(list);
    } catch (err) {
      if (contextMatches(source)) setMoveTableError(errorText(err) || 'Não foi possível carregar as mesas livres.');
    } finally {
      if (contextMatches(source)) setMoveTableBusy(false);
    }
  };

  const submitMoveTable = async (target: { tableId?: string; qrToken?: string }) => {
    if (!sessionId || moveTableBusy || tabClosed || billRequested || moveRequest?.status === 'PENDING') return;
    const source = activeIdentityRef.current;
    setMoveTableBusy(true);
    setMoveTableError('');
    try {
      const res = await tableAccessRepository.moveTable(source.sessionId, target);
      if (!contextMatches(source)) return;
      if (res.status !== 'PENDING' || !res.requestId) throw new Error('Não foi possível confirmar a solicitação. Atualize a conta ou chame a equipe.');
      setMoveTableOpen(false);
      setMoveQrTokenInput('');
      setMoveRequest({ id: res.requestId, status: 'PENDING', tabId: res.tabId, fromTableId: res.fromTableId, fromLabel: res.fromLabel, toTableId: res.toTableId, toLabel: res.toLabel, requestedAt: new Date().toISOString() });
      setNotice('Solicitação de mudança de mesa enviada. Aguarde a autorização da equipe; sua conta continua na mesa atual.');
      await loadAccount(true);
    } catch (err) {
      if (!contextMatches(source)) return;
      const msg = errorText(err);
      setMoveTableError(
        /TABLE_OCCUPIED/i.test(msg)
          ? 'Esta mesa já está ocupada. Peça ao garçom para juntar as mesas.'
          : /MOVE_BLOCKED_BILL/i.test(msg)
            ? 'Não é permitido mudar de mesa com conta pedida ou aguardando PIX.'
            : /TABLE_UNAVAILABLE/i.test(msg)
              ? 'Mesa indisponível ou de outro estabelecimento.'
              : msg || 'Não foi possível mudar de mesa.',
      );
    } finally {
      if (contextMatches(source)) setMoveTableBusy(false);
    }
  };

  useEffect(() => {
    if (!access || !accountOpen || myRole !== 'RESPONSIBLE' || !sessionId) return;
    let alive = true;
    const source = activeIdentityRef.current;
    void tableAccessRepository.getInvite(sessionId).then(current => { if (alive && contextMatches(source)) setInvite(current); }).catch(() => { /* optional */ });
    return () => { alive = false; };
  }, [access, accountOpen, contextMatches, myRole, sessionId]);

  const unavailable = !loading && (!resolution?.available || Boolean(error));
  const totalCartCents = cart.reduce((sum, line) => sum + dineInCartLineUnitPriceCents(line) * line.quantity, 0);
  const totalCart = totalCartCents / 100;
  const totalCartItems = cart.reduce((sum, line) => sum + line.quantity, 0);
  const customerDisplayName = tab?.me?.displayName || displayNameForEntry();
  const openStoreApp: React.MouseEventHandler<HTMLAnchorElement> = event => {
    const prompt = getDeferredPrompt();
    if (prompt) {
      event.preventDefault();
      void prompt.prompt().then(() => clearDeferredPrompt()).catch(() => { /* the store link remains available to retry */ });
    }
  };

  // Restore the saved bag before exposing Add/Checkout: a first click must never
  // be overwritten by the hydration effect, including after changing table QR.
  if (loading || (!error && resolution?.available && cartHydratedToken !== token)) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-700"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando mesa e cardápio…</div>;
  if (unavailable) {
    return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><section className="max-w-sm rounded-3xl bg-white p-7 text-center shadow-xl"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-amber-600" /><h1 className="text-xl font-extrabold">Salão indisponível no momento</h1><p className="mt-2 text-sm text-slate-600">{error || 'Confira o QR Code ou chame um atendente.'}</p></section></main>;
  }

  if (menuOptions.serviceMode === 'COUNTER') return <main className="grid min-h-screen place-items-center bg-slate-950 p-8 text-center text-white"><section className="max-w-lg"><h1 className="text-2xl font-bold">Atendimento no balcão</h1><p className="mt-3">Este QR de mesa não está disponível neste modo. Use o dispositivo de balcão autorizado ou peça ajuda à equipe.</p></section></main>;

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
  if (access && inviteCode && !sessionId && !inUse && (!needsIdentity || checkoutIdentityOpen)) {
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
  if (needsIdentity && checkoutIdentityOpen) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <IdentityGate
          storeName={displayStoreName}
          tableLabel={tableName}
          initialName={firstName}
          intro="Falta só um cadastro rápido para finalizar na loja. Sua sacola está guardada; depois você confere e confirma o pedido."
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
        <button type="button" onClick={() => { setCheckoutIdentityOpen(false); setCheckoutPending(false); setView('MENU'); }} className="mx-auto mt-4 block rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold">Voltar ao cardápio com a sacola</button>
        {notice && <p role="alert" className="mx-auto mt-4 max-w-md rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
      </main>
    );
  }
  // Parte E: Com conta já logada no aparelho, mostra sempre "Entrar como <Nome>?" antes de entrar sozinho.
  if (view === 'MENU' && access && !needsIdentity && !sessionId && !identityConfirmed) {
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
        <button type="button" onClick={() => setView('HOME')} className="mx-auto mt-4 block rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold">Voltar ao início</button>
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
  if (view === 'MENU' && access && !needsIdentity && !sessionId) {
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

  const homeVisibility: HomeVisibilityContext = {
    // Neste fluxo o cliente já entrou por QR de mesa.
    dineIn: true,
    delivery: isModuleEnabled(enabledModules, 'delivery') && storeFulfillment.delivery,
    pickup: isModuleEnabled(enabledModules, 'pickup') && storeFulfillment.pickup,
    kiosk: kioskActive,
  };

  const homeAvailable = homeActionAvailability(storeHomeDesign.actions, {
    hasSession: Boolean(sessionId),
    waiterEnabled: !busy && !tabClosed && !awaitingRelease,
    billEnabled: !busy && !tabClosed && !billRequested && !awaitingRelease,
  });

  const handleStoreHomeAction = (action: HomeAction) => {
    switch (action) {
      case 'MENU':
      case 'TABLE':
        setView('MENU');
        return;
      case 'ACCOUNT':
        if (sessionId) {
          setAccountOpen(true);
          void loadAccount();
        }
        return;
      case 'WAITER':
        if (sessionId && !busy && !tabClosed && !awaitingRelease) void requestWaiter();
        return;
      case 'BILL':
        if (sessionId && !busy && !tabClosed && !billRequested && !awaitingRelease) {
          setBillOpen(true);
          void loadAccount(true);
        }
        return;
      case 'PICKUP':
      case 'DELIVERY': {
        const slug = resolution?.tenantSlug;
        if (!slug) return;
        window.open(`/app/${encodeURIComponent(slug)}`, '_blank', 'noopener,noreferrer');
        return;
      }
      default:
        return;
    }
  };

  return (
    <main className={view === 'MENU' ? 'dinein-menu-shell bg-slate-50' : view === 'HOME' ? 'min-h-screen bg-[#071a14]' : 'min-h-screen bg-slate-50 pb-28'} data-kiosk={kioskActive || undefined}>
      <TotemKioskLayer enabled={kioskActive} idleSeconds={menuOptions.idleSeconds} onIdle={premiumTotemActive ? resetPremiumKioskSession : resetKioskSession} />
      {view === 'HOME' ? (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-2 p-3 sm:p-4">
          <div className="pointer-events-none min-w-0">
            {access && myRole && (
              <p data-testid="role-chip" className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-lg backdrop-blur">
                {myRole === 'RESPONSIBLE' ? <><Crown className="h-3.5 w-3.5 text-amber-500" />Você é o responsável pela mesa</> : <>Convidado{tab?.responsibleName ? ` de ${tab.responsibleName}` : ''}</>}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => { upsell.dismiss(); setCartOpen(true); }}
            data-testid="dinein-bag-counter"
            aria-label={`Sacola com ${totalCartItems} ${totalCartItems === 1 ? 'item' : 'itens'}`}
            className={`pointer-events-auto relative flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-black text-emerald-900 shadow-lg backdrop-blur transition-transform duration-300 ${bagBounce ? 'scale-110 ring-2 ring-emerald-500 animate-bounce' : 'scale-100'}`}
          >
            <ShoppingBag className="h-4 w-4 text-emerald-700" />
            <span>{totalCartItems}</span>
          </button>
          <button type="button" disabled={!sessionId} onClick={() => { setAccountOpen(true); void loadAccount(); }} aria-label="Ver minha conta" className="pointer-events-auto rounded-full bg-white/95 p-2 shadow-lg backdrop-blur disabled:opacity-40"><CircleUserRound className="h-6 w-6" /></button>
          </div>
        </div>
      ) : !premiumTotemActive ? (
      <header className="sticky top-0 z-20 border-b bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <div>
            <p className="font-extrabold">
              Você está na {mesaTitle(tab?.tableLabel || resolution?.tableLabel)}
              {tab?.joinedTables?.length ? ` + ${tab.joinedTables.map(jt => jt.label).join(' + ')}` : ''} · {storeName}
            </p>
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
            {sessionId && !tabClosed && (
              <button
                type="button"
                data-testid="dinein-move-table-btn"
                disabled={busy || billRequested || awaitingRelease || moveRequest?.status === 'PENDING'}
                title={billRequested ? 'Mudança bloqueada com conta pedida ou aguardando PIX' : 'Mudar de mesa'}
                onClick={() => void openMoveTableModal()}
                className="rounded-full border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 disabled:opacity-40"
              >
                Mudar de mesa
              </button>
            )}
            <button
              type="button"
              onClick={() => { upsell.dismiss(); setCartOpen(true); }}
              data-testid="dinein-bag-counter"
              aria-label={`Sacola com ${totalCartItems} ${totalCartItems === 1 ? 'item' : 'itens'}`}
              className={`relative flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-900 transition-transform duration-300 ${bagBounce ? 'scale-110 ring-2 ring-emerald-500 animate-bounce' : 'scale-100'}`}
            >
              <ShoppingBag className="h-4 w-4 text-emerald-700" />
              <span>{totalCartItems}</span>
            </button>
            <button type="button" disabled={!sessionId} onClick={() => { setAccountOpen(true); void loadAccount(); }} aria-label="Ver minha conta" className="rounded-full bg-slate-100 p-2 disabled:opacity-40"><CircleUserRound className="h-6 w-6" /></button>
          </div>
        </div>
      </header>
      ) : null}
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
      <div className={view === 'MENU' ? 'dinein-menu-notices' : undefined}>
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

      {tab?.me?.approved && tab.rounds.some(round => round.deliveryCode && !['DELIVERED', 'CANCELLED'].includes(round.status)) && <section aria-label="Seus códigos de entrega" aria-live="polite" className="mx-auto mt-3 max-w-2xl px-4">
        {tab.rounds.map(round => <DineInDeliveryCode key={round.orderId} round={round} testId={`dinein-delivery-code-${round.orderId}`} />)}
      </section>}

      {!!tab?.rounds?.length && resolution?.tenantSlug && <aside data-testid="dinein-app-banner" className="mx-auto mt-3 flex max-w-2xl items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
        <p className="text-slate-600">Peça também de casa com nosso app</p>
        <a href={`/app/${encodeURIComponent(resolution.tenantSlug)}`} target="_blank" rel="noopener noreferrer" className="shrink-0 font-bold text-emerald-800" onClick={openStoreApp}>Instalar app da loja</a>
      </aside>}

        {billRequested && !tabClosed && <section aria-label="Situação da conta" className={`mt-4 rounded-xl p-3 text-sm ${awaitingPix ? 'dinein-bill-awaiting-pix' : 'dinein-bill-requested'}`} style={billColors}>
          <p className="font-bold">{billStatusLabel}</p>
          <p className="mt-1">{awaitingPix ? 'Sua mesa continua ocupada até a confirmação do pagamento.' : billReopenAllowed ? 'Quer uma saideira? Reabra a comanda para fazer mais pedidos.' : 'O pagamento está em andamento. Aguarde a confirmação ou chame o garçom.'}</p>
          {billReopenAllowed && <button type="button" onClick={() => void reopenBill()} disabled={busy} data-testid="dinein-reopen-bill-btn" className="mt-3 rounded-lg border border-[#1E8E38] bg-[#2DBE4E] px-4 py-2 font-bold text-[#0F172A] disabled:opacity-50" style={{ backgroundColor: '#2DBE4E', borderColor: '#1E8E38', color: '#0F172A' }}>{busy ? 'Reabrindo…' : 'Pedir mais'}</button>}
        </section>}
        {tab?.rounds?.filter(round => round.mine !== false && (round.status === 'DELIVERED' || round.deliveryDispute)).map(round => <DineInDeliveryNotice key={round.orderId} round={round} busy={disputeBusyId === round.orderId} onDispute={orderId => void disputeDelivery(orderId)} />)}
        {tabClosed && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Conta encerrada. Para pedir de novo, chame o garçom.</div>}
        {moveRequest && <section aria-label="Situação da mudança de mesa" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-slate-950">
          <p className="font-bold">{moveRequest.fromLabel} → {moveRequest.toLabel}</p>
          <p role="status" className="mt-1">{moveRequest.status === 'PENDING' ? 'Mudança de mesa aguardando autorização. Sua conta continua na mesa atual.' : moveRequest.status === 'APPROVED' ? 'Mudança de mesa autorizada. Sua conta, pedidos e valores acompanham a nova mesa.' : moveRequest.status === 'REJECTED' ? 'Solicitação de mudança de mesa recusada. Sua conta continua na mesa atual.' : 'Solicitação de mudança de mesa cancelada. Sua conta continua na mesa atual.'}</p>
        </section>}
        {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      </div>

      <section className={premiumTotemActive ? 'fixed inset-0 z-20 overflow-hidden' : view === 'MENU' ? 'dinein-menu-content' : view === 'HOME' ? 'dc-store-home-host' : 'mx-auto max-w-2xl px-4 py-5'}>
        {view === 'HOME' ? <StoreHomeScreen
          design={storeHomeDesign}
          storeName={displayStoreName || storeName}
          logoUrl={storeLogoUrl}
          tableName={mesaTitle(tab?.tableLabel || resolution?.tableLabel)}
          menuLabel={menuOptions.homeLabel}
          storeAppHref={resolution?.tenantSlug ? `/app/${encodeURIComponent(resolution.tenantSlug)}` : undefined}
          onStoreAppClick={openStoreApp}
          visibility={homeVisibility}
          available={homeAvailable}
          onAction={handleStoreHomeAction}
        /> : premiumTotemActive ? <DineInPremiumMenuAdapter
          key={`${token}:${storeTenantId}:${sessionId}`}
          tenantId={storeTenantId}
          storeName={storeName}
          storeLogoUrl={storeLogoUrl}
          storeTagline={storeHomeDesign.tagline || 'Bem-vindo ao nosso cardápio'}
          location="TABLE"
          tableLabel={mesaTitle(tab?.tableLabel || resolution?.tableLabel)}
          categories={categories}
          products={products}
          menuTheme={menuTheme}
          homeDesign={storeHomeDesign}
          productColumns={menuOptions.productColumns}
          outdoorSlides={outdoorSlides}
          cartCount={totalCartItems}
          orderingDisabled={orderingDisabled}
          busy={busy}
          verifiedSessionId={sessionId}
          tabSessionId={tab?.me?.sessionId ?? null}
          sessionAuthorized={Boolean(access && !needsIdentity && tab?.me?.approved === true && tab.me.sessionId === sessionId)}
          tab={tab}
          authorizedTableScope={false}
          onGoHome={() => setView('HOME')}
          onOpenCart={() => { upsell.dismiss(); setCartOpen(true); }}
          onOpenTable={() => { if (sessionId && tab?.me?.approved === true) { setAccountOpen(true); void loadAccount(true); } }}
          onAddProduct={addItem}
          onOpenProduct={product => { if (!orderingDisabled && !busy) { optionsFromUpsell.current = false; setOptionsProduct(product); setOptionChoices([]); } }}
          onRequestBill={requestPremiumBill}
          onCallWaiter={callWaiterFromPremium}
          onReopenBill={reopenBillFromPremium}
          onRefreshExpenses={refreshPremiumExpenses}
        /> : <DineInTotemMenu
          key={`${token}:${storeTenantId}`}
          storeSlug={resolution?.tenantSlug || ''}
          storeTenantId={storeTenantId}
          storeName={storeName}
          logoUrl={storeLogoUrl}
          categories={categories}
          products={products}
          menuTheme={menuTheme}
          productColumns={menuOptions.productColumns}
          cartCount={totalCartItems}
          orderingDisabled={orderingDisabled}
          busy={busy}
          onAddProduct={addItem}
          onOpenProduct={product => { if (!orderingDisabled && !busy) { optionsFromUpsell.current = false; setOptionsProduct(product); setOptionChoices([]); } }}
          onOpenCart={() => { upsell.dismiss(); setCartOpen(true); }}
          onBack={kioskActive ? undefined : () => setView('HOME')}
        />}
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
          <section role="dialog" aria-modal="true" aria-label={`${optionsProduct.optionGroups?.some(group => group.active) ? 'Personalizar' : 'Detalhes de'} ${optionsProduct.name}`} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-black">{optionsProduct.optionGroups?.some(group => group.active) ? `Personalizar ${optionsProduct.name}` : optionsProduct.name}</h2>{optionsProduct.optionGroups?.some(group => group.active) && <p className="text-sm text-slate-500">Escolha os adicionais para este item.</p>}</div>
              <button type="button" onClick={() => { setOptionsProduct(null); setOptionChoices([]); }} aria-label="Fechar personalização"><X className="h-5 w-5" /></button>
            </div>
            {optionsProduct.imageUrl && <img src={optionsProduct.imageUrl} alt={optionsProduct.name} className="mb-4 aspect-[4/3] w-full rounded-2xl object-cover" />}
            {optionsProduct.description && <p className="mb-4 text-sm text-slate-600">{optionsProduct.description}</p>}
            <ProductOptionsSelector
              groups={optionsProduct.optionGroups || []}
              selections={optionChoices}
              onChange={setOptionChoices}
            />
            <p className="mt-3 text-right text-base font-black">
              {formatBRL((Math.round(productToPricingLine(optionsProduct, 1).unitPrice * 100) + optionPriceCents(optionsProduct.optionGroups || [], optionChoices)) / 100)}
            </p>
            <button
              type="button"
              onClick={addConfiguredItem}
              disabled={orderingDisabled || busy || !validateOptionSelection(optionsProduct.optionGroups || [], optionChoices).valid}
              className="mt-4 w-full rounded-xl bg-emerald-700 p-3 font-bold text-white disabled:opacity-50"
            >
              Adicionar à rodada
            </button>
          </section>
        </div>}
      </section>

      {cartOpen && <DineInCartSheet cart={cart} busy={busy} disabled={orderingDisabled} onClose={() => setCartOpen(false)} onContinueShopping={() => { setCartOpen(false); setView('MENU'); }} onCheckout={handleRequestOrder} onQuantity={changeLineQuantity} onNotes={changeLineNotes} />}
      <DineInTracking compact={view === 'MENU'} rounds={tab?.rounds
        ?.filter(round => round.mine !== false || (tab.me?.approved && !!round.deliveryCode))
        .map(round => tab.me?.approved ? round : { ...round, deliveryCode: null }) || []} />

      {view === 'MENU' && !premiumTotemActive && <nav aria-label="Ações da mesa" className="dinein-menu-actions z-30 border-t bg-white px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 shadow-[0_-6px_20px_rgba(15,23,42,.08)]">
        <div className="mx-auto grid max-w-2xl grid-cols-3 gap-2">
          <button type="button" onClick={() => void requestWaiter()} disabled={busy || tabClosed || !sessionId} className="flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-bold text-slate-800 disabled:opacity-40"><UserRound className="h-5 w-5" />Chamar garçom</button>
          <button type="button" onClick={() => { setBillOpen(true); void loadAccount(true); }} disabled={busy || tabClosed || billRequested || !sessionId} className={`flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-bold disabled:cursor-default ${billRequested ? awaitingPix ? 'dinein-bill-awaiting-pix' : 'dinein-bill-requested' : 'text-slate-800 disabled:opacity-40'}`} style={billRequested ? billColors : undefined}><ReceiptText className="h-5 w-5" />{billRequested ? billStatusLabel : 'Pedir a conta'}</button>
          <button type="button" disabled={!sessionId} onClick={() => { setAccountOpen(true); void loadAccount(); }} className="flex flex-col items-center gap-1 rounded-xl py-2 text-xs font-bold text-slate-800 disabled:opacity-40"><CircleUserRound className="h-5 w-5" />Minha conta</button>
        </div>
      </nav>}

      {accountOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAccountOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-label="Minha conta" className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-black">Minha conta</h2><button type="button" onClick={() => setAccountOpen(false)} aria-label="Fechar"><X /></button></div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              {mesaTitle(tab?.tableLabel || resolution?.tableLabel)}
              {tab?.joinedTables?.length ? ` + ${tab.joinedTables.map(jt => jt.label).join(' + ')}` : ''} · {billRequested ? 'Aguardando fechamento da conta' : tab?.status === 'CLOSED' ? 'Encerrada' : 'Aberta'}
            </p>
            {sessionId && !tabClosed && (
              <button
                type="button"
                disabled={busy || billRequested || awaitingRelease || moveRequest?.status === 'PENDING'}
                onClick={() => { setAccountOpen(false); void openMoveTableModal(); }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 disabled:opacity-40"
              >
                Mudar de mesa
              </button>
            )}
          </div>
          {billRequested && <p className="mt-1 text-xs font-semibold text-amber-800">Mudança de mesa bloqueada com conta pedida ou aguardando PIX.</p>}
          {access && myRole === 'RESPONSIBLE' && !tabClosed && tab?.status !== 'CLOSED' && <div className="mt-4 space-y-3">
            <InvitePanel invite={invite} busy={inviteBusy} link={invite && resolution?.tenantSlug ? inviteUrl(window.location.origin, resolution.tenantSlug, token, invite.code) : ''} onCreate={() => void createInvite()} onRevoke={() => void revokeInvite()} />
            <MembersPanel members={tab?.members || []} mySessionId={sessionId} busy={membersBusy} onRemove={member => void removeMember(member)} onTransfer={member => void transferTo(member)} />
          </div>}
          <div className="my-4 space-y-3">{tab?.rounds?.length ? tab.rounds.map(round => <article key={round.orderId} data-testid={`account-round-${round.orderId}`} className="rounded-xl border p-3" style={statusColorStyle(round.status)}>
            <div className="mb-2 flex justify-between font-bold"><span>Rodada {round.roundNo}</span><span>{formatBRL(round.subtotal)}</span></div>
            <p className="mb-2 text-xs">{access ? `Pedido de ${round.mine ? 'você' : round.customerName}` : round.customerName} · {dineInStatus(round.status).label}</p>
            {tab.me?.approved && <DineInDeliveryCode round={round} testId={`account-round-code-${round.orderId}`} />}
            {round.deliveryConfirmedWithCode && <p className="mb-2 text-xs font-bold">Entrega confirmada com código</p>}
            {round.deliveryDispute && <p className="mb-2 text-xs font-semibold">{deliveryNoticeLabel(round)}</p>}
            {round.items.map((item, index) => {
              const deliveredAt = round.status === 'DELIVERED' ? item.deliveredAt || round.deliveredAt : null;
              return <p key={`${round.orderId}-${index}`} className="text-sm">{item.quantity}× {item.name}{deliveredAt && Number.isFinite(Date.parse(deliveredAt)) && <span className="ml-2 text-xs">Entregue às <time dateTime={deliveredAt}>{new Date(deliveredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></span>}</p>;
            })}
          </article>) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Ainda não há pedidos nesta conta.</p>}</div>
          {!!tab?.tableMoves?.length && (
            <div data-testid="account-table-moves" className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p className="mb-1.5 font-extrabold text-slate-900">Histórico de mesas</p>
              <ul className="space-y-1">
                {tab.tableMoves.map(m => (
                  <li key={m.id}>
                    <b>{m.fromLabel} → {m.toLabel}</b>
                    {m.actorName ? ` · ${m.actorName}` : ''}
                    {m.createdAt && Number.isFinite(Date.parse(m.createdAt)) ? ` (${new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-2 border-t pt-3 text-sm">
            <div className="flex justify-between"><span>Subtotal da conta</span><b>{formatBRL(tab?.subtotal || 0)}</b></div>
            {tab && tab.serviceFeePercent > 0 && !tab.serviceFeeRemoved && <div className="flex justify-between"><span>Taxa de serviço (opcional, {tab.serviceFeePercent}%)</span><b>{formatBRL(serviceFeeCents / 100)}</b></div>}
            <div className="flex justify-between text-base font-black"><span>Total</span><span>{formatBRL(accountTotalCents / 100)}</span></div>
          </div>
          {tabClosed && supabaseUser?.is_anonymous && !access && <>
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
          <p className="mt-2 text-center text-xs text-slate-500">Pedir a conta avisa a equipe. Sua mesa continua aberta até o pagamento ser confirmado.</p>
        </section>
      </div>}

      {moveTableOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !moveTableBusy) setMoveTableOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-label="Mudar de mesa" data-testid="dinein-move-table-modal" className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-black">Mudar de mesa</h2>
              <button type="button" disabled={moveTableBusy} onClick={() => setMoveTableOpen(false)} aria-label="Fechar mudança de mesa"><X /></button>
            </div>
            <p className="text-sm text-slate-600">
              Escolha uma mesa livre ou informe o QR Code da nova mesa. A mudança só acontece após autorização. Até lá, sua conta permanece na mesa atual.
            </p>
            {moveTableError && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">{moveTableError}</p>}
            <div className="mt-4">
              <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Mesas livres disponíveis</p>
              {moveTableBusy && !freeTables.length ? (
                <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Carregando mesas livres…</p>
              ) : freeTables.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {freeTables.map(ft => (
                    <button
                      key={ft.id}
                      type="button"
                      disabled={moveTableBusy}
                      data-testid={`move-to-table-${ft.id}`}
                      onClick={() => void submitMoveTable({ tableId: ft.id })}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left text-sm font-bold text-slate-900 hover:border-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      <span className="block">{mesaTitle(ft.label)}</span>
                      <span className="block text-xs font-normal text-slate-500">{ft.area ? `${ft.area} · ` : ''}{ft.seats} lugares</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Nenhuma mesa livre no momento. Se quiser juntar com outra mesa, chame o garçom.</p>
              )}
            </div>
            <div className="mt-4 border-t border-slate-200 pt-4">
              <label className="block text-xs font-extrabold uppercase tracking-wide text-slate-500" htmlFor="move-qr-token-input">
                Ou leia / cole o QR da nova mesa
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="move-qr-token-input"
                  type="text"
                  value={moveQrTokenInput}
                  onChange={e => setMoveQrTokenInput(e.target.value)}
                  placeholder="Link ou código QR da nova mesa"
                  className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={moveTableBusy || !moveQrTokenInput.trim()}
                  onClick={() => void submitMoveTable({ qrToken: moveQrTokenInput })}
                  className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      <UpsellSheet offer={upsell.offer} title={upsell.title} busy={upsell.busy} error={upsell.error} onAccept={upsell.accept} onClose={upsell.dismiss} />
    </main>
  );
};

export { APPROVAL_RETRY_MS, DEVICE_KEY, SESSION_KEY_PREFIX };
