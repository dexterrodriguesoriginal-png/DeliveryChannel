import { TableMoveRequestsPanel } from '../../components/establishment/salon/TableMoveRequestsPanel';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, Clock, PanelRightOpen, PauseCircle, PlayCircle, Plus, QrCode, Receipt, RefreshCw, Search, ShoppingBag, Users, Utensils, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useModules } from '../../hooks/useModules';
import { useSalonNightStats } from '../../hooks/useSalonNightStats';
import { supabase } from '../../lib/supabase';
import { newIdempotencyKey } from '../../lib/backend';
import { Category, Product, SelectedProductOption } from '../../types';
import { productOptionRepository } from '../../repositories/productOptionRepository';
import { formatBRL } from '../../lib/pricing/money';
import { formatTableLabel } from '../../lib/orders/labels';
import { playNewOrderSound, playShortBeep } from '../../utils/audio';
import { newRoundIds } from '../waiter/waiterLogic';
import { Modal } from '../../components/ui/Modal';
import { ProductOptionsSelector } from '../../components/client/customer/ProductOptionsSelector';
import { validateOptionSelection } from '../../lib/addons';
import { dineInRoundItem } from '../../lib/customer/dineInCart';
import {
  CallLike, compareTables, deriveTableStatus, ELAPSED_REFRESH_MS, matchesFilter, matchesSearch, readLongStay, statusCounts,
  STATUS_LABEL, TableFilter, tabTotals, writeLongStay, DEFAULT_LONG_STAY_MINUTES, ACTIVE_DINING_TAB_STATUSES, type DiningTabStatus,
} from '../../lib/salon/tableStatus';
import { mesasQrRepository, MesasQrCapabilities, NO_CAPABILITIES } from '../../repositories/mesasQrRepository';
import { TableCard } from '../../components/establishment/salon/TableCard';
import { SalonSidebar, SidebarTab } from '../../components/establishment/salon/SalonSidebar';
import { TabPixPanel } from '../../components/establishment/salon/TabPixPanel';
import { TabPaymentConfirmation } from '../../components/establishment/salon/TabPaymentConfirmation';
import { FOCUS_TABLE_KEY } from '../../components/establishment/salon/ApprovalsAlert';
import { salonStaffRepository, type SalonAccessExtras, type StaffHolderCode, type TabTableMoveRow, type JoinedTableLink } from '../../repositories/salonStaffRepository';
import { QRCodeSVG } from 'qrcode.react';
import { inviteUrl } from '../../lib/customer/tableAccess';
import { WaiterModesModal } from '../../components/establishment/waiter/WaiterModesModal';
import { CentralDispatchModal } from '../../components/establishment/waiter/CentralDispatchModal';
import { waiterV2Repository } from '../../repositories/waiterV2Repository';
import type { ServiceSettings } from '../../lib/waiter/waiterRouting';
import '../../components/establishment/salon/salon.css';

type DiningTable = { id: string; label: string; area: string | null; seats: number; active: boolean };
type DiningTab = {
  id: string;
  table_id: string;
  status: DiningTabStatus;
  opened_at: string;
  service_fee_percent: number;
  service_fee_removed: boolean;
};
type TabSession = { id: string; tab_id: string; display_name: string; approved_at: string | null; expires_at: string };
type WaiterCall = {
  id: string;
  tab_id: string;
  type: 'CALL' | 'BILL' | 'HELP';
  status: string;
  created_at: string;
  route?: string;
  assigned_to?: string | null;
  accepted_by?: string | null;
  escalated_at?: string | null;
};
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
type PaymentMethod = '' | 'CASH' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'PIX';
type PaymentLine = { method: PaymentMethod; amount: string; tendered: string };

const STAFF_ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER'];
const money = (value: number) => formatBRL(Number.isFinite(value) ? value : 0);
const missingSchema = (error: { code?: string; message?: string }) =>
  ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code || '') ||
  /could not find the (table|function)|does not exist/i.test(error.message || '');

const LONG_STAY_OPTIONS = [30, 45, 60, 90, 120, 180];
const FILTERS: Array<{ id: TableFilter; label: string }> = [
  { id: 'ALL', label: 'Todas' }, { id: 'FREE', label: 'Livres' }, { id: 'OCCUPIED', label: 'Ocupadas' },
  { id: 'LONG_STAY', label: 'Há muito tempo' }, { id: 'BILL', label: 'Conta pedida' }, { id: 'CALL', label: 'Chamando' },
];
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

export const SalonPage: React.FC<{ onNavigate?: (tab: string) => void }> = ({ onNavigate }) => {
  const { activeTenant, activeRole, securityContext, currentUser } = useAuth();
  const currentTenantId = useRef(activeTenant?.id);
  currentTenantId.current = activeTenant?.id;
  const { available, isModuleEnabled } = useModules();
  const enabled = available && isModuleEnabled('dine_in');
  const nightStats = useSalonNightStats(activeTenant?.id, enabled && STAFF_ROLES.includes(activeRole ?? ''));
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [tabs, setTabs] = useState<DiningTab[]>([]);
  const [sessions, setSessions] = useState<TabSession[]>([]);
  const [calls, setCalls] = useState<WaiterCall[]>([]);
  const [rounds, setRounds] = useState<DiningRound[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [optionChoices, setOptionChoices] = useState<SelectedProductOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
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
  const [checkout, setCheckout] = useState<{ tenantId: string; tabId: string; tableLabel: string; totalCents: number } | null>(null);
  const [manualSettled, setManualSettled] = useState<{ tabId: string; tableLabel: string; totalCents: number; method: string; paidAt: string } | null>(null);
  const [receivedConfirmed, setReceivedConfirmed] = useState(false);
  const [requestedCheckoutTable, setRequestedCheckoutTable] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: '', amount: '', tendered: '' }]);
  const seenCalls = useRef<Set<string>>(new Set());
  const seenRounds = useRef<Set<string> | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TableFilter>('ALL');
  const [now, setNow] = useState(() => Date.now());
  const [longStay, setLongStay] = useState(() => DEFAULT_LONG_STAY_MINUTES);
  const [sideOpen, setSideOpen] = useState(() => { try { const saved = localStorage.getItem('salon_sidebar_open'); return saved === null ? window.innerWidth >= 1280 : saved === 'true'; } catch { return true; } });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SidebarTab>('OPEN');
  const [closedToday, setClosedToday] = useState<Array<{ id: string; table_id: string; closed_at: string }>>([]);
  const [paidByTab, setPaidByTab] = useState<Map<string, number>>(new Map());
  const [reviews, setReviews] = useState<Set<string>>(new Set());
  const [caps, setCaps] = useState<MesasQrCapabilities>(NO_CAPABILITIES);
  const [storePaused, setStorePaused] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pixLive, setPixLive] = useState(false);
  const [access, setAccess] = useState<SalonAccessExtras | null>(null);
  const [confirmReject, setConfirmReject] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [holderCode, setHolderCode] = useState<StaffHolderCode | null>(null);
  const [releaseEmptyOpen, setReleaseEmptyOpen] = useState(false);
  const [releaseEmptyReason, setReleaseEmptyReason] = useState('Cliente desistiu');
  const [releaseEmptyCustomReason, setReleaseEmptyCustomReason] = useState('');
  const [modesOpen, setModesOpen] = useState(false);
  const [dispatchCall, setDispatchCall] = useState<{ id: string; tableLabel: string; type: string; createdAt: string; route: string } | null>(null);
  const [joinedTables, setJoinedTables] = useState<JoinedTableLink[]>([]);
  const [tableMoves, setTableMoves] = useState<TabTableMoveRow[]>([]);
  const [requireDeliveryCode, setRequireDeliveryCode] = useState(false);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [selectedJoinTables, setSelectedJoinTables] = useState<string[]>([]);
  const [joinConsent, setJoinConsent] = useState(false);

  const centralCallsWaiting = useMemo(() => {
    return calls.filter(call => call.status === 'OPEN' && call.route === 'CENTRAL' && !call.assigned_to && !call.accepted_by);
  }, [calls]);

  const tabByTable = useMemo(() => {
    const map = new Map<string, DiningTab>();
    const byId = new Map<string, DiningTab>();
    for (const tab of tabs) {
      map.set(tab.table_id, tab);
      byId.set(tab.id, tab);
    }
    for (const link of joinedTables) {
      const tab = byId.get(link.tab_id);
      if (tab && !map.has(link.table_id)) {
        map.set(link.table_id, tab);
      }
    }
    return map;
  }, [tabs, joinedTables]);

  const joinPrimaryTabId = tabByTable.get(selectedJoinTables[0])?.id;
  const joinNeedsConsent = selectedJoinTables.slice(1).some(id => {
    const account = tabByTable.get(id);
    return !!account && account.id !== joinPrimaryTabId;
  });

  const resolvedTableId = useMemo(() => {
    if (!selectedTableId) return null;
    if (tables.some(table => table.id === selectedTableId)) return selectedTableId;
    const byTab = tabs.find(tab => tab.id === selectedTableId);
    if (byTab) return byTab.table_id;
    const targetLabel = formatTableLabel(selectedTableId, '').toLowerCase();
    const byLabel = tables.find(
      table => table.label === selectedTableId || (targetLabel && formatTableLabel(table.label, '').toLowerCase() === targetLabel),
    );
    return byLabel ? byLabel.id : selectedTableId;
  }, [selectedTableId, tables, tabs]);
  const selectedTab = useMemo(() => (resolvedTableId ? tabByTable.get(resolvedTableId) : undefined), [tabByTable, resolvedTableId]);
  const selectedTable = useMemo(() => tables.find(table => table.id === resolvedTableId), [tables, resolvedTableId]);
  const selectedProduct = useMemo(() => catalogProducts.find(product => product.id === productId), [catalogProducts, productId]);
  const derivedCategories = useMemo<Array<{ id: string; name: string }>>(() => {
    if (categories.length > 0) return categories.map(cat => ({ id: cat.id, name: cat.name }));
    const seen = new Map<string, string>();
    for (const product of catalogProducts) {
      if (product.categoryId && !seen.has(product.categoryId)) seen.set(product.categoryId, product.categoryId);
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [categories, catalogProducts]);
  const filteredCatalogProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return catalogProducts.filter(product => {
      if (selectedCategoryId !== 'ALL' && product.categoryId !== selectedCategoryId) return false;
      if (!q) return true;
      return product.name.toLowerCase().includes(q) || (product.description || '').toLowerCase().includes(q);
    });
  }, [catalogProducts, productSearch, selectedCategoryId]);
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
      const [tableResult, tabResult, configResult, menuResult] = await Promise.all([
        supabase.from('dining_tables').select('id,label,area,seats,active').eq('tenant_id', activeTenant.id).eq('active', true).order('label'),
        supabase.from('dining_tabs').select('id,table_id,status,opened_at,service_fee_percent,service_fee_removed').eq('tenant_id', activeTenant.id).in('status', ACTIVE_DINING_TAB_STATUSES).order('opened_at'),
        supabase.from('tenant_modules').select('config').eq('tenant_id', activeTenant.id).eq('module_key', 'dine_in').maybeSingle(),
        salonStaffRepository.loadMenu(activeTenant.id, activeTenant.slug || null, securityContext),
      ]);
      if (currentTenantId.current !== activeTenant.id) return;
      if (tableResult.error) throw tableResult.error;
      if (tabResult.error) throw tabResult.error;
      if (configResult.error && !missingSchema(configResult.error)) throw configResult.error;
      const loadedTables = (tableResult.data || []) as DiningTable[];
      const loadedTabs = (tabResult.data || []) as DiningTab[];
      setTables(loadedTables);
      setTabs(loadedTabs);
      setProducts(menuResult.products);
      setCategories(menuResult.categories);
      const config = configResult.data?.config as { close_roles?: string[]; require_delivery_code?: boolean } | null;
      setCloseRoles(Array.isArray(config?.close_roles) ? config.close_roles : ['OWNER', 'MANAGER', 'CASHIER']);
      setRequireDeliveryCode(Boolean(config?.require_delivery_code));
      if (!loadedTabs.length) {
        setSessions([]);
        setCalls([]);
        setRounds([]);
        setJoinedTables([]);
        setTableMoves([]);
        if (seenRounds.current === null) seenRounds.current = new Set();
      } else {
        const tabIds = loadedTabs.map(tab => tab.id);
        const [sessionResult, callResult, roundResult, joinedResult, movesResult] = await Promise.all([
          supabase.from('tab_sessions').select('id,tab_id,display_name,approved_at,expires_at').eq('tenant_id', activeTenant.id).in('tab_id', tabIds).gt('expires_at', new Date().toISOString()),
          supabase.from('waiter_calls').select('id,tab_id,type,status,created_at').eq('tenant_id', activeTenant.id).in('tab_id', tabIds).eq('status', 'OPEN').order('created_at'),
          supabase.from('orders').select('id,tab_id,order_number,customer_name,status,subtotal,created_at,round_no').eq('tenant_id', activeTenant.id).eq('fulfillment_type', 'DINE_IN').in('tab_id', tabIds).neq('status', 'CANCELLED').order('round_no'),
          salonStaffRepository.loadJoinedTables(activeTenant.id, tabIds).catch(() => [] as JoinedTableLink[]),
          salonStaffRepository.loadTableMoves(activeTenant.id, tabIds).catch(() => [] as TabTableMoveRow[]),
        ]);
        if (currentTenantId.current !== activeTenant.id) return;
        if (sessionResult.error) throw sessionResult.error;
        if (callResult.error) throw callResult.error;
        if (roundResult.error) throw roundResult.error;
        setSessions((sessionResult.data || []) as TabSession[]);
        setJoinedTables(joinedResult);
        setTableMoves(movesResult);
        const nextCalls = (callResult.data || []) as WaiterCall[];
        const newCalls = nextCalls.filter(call => !seenCalls.current.has(call.id));
        if (seenCalls.current.size && newCalls.length) playShortBeep();
        seenCalls.current = new Set(nextCalls.map(call => call.id));
        setCalls(nextCalls);
        const directRounds = (roundResult.data || []) as DiningRound[];
        const nextRounds = (directRounds.length > 0
          ? directRounds
          : await salonStaffRepository.fetchRoundsForTabs(activeTenant.id, tabIds)) as DiningRound[];
        if (currentTenantId.current !== activeTenant.id) return;
        const freshRoundIds = newRoundIds(seenRounds.current, nextRounds);
        seenRounds.current = new Set(nextRounds.map(round => round.id));
        if (freshRoundIds.length > 0) (playNewOrderSound ?? playShortBeep)?.();
        setRounds(nextRounds);
      }
      setMessage(null);
    } catch (error) {
      if (currentTenantId.current !== activeTenant.id) return;
      const err = error as { code?: string; message?: string };
      if (missingSchema(err)) setMessage('O Salão ainda não está disponível neste banco. Atualize as migrações para habilitar a operação.');
      else {
        console.error('[SalonPage] Erro ao carregar o salão:', error);
        setMessage(err.message || 'Não foi possível carregar o salão.');
      }
    } finally {
      if (currentTenantId.current === activeTenant.id) setLoading(false);
    }
  }, [activeTenant?.id, activeTenant?.slug, activeRole, enabled, securityContext]);

  useEffect(() => {
    void load();
    if (!activeTenant?.id || !enabled) return;
    const tenantId = activeTenant.id;
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void load(true); }, 10000);
    const onFocusOrVisible = () => { if (document.visibilityState !== 'hidden') void load(true); };
    window.addEventListener('focus', onFocusOrVisible);
    window.addEventListener('online', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (typeof supabase.channel === 'function') {
      try {
        channel = supabase
          .channel(`salon_live_${tenantId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, () => { void load(true); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tab_sessions', filter: `tenant_id=eq.${tenantId}` }, () => { void load(true); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tabs', filter: `tenant_id=eq.${tenantId}` }, () => { void load(true); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls', filter: `tenant_id=eq.${tenantId}` }, () => { void load(true); })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tab_events', filter: `tenant_id=eq.${tenantId}` }, () => { void load(true); })
          .subscribe();
      } catch {
        channel = null;
      }
    }

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocusOrVisible);
      window.removeEventListener('online', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      if (channel && typeof supabase.removeChannel === 'function') {
        void supabase.removeChannel(channel);
      }
    };
  }, [activeTenant?.id, enabled, load]);

  useEffect(() => {
    if (!activeTenant?.id) return;
    setLongStay(readLongStay(typeof window === 'undefined' ? undefined : window.localStorage, activeTenant.id));
    setTables([]); setTabs([]); setSessions([]); setCalls([]); setRounds([]);
    setSelectedTableId(null); setPaidByTab(new Map()); setReviews(new Set()); setClosedToday([]);
    setOrderOpen(false); setProducts([]); setCategories([]); setCatalogProducts([]); setProductId('');
    setCaps(NO_CAPABILITIES); setHolderCode(null); setDispatchCall(null); setAccess(null);
    setConfirmReject(null); setTransferOpen(false); setModesOpen(false); setMessage(null);
  }, [activeTenant?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ELAPSED_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Which new features the connected database supports (pre-migration => everything new stays hidden).
  useEffect(() => {
    if (!activeTenant?.id || !enabled) return;
    let alive = true;
    void mesasQrRepository.capabilities().then(next => { if (alive) setCaps(next); });
    return () => { alive = false; };
  }, [activeTenant?.id, enabled]);

  // Read-only extras for the redesigned map. Any failure leaves the map working with what it already has.
  useEffect(() => {
    if (!activeTenant?.id || !enabled || !STAFF_ROLES.includes(activeRole || '')) return;
    let alive = true;
    const tenantId = activeTenant.id;
    void (async () => {
      const closedResult = await supabase.from('dining_tabs').select('id,table_id,closed_at').eq('tenant_id', tenantId).eq('status', 'CLOSED')
        .gte('closed_at', startOfToday()).order('closed_at', { ascending: false }).limit(100);
      const closed = closedResult.error ? [] : (closedResult.data || []) as Array<{ id: string; table_id: string; closed_at: string }>;
      const ids = [...tabs.map(tab => tab.id), ...closed.map(tab => tab.id)];
      const [paymentResult, reviewSet, pauses] = await Promise.all([
        ids.length ? supabase.from('tab_payments').select('tab_id,amount_cents').eq('tenant_id', tenantId).in('tab_id', ids) : Promise.resolve({ data: [], error: null }),
        caps.tabPix ? mesasQrRepository.pixReviews(tenantId, ids) : Promise.resolve(new Set<string>()),
        caps.qrPause ? mesasQrRepository.pauses(tenantId).catch(() => ({ storeWide: false, tableIds: [] as string[] })) : Promise.resolve({ storeWide: false, tableIds: [] as string[] }),
      ]);
      if (!alive) return;
      const paid = new Map<string, number>();
      if (!paymentResult.error) for (const row of (paymentResult.data || []) as Array<{ tab_id: string; amount_cents: number }>) paid.set(row.tab_id, (paid.get(row.tab_id) || 0) + Number(row.amount_cents || 0));
      setClosedToday(closed);
      setPaidByTab(paid);
      setReviews(reviewSet);
      setStorePaused(pauses.storeWide);
    })().catch(() => { /* extras are optional */ });
    return () => { alive = false; };
  }, [activeTenant?.id, activeRole, enabled, tabs, caps.tabPix, caps.qrPause]);

  useEffect(() => {
    let alive = true;
    setCatalogProducts(products);
    setOptionsError(null);
    if (!orderOpen || !products.length) {
      setOptionsLoading(false);
      return () => { alive = false; };
    }
    setOptionsLoading(true);
    void productOptionRepository.getPublicForProducts(activeTenant?.id || '', products.map(product => product.id))
      .then(groups => {
        if (alive) setCatalogProducts(products.map(product => ({ ...product, optionGroups: groups.get(product.id) || product.optionGroups || [] })));
      })
      .catch(error => {
        if (alive) setOptionsError(error instanceof Error ? error.message : 'Não foi possível carregar os adicionais.');
      })
      .finally(() => {
        if (alive) setOptionsLoading(false);
      });
    return () => { alive = false; };
  }, [activeTenant?.id, orderOpen, products]);

  useEffect(() => {
    setOptionChoices([]);
  }, [productId]);

  useEffect(() => {
    setHolderCode(null);
    setReleaseEmptyOpen(false);
    setCloseOpen(false);
    setPixLive(false);
    setCheckout(null);
    setManualSettled(null);
    setReceivedConfirmed(false);
  }, [selectedTableId]);

  useEffect(() => {
    if (closeOpen && !checkout && !manualSettled && !loading && !selectedTab) {
      setCloseOpen(false); setPixLive(false); setSelectedTableId(null);
    }
  }, [closeOpen, checkout, manualSettled, loading, selectedTab]);

  useEffect(() => {
    setCheckout(null); setManualSettled(null); setCloseOpen(false); setReceivedConfirmed(false);
  }, [activeTenant?.id]);

  useEffect(() => {
    const readTarget = () => {
      const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
      const tableId = query.get('table');
      if (tableId) { setSelectedTableId(tableId); setRequestedCheckoutTable(query.get('checkout') === '1' ? tableId : null); }
    };
    const onCheckout = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) { setSelectedTableId(id); setRequestedCheckoutTable(id); }
    };
    readTarget(); window.addEventListener('hashchange', readTarget);
    window.addEventListener('dc:checkout-table', onCheckout);
    return () => {
      window.removeEventListener('hashchange', readTarget);
      window.removeEventListener('dc:checkout-table', onCheckout);
    };
  }, []);

  // Responsável pela mesa (só com o modelo de acesso novo; antes dele nada disso existe no banco).
  useEffect(() => {
    if (!activeTenant?.id || !enabled || !caps.tableAccess || !tabs.length) { setAccess(null); return; }
    let alive = true;
    void salonStaffRepository.accessExtras(activeTenant.id, tabs.map(tab => tab.id)).then(next => { if (alive) setAccess(next); }).catch(() => { if (alive) setAccess(null); });
    return () => { alive = false; };
  }, [activeTenant?.id, enabled, caps.tableAccess, tabs, sessions]);

  // Vindo do alerta "aguardando liberação": abre a mesa certa.
  useEffect(() => {
    const focus = (tableId: string) => { setSelectedTableId(tableId); setDrawerOpen(false); setConfirmReject(null); setTransferOpen(false); };
    try { const saved = sessionStorage.getItem(FOCUS_TABLE_KEY); if (saved) { sessionStorage.removeItem(FOCUS_TABLE_KEY); focus(saved); } } catch { /* ignore */ }
    const onFocus = (event: Event) => { const id = (event as CustomEvent<string>).detail; if (id) { try { sessionStorage.removeItem(FOCUS_TABLE_KEY); } catch { /* ignore */ } focus(id); } };
    window.addEventListener('dc:focus-table', onFocus);
    return () => window.removeEventListener('dc:focus-table', onFocus);
  }, []);

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

  const reject = (sessionId: string) => run(`reject-${sessionId}`, async () => {
    await salonStaffRepository.reject(sessionId);
    setConfirmReject(null);
  });
  const changeHolder = () => {
    if (!selectedTab) return;
    void run('change-holder', async () => {
      const created = await salonStaffRepository.createHolderCode(selectedTab.id);
      setHolderCode(created);
    });
  };
  const releaseEmptyTab = () => {
    if (!selectedTab) return;
    const reason = releaseEmptyReason === 'Outro'
      ? (releaseEmptyCustomReason.trim() || 'Outro')
      : releaseEmptyReason;
    void run('release-empty', async () => {
      await salonStaffRepository.releaseEmptyTab(selectedTab.id, reason);
      setReleaseEmptyOpen(false);
      setSelectedTableId(null);
    });
  };
  const transferHolder = (sessionId: string) => {
    if (!selectedTab) return;
    void run('transfer-holder', async () => { await salonStaffRepository.transferHolder(selectedTab.id, sessionId, true); setTransferOpen(false); });
  };

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
      const items = [dineInRoundItem({ productId, quantity, notes: notes.trim(), options: optionChoices })];
      const idempotencyKey = newIdempotencyKey();
      if (selectedTable && selectedTable.id !== selectedTab.table_id) {
        await salonStaffRepository.submitTableRound(selectedTable.id, items, idempotencyKey);
      } else {
        const { error } = await supabase.rpc('submit_round', {
          p_items: items, p_idempotency_key: idempotencyKey, p_tab_id: selectedTab.id,
        });
        if (error) throw error;
      }
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
  const canManageBill = ['OWNER', 'MANAGER', 'CASHIER'].includes(activeRole || '');
  const canClose = activeRole === 'OWNER'
    || (canManageBill && closeRoles.includes(activeRole || ''))
    || (activeRole === 'WAITER' && selectedTab ? ['WAITER_AUTHORIZED', 'AWAITING_PAYMENT'].includes(selectedTab.status) : false);
  const pixSelected = payments.some(payment => payment.method === 'PIX');
  const openCheckout = () => {
    if (!selectedTab || !selectedTable || !activeTenant?.id) return;
    if (totalCents <= 0) { setMessage('Não há valor pendente para cobrar nesta comanda.'); return; }
    setCheckout({ tenantId: activeTenant.id, tabId: selectedTab.id, tableLabel: selectedTable.label, totalCents });
    setManualSettled(null);
    setReceivedConfirmed(false);
    setPayments([{ method: selectedTab?.status === 'AWAITING_PAYMENT' ? 'PIX' : '', amount: (totalCents / 100).toFixed(2), tendered: '' }]);
    setPixLive(false);
    setCloseOpen(true);
  };
  useEffect(() => {
    if (requestedCheckoutTable && !loading && selectedTable?.id === requestedCheckoutTable && selectedTab && canClose) {
      setRequestedCheckoutTable(null); openCheckout();
    }
  }, [requestedCheckoutTable, loading, selectedTable?.id, selectedTab?.id, canClose]);
  const authorizeWaiter = () => {
    if (!selectedTab || selectedTab.status !== 'BILL_REQUESTED') return;
    void run('authorize-close', () => salonStaffRepository.authorizeWaiterToClose(selectedTab.id));
  };
  const closeTab = () => {
    if (!selectedTab) return;
    if (!receivedConfirmed) { setMessage('Confirme o recebimento antes de fechar a conta.'); return; }
    if (pixSelected || pixLive || payments.some(payment => !payment.method)) {
      setMessage(pixSelected ? 'Gere o Pix e aguarde a confirmação do pagamento para liberar a mesa.' : 'Escolha a forma de pagamento e confirme o recebimento.');
      return;
    }
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
    const closedTabId = selectedTab.id;
    const closedTableLabel = selectedTable?.label || 'Mesa';
    const closedTotal = totalCents;
    const closedMethod = lines[0]?.method || 'CASH';
    void run('close-tab', async () => {
      const { error } = await supabase.rpc('close_tab', { p_tab_id: closedTabId, p_payments: lines });
      if (error) throw error;
      if (caps.tabPix) {
        setManualSettled({ tabId: closedTabId, tableLabel: closedTableLabel, totalCents: closedTotal, method: closedMethod, paidAt: new Date().toISOString() });
      } else {
        setCloseOpen(false);
        setSelectedTableId(null);
      }
    });
  };

  const tableLabelById = useMemo(() => new Map(tables.map(table => [table.id, formatTableLabel(table.label, 'Mesa')])), [tables]);
  const joinedLabelByTable = useMemo(() => {
    const tablesByTab = new Map<string, string[]>();
    for (const tab of tabs) {
      tablesByTab.set(tab.id, [tab.table_id]);
    }
    for (const link of joinedTables) {
      const list = tablesByTab.get(link.tab_id) || [];
      if (!list.includes(link.table_id)) list.push(link.table_id);
      tablesByTab.set(link.tab_id, list);
    }
    const labelMap = new Map<string, string>();
    for (const [, tableIds] of tablesByTab.entries()) {
      if (tableIds.length > 1) {
        const joinedLabel = tableIds.map(id => tableLabelById.get(id) || 'Mesa').join(' + ');
        for (const id of tableIds) {
          labelMap.set(id, joinedLabel);
        }
      }
    }
    return labelMap;
  }, [tabs, joinedTables, tableLabelById]);
  const infoByTable = useMemo(() => {
    const map = new Map<string, ReturnType<typeof deriveTableStatus>>();
    for (const table of tables) {
      const tab = tabByTable.get(table.id);
      map.set(table.id, deriveTableStatus({
        tab, calls: calls as CallLike[], sessions, rounds, paidCents: tab ? paidByTab.get(tab.id) : 0,
        needsReview: tab ? reviews.has(tab.id) : false, now, longStayMinutes: longStay,
      }));
    }
    return map;
  }, [tables, tabByTable, calls, sessions, rounds, paidByTab, reviews, now, longStay]);
  const recentMoves = useMemo(
    () => tableMoves.filter(m => m.action === 'MOVE').slice(0, 3),
    [tableMoves],
  );
  const joinedTablesForSelectedTab = useMemo(() => {
    if (!selectedTab) return [] as Array<{ id: string; label: string }>;
    const ids = [selectedTab.table_id];
    for (const link of joinedTables) {
      if (link.tab_id === selectedTab.id && !ids.includes(link.table_id)) {
        ids.push(link.table_id);
      }
    }
    return ids.map(id => ({ id, label: tableLabelById.get(id) || 'Mesa' }));
  }, [selectedTab, joinedTables, tableLabelById]);
  const movesForSelectedTab = useMemo(
    () => (selectedTab ? tableMoves.filter(m => m.tab_id === selectedTab.id) : []),
    [selectedTab, tableMoves],
  );
  const counts = useMemo(() => statusCounts(Array.from(infoByTable.values())), [infoByTable]);
  const visibleTables = useMemo(
    () => tables.filter(table => matchesSearch(table, search) && matchesFilter(infoByTable.get(table.id)!, filter)).sort(compareTables),
    [tables, search, filter, infoByTable],
  );
  const sideOpenTabs = useMemo(() => tabs.map(tab => {
    const info = infoByTable.get(tab.table_id);
    return info ? { tabId: tab.id, tableId: tab.table_id, tableLabel: tableLabelById.get(tab.table_id) || 'Mesa', kind: info.kind,
      elapsedMinutes: info.elapsedMinutes || 0, totalCents: info.totalCents, paidPercent: info.paidPercent, needsReview: info.needsReview } : null;
  }).filter((item): item is NonNullable<typeof item> => !!item).sort((a, b) => b.elapsedMinutes - a.elapsedMinutes), [tabs, infoByTable, tableLabelById]);
  const sideClosed = useMemo(() => closedToday.map(tab => ({
    tabId: tab.id, tableLabel: tableLabelById.get(tab.table_id) || 'Mesa', totalCents: paidByTab.get(tab.id) || 0, closedAt: tab.closed_at, needsReview: reviews.has(tab.id),
  })), [closedToday, tableLabelById, paidByTab, reviews]);
  const tableIdByTab = useMemo(() => new Map(tabs.map(tab => [tab.id, tab.table_id])), [tabs]);
  const sideOrders = useMemo(() => rounds.filter(round => ['CONFIRMED', 'PREPARING', 'READY'].includes(round.status)).map(round => {
    const tableId = tableIdByTab.get(round.tab_id) || '';
    return { id: round.id, tableId, tableLabel: tableLabelById.get(tableId) || 'Mesa', orderNumber: round.order_number, roundNo: round.round_no, status: round.status, subtotalCents: Math.round(Number(round.subtotal || 0) * 100), createdAt: round.created_at };
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [rounds, tableIdByTab, tableLabelById]);
  const sideCalls = useMemo(() => calls.filter(call => call.status === 'OPEN').map(call => {
    const tableId = tableIdByTab.get(call.tab_id) || '';
    return { id: call.id, tableId, tableLabel: tableLabelById.get(tableId) || 'Mesa', type: call.type, createdAt: call.created_at };
  }), [calls, tableIdByTab, tableLabelById]);
  const openTable = useCallback((id: string) => { setSelectedTableId(id); setDrawerOpen(false); }, []);
  const toggleSide = (next: boolean) => { setSideOpen(next); try { localStorage.setItem('salon_sidebar_open', String(next)); } catch { /* ignore */ } };
  const canPause = activeRole === 'OWNER' || activeRole === 'MANAGER';
  const toggleStorePause = async () => {
    if (!activeTenant) return;
    setPauseBusy(true);
    try { await mesasQrRepository.setPause(activeTenant.id, null, !storePaused); setStorePaused(!storePaused); setMessage(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível alterar o QR.'); }
    finally { setPauseBusy(false); }
  };
  const toggleDeliveryCode = () => {
    if (!activeTenant || activeRole !== 'OWNER') return;
    const next = !requireDeliveryCode;
    void run('toggle-delivery-code', async () => {
      await salonStaffRepository.setDeliveryCodeRequired(activeTenant.id, next);
      setRequireDeliveryCode(next);
    });
  };
  const confirmJoinTables = () => {
    if (selectedJoinTables.length < 2 || (joinNeedsConsent && !joinConsent)) {
      setMessage('Selecione pelo menos 2 mesas para juntar.');
      return;
    }
    void run('join-tables', async () => {
      await salonStaffRepository.joinTables(selectedJoinTables, joinConsent);
      setJoinModalOpen(false);
      setSelectedJoinTables([]);
      setJoinConsent(false);
    });
  };
  const separateJoinedTable = (tableId: string) => {
    if (!selectedTab) return;
    void run(`separate-${tableId}`, async () => {
      await salonStaffRepository.separateTable(selectedTab.id, tableId);
    });
  };
  const onPixSettled = useCallback(() => { setCloseOpen(false); setSelectedTableId(null); setPixLive(false); void load(true); }, [load]);
  const onPixLive = useCallback((live: boolean) => setPixLive(live), []);

  if (!enabled) return <div className="rounded-2xl bg-white p-6 text-sm text-gray-600">A ferramenta Mesa/Comanda está desativada. Ative em Ferramentas.</div>;
  if (!activeTenant) return null;

  return (
    <div className="salon-root space-y-4" data-testid="salon-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-black text-gray-950">Salão</h1><p className="text-sm text-gray-600">Mapa de mesas e comandas em andamento</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setSelectedJoinTables([]); setJoinConsent(false); setJoinModalOpen(true); }}
            className="salon-btn"
            data-testid="salon-join-tables-btn"
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            Juntar mesas
          </button>
          {activeRole === 'OWNER' && (
            <button
              type="button"
              onClick={toggleDeliveryCode}
              disabled={busy === 'toggle-delivery-code'}
              aria-pressed={requireDeliveryCode}
              className={`salon-btn${requireDeliveryCode ? ' salon-btn--warn' : ''}`}
              data-testid="salon-toggle-delivery-code"
            >
              {requireDeliveryCode ? 'Código de entrega: Ligado' : 'Exigir código de entrega na mesa'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setModesOpen(true)}
            className="salon-btn"
            data-testid="salon-waiter-modes-btn"
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            Modo de atendimento
          </button>
          {onNavigate && <button type="button" onClick={() => onNavigate('est-mesas-qr')} className="salon-btn"><QrCode className="h-4 w-4" aria-hidden="true" />Mesas e QR Code</button>}
          {caps.qrPause && canPause && <button type="button" onClick={() => void toggleStorePause()} disabled={pauseBusy} aria-pressed={storePaused} className={`salon-btn${storePaused ? ' salon-btn--warn' : ''}`}>
            {storePaused ? <PlayCircle className="h-4 w-4" aria-hidden="true" /> : <PauseCircle className="h-4 w-4" aria-hidden="true" />}{storePaused ? 'Retomar pedidos por QR' : 'Pausar pedidos por QR'}</button>}
          <button type="button" onClick={() => void load()} className="salon-btn"><RefreshCw className="h-4 w-4" aria-hidden="true" />Atualizar</button>
        </div>
      </header>
      {message && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{message}</div>}
      <TableMoveRequestsPanel tenantId={activeTenant.id} viewerId={currentUser?.id} role={activeRole} onResolved={() => void load(true)} />
      {recentMoves.length > 0 && (
        <div role="status" data-testid="salon-table-move-banner" className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm font-bold text-sky-950">
          <span>Troca de mesa recente:</span>
          {recentMoves.map(m => (
            <span key={m.id} className="rounded-lg bg-white px-2.5 py-1 text-xs font-black text-slate-900 shadow-xs">
              {m.from_label || 'Mesa'} → {m.to_label}
            </span>
          ))}
        </div>
      )}
      {storePaused && <div role="status" className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950"><PauseCircle className="h-5 w-5" aria-hidden="true" />Pedidos pelo QR das mesas estão pausados. Os clientes veem um aviso e o garçom ainda pode lançar pedidos.</div>}
      {centralCallsWaiting.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-amber-500/15 border border-amber-400 p-3 text-amber-950 shadow-sm"
          data-testid="central-dispatch-alert"
        >
          <div className="flex items-center gap-2.5">
            <Bell className="h-5 w-5 text-amber-600 animate-bounce" />
            <div>
              <p className="font-extrabold text-sm">
                {centralCallsWaiting.length === 1
                  ? '1 chamado aguardando despacho para garçom'
                  : `${centralCallsWaiting.length} chamados aguardando despacho`}
              </p>
              <p className="text-xs text-amber-800">
                Modo Central: toque em "Despachar" para escolher qual garçom atenderá a mesa.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const c = centralCallsWaiting[0];
              const tableId = tableIdByTab.get(c.tab_id) || '';
              setDispatchCall({
                id: c.id,
                tableLabel: tableLabelById.get(tableId) || 'Mesa',
                type: c.type,
                createdAt: c.created_at,
                route: c.route || 'CENTRAL',
              });
            }}
            className="rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 shadow-sm cursor-pointer"
          >
            Despachar garçom
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-white shadow-sm" role="status" data-testid="salon-alerts">
        <Bell className="h-5 w-5" aria-hidden="true" />
        <span className="font-bold">{calls.filter(call => call.type !== 'BILL').length} chamados · {tabs.filter(tab => ['BILL_REQUESTED', 'WAITER_AUTHORIZED', 'AWAITING_PAYMENT'].includes(tab.status)).length} contas</span>
      </div>
      <div className="salon-toolbar">
        <label className="salon-search"><Search className="h-4 w-4 text-slate-500" aria-hidden="true" /><span className="sr-only">Buscar mesa</span>
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar mesa (ex.: 12, varanda)" aria-label="Buscar mesa" autoComplete="off" /></label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por status">
          {FILTERS.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} className="salon-filter" onClick={() => setFilter(item.id)} data-testid={`salon-filter-${item.id}`}>
            {item.label}<b>{counts[item.id]}</b></button>)}
        </div>
      </div>
      <ul className="salon-legend" aria-label="Legenda das cores">
        <li><i style={{ background: '#2DBE4E' }} />Livre</li>
        <li><i style={{ background: '#FFDD00' }} />Ocupada / Em preparo</li>
        <li><i style={{ background: '#1AB0F5' }} />Pedido novo / Pronto no balcão</li>
        <li><i style={{ background: '#FF5050' }} />Ocupada há mais de {longStay} min</li>
        <li><i style={{ background: '#8B5A2B' }} />Conta solicitada (piscando)</li>
        <li><i style={{ background: '#8B5A2B', border: '2px solid #FF5050' }} />Aguardando PIX (alerta)</li>
        <li><i style={{ background: '#8B5A2B' }} />Conta pedida · selo roxo: garçom autorizado</li>
        <li><i style={{ background: '#dc2626' }} />Sino = chamado ou liberação pendente</li>
        <li className="ml-auto">
<label className="salon-longstay"><span>Mesa longa após</span>
          <select aria-label="Tempo para marcar mesa como ocupada há muito tempo" value={longStay} onChange={event => setLongStay(writeLongStay(window.localStorage, activeTenant.id, Number(event.target.value)))}>
            {(LONG_STAY_OPTIONS.includes(longStay) ? LONG_STAY_OPTIONS : [...LONG_STAY_OPTIONS, longStay].sort((a, b) => a - b)).map(value => <option key={value} value={value}>{value} min</option>)}
          </select></label>
        </li>
      </ul>
      <div className="salon-layout">
        <div className="min-w-0 flex-1">
          {loading ? (
            <div><p className="sr-only">Carregando o salão…</p><p className="mb-3 text-sm text-gray-500" aria-hidden="true">Carregando o salão…</p>
              <div className="salon-grid" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className="salon-skeleton" />)}</div></div>
          ) : tables.length === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal-50 text-teal-700"><Utensils className="h-7 w-7" aria-hidden="true" /></span>
              <p className="mt-3 text-sm text-gray-600">Nenhuma mesa ativa. Cadastre mesas em Mesas e QR Code.</p>
              {onNavigate && <button type="button" onClick={() => onNavigate('est-mesas-qr')} className="salon-btn mt-3"><QrCode className="h-4 w-4" aria-hidden="true" />Abrir Mesas e QR Code</button>}</div>
          ) : visibleTables.length === 0 ? (
            <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-600 shadow-sm">Nenhuma mesa encontrada com esse filtro. <button type="button" className="font-bold text-teal-800 underline" onClick={() => { setSearch(''); setFilter('ALL'); }}>Limpar filtros</button></p>
          ) : (
            <div className="salon-grid">
              {visibleTables.map((table, index) => <TableCard key={table.id} id={table.id} label={table.label} area={table.area} seats={table.seats} info={infoByTable.get(table.id)!} index={index} onOpen={openTable} joinedLabel={joinedLabelByTable.get(table.id) || null} />)}
            </div>
          )}
        </div>
        {sideOpen
          ? <div className="salon-side-wrap hidden lg:block"><SalonSidebar variant="panel" tab={sideTab} onTabChange={setSideTab} openTabs={sideOpenTabs} closedToday={sideClosed} orders={sideOrders} calls={sideCalls} now={now} nightStats={{ ...nightStats, onRefresh: nightStats.refresh }}
              busyCallId={busy?.startsWith('call-') ? busy.slice(5) : null} onSelectTable={openTable} onHandleCall={id => void markCallHandled(id)} onClose={() => toggleSide(false)} /></div>
          : <button type="button" onClick={() => toggleSide(true)} className="salon-rail hidden lg:flex" aria-label="Abrir painel lateral"><PanelRightOpen className="h-5 w-5" aria-hidden="true" /><b>{sideOpenTabs.length}</b></button>}
      </div>
      <button type="button" onClick={() => setDrawerOpen(true)} className="salon-fab lg:hidden" data-testid="salon-drawer-open"><PanelRightOpen className="h-5 w-5" aria-hidden="true" />Comandas<b>{sideOpenTabs.length}</b>{sideCalls.length > 0 && <span className="salon-fab-dot" aria-label={`${sideCalls.length} chamados`} />}</button>
      {drawerOpen && <div className="salon-drawer-backdrop lg:hidden" role="presentation" onClick={event => { if (event.target === event.currentTarget) setDrawerOpen(false); }}>
        <div className="salon-drawer" role="dialog" aria-modal="true" aria-label="Painel lateral do salão"><SalonSidebar variant="drawer" tab={sideTab} onTabChange={setSideTab} openTabs={sideOpenTabs} closedToday={sideClosed} orders={sideOrders} calls={sideCalls} now={now} nightStats={{ ...nightStats, onRefresh: nightStats.refresh }}
          busyCallId={busy?.startsWith('call-') ? busy.slice(5) : null} onSelectTable={openTable} onHandleCall={id => void markCallHandled(id)} onClose={() => setDrawerOpen(false)} /></div></div>}
      {selectedTable && <div className="fixed inset-0 z-40 flex justify-end bg-black/40" role="presentation" onClick={event => { if (event.target === event.currentTarget) setSelectedTableId(null); }}>
        <section className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl" role="dialog" aria-label={`Comanda ${selectedTable.label}`}>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-xl font-black">{selectedTable.label} · {selectedTable.area || 'Salão'}</h2><p className="text-sm text-gray-500">{selectedTable.seats} lugares</p></div>
            <button type="button" onClick={() => setSelectedTableId(null)} aria-label="Fechar detalhes"><X className="h-5 w-5" /></button>
          </div>
          {!selectedTab ? <div className="mt-6 rounded-xl bg-gray-50 p-4 text-sm text-gray-600"><p>Mesa livre, sem comanda aberta.</p>{caps.tableAccess && <button type="button" disabled={!!busy} onClick={() => selectedTableId && void run('open-table', () => salonStaffRepository.openTab(selectedTableId))} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-bold text-white"><Plus className="h-4 w-4" />Abrir mesa para o cliente</button>}</div> : <>
            {selectedTab.status !== 'OPEN' && <p role="status" className={`mt-4 rounded-xl p-3 text-sm font-bold ${['WAITER_AUTHORIZED', 'BILL_REQUESTED'].includes(selectedTab.status) ? 'salon-bill-alert' : 'border border-sky-300 bg-sky-50 text-sky-900'}`}>
              {selectedTab.status === 'BILL_REQUESTED' ? 'Conta solicitada. Feche no caixa ou autorize o garçom a cobrar esta comanda.' : selectedTab.status === 'WAITER_AUTHORIZED' ? 'Garçom autorizado a fechar esta conta após confirmar o pagamento.' : 'Aguardando pagamento. A mesa permanece aberta até a confirmação.'}
            </p>}
            {joinedTablesForSelectedTab.length > 1 && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="salon-joined-tables">
                <p className="font-black text-slate-900">Mesas juntas nesta comanda</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {joinedTablesForSelectedTab.map(jt => (
                    <div key={jt.id} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800">
                      <span>{jt.label}</span>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => separateJoinedTable(jt.id)}
                        data-testid={`salon-separate-table-${jt.id}`}
                        className="rounded bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                      >
                        Separar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {movesForSelectedTab.length > 0 && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700" data-testid="salon-table-moves">
                <p className="font-black text-slate-900">Histórico de mesas</p>
                <ul className="mt-1.5 space-y-1">
                  {movesForSelectedTab.map(m => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <b>{m.from_label ? `${m.from_label} → ${m.to_label}` : m.to_label}</b> ({m.action === 'MOVE' ? 'Troca de mesa' : m.action === 'JOIN' ? 'Mesas juntas' : 'Mesa separada'} · {m.actor_name || (m.actor_kind === 'STAFF' ? 'Equipe' : 'Cliente')})
                      </span>
                      <span className="text-slate-500">{new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-5 space-y-3" data-testid="salon-people">
              <h3 className="font-black">Pessoas e liberação</h3>
              {activeSessions.some(session => !session.approved_at) && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950">Há pessoas aguardando liberação nesta mesa. Aprove para elas poderem pedir.</p>}
              {activeSessions.map(session => {
                const isHolder = !!access && access.responsibleSessionByTab.get(selectedTab.id) === session.id;
                return <div key={session.id} className={`rounded-xl border p-3 ${session.approved_at ? '' : 'border-amber-300 bg-amber-50/60'}`} data-testid={`salon-session-${session.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div><div className="font-bold">{session.display_name}{isHolder && <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">Responsável</span>}</div><div className="text-xs text-gray-500">{session.approved_at ? 'Liberada' : 'Aguardando liberação'}</div></div>
                    {!session.approved_at && <div className="flex gap-2">
                      {caps.tableAccess && <button type="button" disabled={!!busy} onClick={() => setConfirmReject(session.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-bold text-rose-700">Recusar</button>}
                      <button type="button" disabled={busy === `approve-${session.id}`} onClick={() => void approve(session.id)} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white">{caps.tableAccess ? 'Aprovar' : 'Liberar'}</button>
                    </div>}
                  </div>
                  {confirmReject === session.id && <div role="alertdialog" aria-label="Confirmar recusa" className="mt-2 rounded-lg bg-rose-50 p-3 text-sm"><p className="font-semibold">Recusar {session.display_name}? Ele perde o acesso a esta mesa.</p><div className="mt-2 flex gap-2"><button type="button" disabled={!!busy} onClick={() => void reject(session.id)} className="rounded-lg bg-rose-600 px-3 py-2 font-bold text-white">Recusar</button><button type="button" onClick={() => setConfirmReject(null)} className="rounded-lg border bg-white px-3 py-2 font-bold">Voltar</button></div></div>}
                </div>;
              })}
              {activeSessions.length === 0 && <p className="text-sm text-gray-500">Sem sessões ativas.</p>}
              {caps.tableAccess && access && <div className="rounded-xl bg-slate-50 p-3 text-sm" data-testid="salon-holder">
                <p className="font-bold">Responsável pela mesa</p>
                <p className="text-xs text-gray-600">
                  {access.responsibleSessionByTab.get(selectedTab.id)
                    ? (activeSessions.find(item => item.id === access.responsibleSessionByTab.get(selectedTab.id))?.display_name || 'Cliente')
                    : 'Sem responsável (mesa travada): ninguém assume sozinho pelo QR da mesa. Use Trocar responsável na frente do cliente.'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={changeHolder}
                    className="rounded-lg border bg-white px-3 py-2 font-bold"
                    title="Gera um QR ou código de 6 caracteres de uso único (expira em 5 min) para o cliente assumir na frente do garçom."
                  >
                    Trocar responsável
                  </button>
                  {activeSessions.some(item => item.approved_at && item.id !== access.responsibleSessionByTab.get(selectedTab.id)) && <button type="button" disabled={!!busy} onClick={() => setTransferOpen(open => !open)} className="rounded-lg border bg-white px-3 py-2 font-bold">Passar responsável</button>}
                </div>
                {holderCode && (
                  <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-slate-900" data-testid="salon-holder-code">
                    <p className="text-xs font-black uppercase tracking-wide text-amber-900">Código único para o novo responsável (5 min)</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {holderCode.qrToken && (holderCode.tenantSlug || activeTenant?.slug) && typeof window !== 'undefined' && (
                        <div className="rounded-xl bg-white p-2 shadow-sm">
                          <QRCodeSVG
                            value={inviteUrl(window.location.origin, holderCode.tenantSlug || activeTenant?.slug || '', holderCode.qrToken, holderCode.code)}
                            size={108}
                          />
                        </div>
                      )}
                      <div className="space-y-1">
                        <p className="font-mono text-2xl font-black tracking-[0.22em] text-slate-900">{holderCode.code}</p>
                        <p className="text-xs font-semibold text-amber-950">Uso único · Expira em 5 minutos · Fica somente na tela da equipe</p>
                        <p className="text-xs text-slate-700">Mostre na frente do cliente para ele ler este QR ou digitar em &ldquo;Fui convidado&rdquo;.</p>
                      </div>
                    </div>
                  </div>
                )}
                {transferOpen && <div className="mt-2 space-y-1" role="group" aria-label="Passar responsável para">{activeSessions.filter(item => item.approved_at && item.id !== access.responsibleSessionByTab.get(selectedTab.id)).map(item => <button key={item.id} type="button" disabled={!!busy} onClick={() => transferHolder(item.id)} className="block w-full rounded-lg border bg-white px-3 py-2 text-left font-semibold">{item.display_name}</button>)}</div>}
              </div>}
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
              <button
                type="button"
                disabled={selectedTab.status !== 'OPEN'}
                onClick={() => {
                  setOptionChoices([]);
                  setProductId('');
                  setProductSearch('');
                  setSelectedCategoryId('ALL');
                  setOrderOpen(true);
                  if (!products.length && activeTenant?.id) {
                    void salonStaffRepository.loadMenu(activeTenant.id, activeTenant.slug || null, securityContext).then(menu => {
                      setProducts(menu.products);
                      setCategories(menu.categories);
                    });
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-bold text-white"
              >
                <Plus className="h-4 w-4" />Lançar pedido
              </button>
              {totalCents === 0 && activeRounds.length === 0 ? (
                <button
                  type="button"
                  data-testid="salon-release-empty-btn"
                  disabled={!!busy}
                  onClick={() => setReleaseEmptyOpen(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-bold text-rose-800"
                >
                  Liberar mesa (sem consumo)
                </button>
              ) : canClose ? (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={openCheckout}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white"
                >
                  <Receipt className="h-4 w-4" />{selectedTab.status === 'AWAITING_PAYMENT' ? 'Ver pagamento pendente' : 'Fechar conta'}
                </button>
              ) : null}
              {canManageBill && selectedTab.status === 'BILL_REQUESTED' && <button type="button" disabled={!!busy} onClick={authorizeWaiter} className="inline-flex items-center gap-2 rounded-xl bg-[#9B4DE0] px-4 py-3 font-bold text-white">Autorizar garçom a fechar</button>}
              {['BILL_REQUESTED', 'WAITER_AUTHORIZED'].includes(selectedTab.status) && <button type="button" disabled={!!busy} data-testid="salon-reopen-tab" onClick={() => void run('reopen-tab', async () => {
                const { error } = await supabase.rpc('staff_reopen_tab', { p_tab: selectedTab.id });
                if (error) throw error;
              })} className="rounded-xl border border-[#1E8E38] bg-[#2DBE4E] px-4 py-3 font-bold text-[#0F172A]" style={{ backgroundColor: '#2DBE4E', borderColor: '#1E8E38', color: '#0F172A' }}>Pedir mais</button>}
            </div>
            {releaseEmptyOpen && (
              <div role="alertdialog" aria-label="Liberar mesa sem consumo" data-testid="salon-release-empty-dialog" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-slate-900">
                <p className="font-black text-rose-900">Liberar {selectedTable.label} sem consumo?</p>
                <p className="mt-1 text-xs text-slate-700">A comanda será encerrada como cancelada (R$ 0,00), as sessões ativas serão encerradas e a mesa voltará para Livre.</p>
                <label className="mt-3 block text-xs font-bold text-slate-700">
                  Motivo (opcional)
                  <select
                    aria-label="Motivo para liberar a mesa"
                    value={releaseEmptyReason}
                    onChange={event => setReleaseEmptyReason(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"
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
                    onChange={event => setReleaseEmptyCustomReason(event.target.value)}
                    placeholder="Descreva o motivo (opcional)"
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  />
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="salon-release-empty-confirm"
                    disabled={!!busy}
                    onClick={releaseEmptyTab}
                    className="rounded-lg bg-rose-600 px-4 py-2 font-bold text-white disabled:opacity-50"
                  >
                    Confirmar liberação
                  </button>
                  <button
                    type="button"
                    onClick={() => setReleaseEmptyOpen(false)}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-bold text-slate-700"
                  >
                    Voltar
                  </button>
                </div>
              </div>
            )}
          </>}
        </section>
      </div>}
      <Modal isOpen={orderOpen} onClose={() => setOrderOpen(false)} title="Lançar pedido na mesa">
        <div className="space-y-3">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <input
              type="search"
              aria-label="Buscar produto"
              placeholder="Buscar produto"
              value={productSearch}
              onChange={event => setProductSearch(event.target.value)}
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>
          {derivedCategories.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Categorias">
              <button
                type="button"
                aria-pressed={selectedCategoryId === 'ALL'}
                onClick={() => setSelectedCategoryId('ALL')}
                className={` shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${selectedCategoryId === 'ALL' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}
              >
                Todas
              </button>
              {derivedCategories.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={selectedCategoryId === cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${selectedCategoryId === cat.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
          <div className="max-h-60 space-y-2 overflow-y-auto pr-1" role="listbox" aria-label="Cardápio da loja">
            {filteredCatalogProducts.map(product => {
              const selected = productId === product.id;
              return (
                <button
                  key={product.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-testid={`salon-order-product-${product.id}`}
                  onClick={() => { setOptionChoices([]); setProductId(product.id); }}
                  className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition ${selected ? 'border-slate-900 bg-slate-50 ring-2 ring-slate-900' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" />
                  ) : (
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500" aria-hidden="true">
                      <ShoppingBag className="h-5 w-5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-900">{product.name}</span>
                    {product.description && <span className="block truncate text-xs text-slate-500">{product.description}</span>}
                    <span className="mt-0.5 block text-xs font-extrabold text-teal-800">{money(product.price)}</span>
                  </span>
                </button>
              );
            })}
            {filteredCatalogProducts.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-gray-500">Nenhum produto encontrado.</p>
            )}
          </div>
          {optionsError && <p role="alert" className="text-sm text-rose-700">{optionsError}</p>}
          {optionsLoading && <p role="status" className="text-sm text-gray-500">Carregando adicionais…</p>}
          {selectedProduct?.optionGroups?.some(group => group.active) && <ProductOptionsSelector
            groups={selectedProduct.optionGroups}
            selections={optionChoices}
            onChange={setOptionChoices}
          />}
          <label className="block text-sm font-semibold">Quantidade<input aria-label="Quantidade" type="number" min={1} value={quantity} onChange={event => setQuantity(Math.max(1, Number(event.target.value)))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <label className="block text-sm font-semibold">Observação<input aria-label="Observação" value={notes} onChange={event => setNotes(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
          <button type="button" data-testid="salon-order-submit" disabled={!productId || !!busy || optionsLoading || !!optionsError || !validateOptionSelection(selectedProduct?.optionGroups?.filter(group => group.active) || [], optionChoices).valid} onClick={submitStaffRound} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50">Fazer pedido</button>
        </div>
      </Modal>
      <Modal isOpen={closeOpen} onClose={() => { setManualSettled(null); setCloseOpen(false); }} title="Revisar e fechar conta">
        <div className="space-y-3">
          {manualSettled ? (
            <TabPaymentConfirmation
              tabId={manualSettled.tabId}
              amountCents={manualSettled.totalCents}
              tableLabel={manualSettled.tableLabel}
              method={manualSettled.method}
              paidAt={manualSettled.paidAt}
              onDone={() => { setManualSettled(null); setCloseOpen(false); setCheckout(null); setSelectedTableId(null); }}
            />
          ) : (<>
            <p className="text-lg font-black">Total: {money((checkout?.totalCents ?? totalCents) / 100)}</p>
            <p className="text-sm text-slate-600">Escolha Dinheiro, Cartão ou Pix. Confirme dinheiro/cartão somente depois de receber o pagamento.</p>
            {pixLive && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">Consulte o status e o comprovante do PIX abaixo.</p>}
            {payments.map((payment, index) => <div key={index} className="grid grid-cols-1 gap-2 rounded-xl border p-3 sm:grid-cols-3">
              <select aria-label={`Forma de pagamento ${index + 1}`} disabled={pixLive} value={payment.method} onChange={event => {
                const method = event.target.value as PaymentMethod;
                if (method === 'PIX') setPayments([{ method, amount: (totalCents / 100).toFixed(2), tendered: '' }]);
                else setPayments(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, method } : row));
              }} className="rounded-lg border px-2 py-2">
                <option value="">Escolha a forma de pagamento</option><option value="CASH">Dinheiro</option><option value="CREDIT_CARD">Cartão de crédito</option><option value="DEBIT_CARD">Cartão de débito</option><option value="PIX">Pix na mesa</option>
              </select>
              {payment.method !== 'PIX' && <input aria-label={`Valor do pagamento ${index + 1}`} value={payment.amount} onChange={event => setPayments(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} placeholder="Valor" inputMode="decimal" className="rounded-lg border px-2 py-2" />}
              {payment.method === 'CASH' ? <input aria-label="Troco para" value={payment.tendered} onChange={event => setPayments(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, tendered: event.target.value } : row))} placeholder="Troco para R$" inputMode="decimal" className="rounded-lg border px-2 py-2" /> : <span />}
            </div>)}
            {pixSelected && checkout?.tenantId === activeTenant.id && caps.tabPix && canClose && <TabPixPanel key={checkout.tabId} tabId={checkout.tabId} tableLabel={checkout.tableLabel} totalCents={checkout.totalCents} onLiveChange={onPixLive} onSettled={onPixSettled} />}
            {pixSelected && !caps.tabPix && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">O Pix da conta não está disponível. Configure o pagamento online ou escolha dinheiro/cartão.</p>}
            {!pixSelected && <div className="flex gap-2">
              <button type="button" onClick={() => setPayments(rows => [...rows, { method: 'CASH', amount: '', tendered: '' }])} className="rounded-lg border px-3 py-2 text-sm font-bold">Adicionar pagamento</button>
              {payments.length > 1 && <button type="button" onClick={() => setPayments(rows => rows.slice(0, -1))} className="rounded-lg border px-3 py-2 text-sm font-bold">Remover último</button>}
            </div>}
            {payments.some(payment => payment.method === 'CASH' && payment.tendered && Number(payment.tendered.replace(',', '.')) * 100 < Number(payment.amount.replace(',', '.')) * 100) && <p role="alert" className="text-sm font-bold text-red-700">O valor precisa ser maior que a conta</p>}
            {!pixSelected && <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={receivedConfirmed} onChange={event => setReceivedConfirmed(event.target.checked)} />Confirmei o recebimento</label>}
            {!pixSelected && <button type="button" disabled={!!busy || pixLive || !receivedConfirmed || payments.some(payment => !payment.method)} onClick={closeTab} className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50">Confirmar recebimento e fechar conta</button>}
          </>)}
        </div>
      </Modal>

      <Modal isOpen={joinModalOpen} onClose={() => setJoinModalOpen(false)} title="Juntar mesas">
        <div className="space-y-3" data-testid="salon-join-tables-modal">
          <p className="text-sm text-slate-600">
            Selecione 2 ou mais mesas para unir em uma única comanda. As mesas juntas aparecem ligadas no Salão com a mesma cor e comanda.
          </p>
          <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {tables.map(table => {
              const checked = selectedJoinTables.includes(table.id);
              return (
                <button
                  key={table.id}
                  type="button"
                  aria-pressed={checked}
                  data-testid={`salon-join-option-${table.id}`}
                  onClick={() => { setJoinConsent(false); setSelectedJoinTables(prev => prev.includes(table.id) ? prev.filter(id => id !== table.id) : [...prev, table.id]); }}
                  className={`rounded-xl border p-2.5 text-left text-xs font-bold transition ${checked ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'}`}
                >
                  <div>{table.label}</div>
                  <div className={`text-[11px] font-normal ${checked ? 'text-slate-300' : 'text-slate-500'}`}>{table.area || 'Salão'}</div>
                </button>
              );
            })}
          </div>
          {joinNeedsConsent && <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" checked={joinConsent} disabled={!!busy} onChange={event => setJoinConsent(event.target.checked)} />Os responsáveis aceitaram juntar os pedidos e valores das contas ocupadas.</label>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setJoinModalOpen(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700"
            >
              Cancelar
            </button>
            <button
              type="button"
              data-testid="salon-confirm-join-tables"
              disabled={selectedJoinTables.length < 2 || !!busy || (joinNeedsConsent && !joinConsent)}
              onClick={confirmJoinTables}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              Confirmar junção ({selectedJoinTables.length})
            </button>
          </div>
        </div>
      </Modal>

      <WaiterModesModal
        isOpen={modesOpen}
        onClose={() => setModesOpen(false)}
        tenantId={activeTenant.id}
        tables={tables}
        onSaved={() => void load()}
      />
      {dispatchCall && (
        <CentralDispatchModal
          isOpen={!!dispatchCall}
          onClose={() => setDispatchCall(null)}
          tenantId={activeTenant.id}
          call={dispatchCall}
          onDispatched={() => void load()}
        />
      )}
    </div>
  );
};
