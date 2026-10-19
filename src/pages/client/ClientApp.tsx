import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { normalizeBRPhone, formatBRPhone, brPhoneDigits } from '../../lib/phone/brPhone';
import { DeliveryCodeCard } from '../../components/client/DeliveryCodeCard';
import { PickupArrivalCard } from '../../components/pickup/PickupArrivalCard';
import { isStaffPreview } from '../../lib/storefront/staffPreview';
import { storeDeliveryLabel } from '../../lib/pricing/deliveryLabel';
import { formatBRL } from '../../lib/pricing/money';
import { computeCashChange, cashChangeLabel } from '../../lib/pricing/cashChange';
import { CashChangeHint } from '../../components/client/CashChangeHint';
import { CustomerEmailConfirmNotice, CustomerEmailNoticeKind } from '../../components/client/CustomerEmailConfirmNotice';
import { rememberLastStoreSlug } from '../../lib/auth/authRedirect';
import { installHintBottomOffset } from '../../lib/pwa/installHintLayout';
import { campaignRepository } from '../../repositories/campaignRepository';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { canPreviewCheckoutWithoutLogin } from '../../lib/demoCheckoutPreview';

// Prévia da sacola sem login: SOMENTE demo local (sem Supabase). Ver src/lib/demoCheckoutPreview.ts.
const DEMO_CHECKOUT_PREVIEW = canPreviewCheckoutWithoutLogin(isSupabaseConfigured, import.meta.env.VITE_ENABLE_DEMO_MODE);
import { publicStoreRepository, PublicStoreData } from '../../repositories/publicStoreRepository';
import { promotionRepository } from '../../repositories/promotionRepository';
import { orderRepository } from '../../repositories/orderRepository';
import { customerRepository } from '../../repositories/customerRepository';
import { orderService } from '../../services/orderService';
import { OrderPixPanel } from '../../components/client/OrderPixPanel';
import { OrderTrackingTimeline } from '../../components/client/OrderTrackingTimeline';
import { customerOrdersTitle, storeDisplayName, CUSTOMER_ORDERS_SCOPE_HINT } from '../../lib/customer/orderStore';
import { LiveDriverTracking } from '../../components/client/customer/LiveDriverTracking';
import { isLiveTrackable } from '../../lib/customer/liveTracking';
import { buildCustomerTimeline } from '../../lib/orders/customerTracking';
import { paymentMethodLabel } from '../../lib/orders/labels';
import { readTrackingDeepLink, trackingUrlFor } from '../../lib/orders/trackingDeepLink';
import { isN1N6Backend } from '../../lib/backendSchema';
import { OfferCarousel } from '../../components/common/OfferCarousel';
import { buildStorefrontCards } from '../../utils/storefrontCards';
import { PromotionalCheckoutModal } from '../../components/client/PromotionalCheckoutModal';
import { MobileNavigation } from '../../components/layout/MobileNavigation';
import { AddressAutocompleteInput, ParsedAddress } from '../../components/onboarding/AddressAutocompleteInput';
import { Card } from '../../components/ui/Card';
import { InstallStoreAppHint } from '../../components/client/InstallStoreAppHint';
import { emitInviteTrigger } from '../../lib/pwa/installState';
import { applyStoreIdentity } from '../../lib/pwa/applyStoreIdentity';
import { cartStorageKey } from '../../lib/pwa/storeManifest';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Product, CustomerOrigin, Order, Offer, OrderStatus, TenantTheme, Coupon, RedeemCouponResult } from '../../types';
import { 
  Search, 
  ShoppingBag, 
  Plus, 
  Minus, 
  Clock, 
  MapPin, 
  CheckCircle2, 
  ArrowRight, 
  Sparkles,
  Flame,
  User as UserIcon,
  Tag,
  Ticket,
  Store,
  Phone,
  ArrowLeft,
  Bike,
  Building,
  CreditCard,
  QrCode,
  Copy,
  AlertCircle,
  MessageCircle,
  FileText,
  XCircle,
  Check,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Lock,
  UserCheck,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  RotateCcw
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  computeFulfillmentPricing,
  fulfillmentSettingsFromTenant,
  productToPricingLine,
  resolveAvailableModes,
} from '../../lib/pricing/fulfillmentPricing';
import {
  CATALOG_ORIGIN,
  CAMPAIGN_REASON_TEXT,
  PurchaseOrigin,
  addToOriginCart,
  cartLineKey,
  decrementOriginCart,
  hydrateOriginCart,
  priceLineByOrigin,
  revalidateOriginCart,
  toCheckoutItem,
} from '../../lib/pricing/purchaseOrigin';
import { StoreLogo } from '../../components/client/StoreLogo';
import { newIdempotencyKey } from '../../lib/pricing/idempotency';
import { searchProducts } from '../../lib/customer/search';
import { buildReorderCart } from '../../lib/customer/reorder';
import { groupOrderHistory } from '../../lib/customer/orderHistory';
import { buildNotifications } from '../../lib/customer/notifications';
import { OfferListItem } from '../../lib/customer/offers';
import {
  SavedAddress, addressSubtitle, addressTitle, clearSearchHistory, defaultKV, loadAddressBook, loadFavorites, loadNotificationPrefs,
  loadNotificationsSeenAt, markNotificationsSeen, markPushPromptShown, shouldShowPushPrompt, toggleFavorite,
} from '../../lib/customer/localStore';
import { customerAppRepository } from '../../repositories/customerAppRepository';
import { CartScreen } from '../../components/client/customer/CartScreen';
import { SearchScreen } from '../../components/client/customer/SearchScreen';
import { OffersScreen } from '../../components/client/customer/OffersScreen';
import { ProfileScreen, ProfilePage } from '../../components/client/customer/ProfileScreen';
import { AddressFlow } from '../../components/client/customer/AddressFlow';
import { BottomSheet, SkeletonRows } from '../../components/client/customer/ui';
import { BellRing, ChevronDown, LifeBuoy } from 'lucide-react';

// Linha do carrinho: produto + ORIGEM da compra (catálogo ou item de campanha). Chave = produto + origem.
type CustomerTab = 'home' | 'search' | 'offers' | 'cart' | 'orders' | 'profile';

interface CartItem {
  key: string;
  product: Product;
  quantity: number;
  notes?: string;
  origin: PurchaseOrigin;
}

const GoogleIcon: React.FC = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);


/** Sessão anônima da vitrine para dedupe de eventos N5 (sessionStorage; sem dados pessoais). */
function getCampaignSessionId(): string {
  const KEY = 'dc_campaign_session';
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export const ClientApp: React.FC<{ forcedSlug?: string }> = ({ forcedSlug }) => {
  const { supabaseUser, signInWithGoogle, signInWithPassword, signUp, signOut, activeTenant, resendConfirmationEmail } = useAuth();
  const { showToast } = useToast();

  // 1. Extração estrita do Slug da URL
  const slug = useMemo(() => {
    if (forcedSlug) return forcedSlug;
    const path = window.location.pathname;
    if (path.startsWith('/app/')) {
      return path.replace('/app/', '').split('/')[0];
    }
    return '';
  }, [forcedSlug]);

  // 2. Estados de Carregamento e Dados do Catálogo Real
  const [storeData, setStoreData] = useState<PublicStoreData | null>(null);
  const [isLoadingStore, setIsLoadingStore] = useState(true);
  const [storeNotFound, setStoreNotFound] = useState(false);
  // Falha técnica ao carregar a vitrine (ex.: RPC com erro) — distinta de "loja não encontrada".
  const [storeLoadError, setStoreLoadError] = useState<string | null>(null);

  // 3. Estados de Navegação e Filtros
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  // Deep link: /app/<slug>#pedidos ou ?pedido=<id> abre direto o acompanhamento.
  const initialTrackingLink = useMemo(() => {
    try {
      return readTrackingDeepLink(window.location.search, window.location.hash);
    } catch {
      return { open: false } as { open: boolean; orderId?: string };
    }
  }, []);
  const [navTab, setNavTabRaw] = useState<CustomerTab>(initialTrackingLink.open ? 'orders' : 'home');
  const setNavTab = useCallback((t: CustomerTab) => {
    setNavTabRaw(t);
    try { window.scrollTo({ top: 0 }); } catch { /* jsdom */ }
  }, []);
  const [profilePage, setProfilePage] = useState<ProfilePage>('menu');
  const [helpOrder, setHelpOrder] = useState<Order | null>(null);
  const [expandedFailedGroups, setExpandedFailedGroups] = useState<Record<string, boolean>>({});
  const [focusOrderId, setFocusOrderId] = useState<string | null>(initialTrackingLink.orderId || null);
  const [selectedProductModal, setSelectedProductModal] = useState<Product | null>(null);
  // Origem com que o detalhe do produto foi aberto (catálogo ou item de campanha do carrossel).
  const [selectedProductOrigin, setSelectedProductOrigin] = useState<PurchaseOrigin>(CATALOG_ORIGIN);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);

  // 4. Carrinho estritamente isolado pelo tenant.id real
  const [cart, setCart] = useState<CartItem[]>([]);

  // 5. Histórico e Pedidos do Cliente
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [customerOrdersError, setCustomerOrdersError] = useState<string | null>(null);

  // 6. Modais
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [selectedPromoOffer, setSelectedPromoOffer] = useState<Offer | null>(null);
  const [isPromoCheckoutOpen, setIsPromoCheckoutOpen] = useState(false);

  // 7. Autenticação do Cliente no Checkout
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  // Spinner só no botão acionado: Google e e-mail têm estados separados.
  const [isGoogleAuthenticating, setIsGoogleAuthenticating] = useState(false);
  // Aviso persistente de confirmação de e-mail (cadastro concluído ou login com e-mail não confirmado).
  const [authNotice, setAuthNotice] = useState<{ email: string; kind: CustomerEmailNoticeKind } | null>(null);
  // Aviso persistente no checkout quando a sacola precisou ser ajustada pelo servidor.
  const [cartAdjustNotice, setCartAdjustNotice] = useState<string | null>(null);

  // 8. Form de Checkout
  const [customerName, setCustomerName] = useState(() => localStorage.getItem('adegafood_cust_name') || '');
  const [customerPhone, setCustomerPhone] = useState(() => formatBRPhone(localStorage.getItem('adegafood_cust_phone') || ''));
  const [fulfillmentType, setFulfillmentType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');

  // Endereço de entrega com Google Places
  const [streetAddress, setStreetAddress] = useState(() => localStorage.getItem('adegafood_cust_street') || '');
  const [addressNumber, setAddressNumber] = useState(() => localStorage.getItem('adegafood_cust_number') || '');
  const [neighborhood, setNeighborhood] = useState(() => localStorage.getItem('adegafood_cust_neighborhood') || '');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [complement, setComplement] = useState('');
  const [reference, setReference] = useState('');
  const [formattedAddress, setFormattedAddress] = useState('');
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [placeId, setPlaceId] = useState<string | undefined>();

  // Pagamento e Observações
  const [paymentMethod, setPaymentMethod] = useState<'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'CASH'>('PIX');
  const [cashChange, setCashChange] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [origin] = useState<CustomerOrigin>('qr_code');

  // Cupom de Desconto (COMANDO 138)
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [, setCouponDiscount] = useState(0); // valor exibido vem de computeFulfillmentPricing (abaixo)
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponMessage, setCouponMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Submissão do Pedido
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);

  // Momentos-chave do convite de instalação (produto aberto, item na sacola, pedido concluído).
  const inviteCartCountRef = useRef(0);
  const inviteMountedAtRef = useRef(Date.now());
  useEffect(() => { if (selectedProductModal) { const t = setTimeout(() => emitInviteTrigger('product'), 1200); return () => clearTimeout(t); } }, [selectedProductModal]);
  useEffect(() => {
    const n = cart.reduce((a, i) => a + (Number((i as { quantity?: number }).quantity) || 1), 0);
    if (n > inviteCartCountRef.current && Date.now() - inviteMountedAtRef.current > 2000) emitInviteTrigger('cart'); // ignora a sacola restaurada
    inviteCartCountRef.current = n;
  }, [cart]);
  useEffect(() => { if (completedOrder) { const t = setTimeout(() => emitInviteTrigger('order'), 800); return () => clearTimeout(t); } }, [completedOrder]);
  const [completedCouponRedemption, setCompletedCouponRedemption] = useState<RedeemCouponResult | null>(null);
  const [copiedPix, setCopiedPix] = useState(false);

  // App do cliente (P1): dados no aparelho por usuário (endereços, favoritos, leitura de notificações).
  const kv = useMemo(() => defaultKV(), []);
  const userKey = supabaseUser?.id || null;
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [addressFlow, setAddressFlow] = useState<{ open: boolean; mode: 'select' | 'manage' }>({ open: false, mode: 'select' });
  const [selectedAddress, setSelectedAddress] = useState<SavedAddress | null>(null);
  const [notificationsSeenAt, setNotificationsSeenAt] = useState(0);
  const [pushPromptOpen, setPushPromptOpen] = useState(false);
  // Sacola → "Continuar" sem endereço: depois de escolher, segue direto para o checkout.
  const continueAfterAddressRef = useRef(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  // --------------------------------------------------------------------------
  // CARREGAR CATÁLOGO REAL DO ESTABELECIMENTO PELO SLUG (SEM FALLBACK MOCK)
  // --------------------------------------------------------------------------
  const loadStore = useCallback(async () => {
    if (!slug) {
      setStoreData(null);
      setStoreNotFound(true);
      setIsLoadingStore(false);
      return;
    }

    setIsLoadingStore(true);
    setStoreNotFound(false);
    setStoreLoadError(null);

    try {
      const result = await publicStoreRepository.loadPublicStore(slug);
      if (result.status === 'error') {
        setStoreData(null);
        setStoreLoadError(result.message);
        return;
      }
      const data = result.status === 'ok' ? result.data : null;
      if (data && data.tenant) {
        setStoreData(data);
        // Carrega carrinho específico deste estabelecimento
        try {
          const savedCart = localStorage.getItem(cartStorageKey(data.tenant.id));
          if (savedCart) setCart(hydrateOriginCart<Product>(JSON.parse(savedCart)) as CartItem[]);
          else setCart([]);
        } catch {
          setCart([]);
        }
      } else {
        setStoreData(null);
        setStoreNotFound(true);
      }
    } catch (err) {
      console.warn('[ClientApp] Erro ao carregar loja por slug:', err);
      setStoreData(null);
      setStoreLoadError(err instanceof Error ? err.message : 'Erro inesperado ao carregar a vitrine.');
    } finally {
      setIsLoadingStore(false);
    }
  }, [slug]);

  // Relógio da vitrine (relógio do SERVIDOR corrigido pelo offset recebido no get_public_store).
  // Atualiza a cada 15 s para que cards que expiram com a página aberta saiam da vitrine.
  const [storefrontClockTick, setStorefrontClockTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setStorefrontClockTick(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  // Cards da vitrine: cards do painel (offers) + cards de campanhas publicadas, somente do tenant do slug,
  // filtrados por status/início/término e ordenados (ver utils/storefrontCards.ts).
  const storefrontCards = useMemo<Offer[]>(() => {
    if (!storeData) return [];
    return buildStorefrontCards(
      storeData.offers,
      storeData.campaigns,
      storefrontClockTick + storeData.serverTimeOffsetMs,
      storeData.tenant.id
    );
  }, [storeData, storefrontClockTick]);

  useEffect(() => {
    loadStore();
  }, [loadStore]);

  // Cliente conectado (ex.: voltou do link de confirmação): o aviso de confirmação não é mais necessário.
  useEffect(() => {
    if (supabaseUser) setAuthNotice(null);
  }, [supabaseUser]);

  // Última loja visitada: a raiz ("Conta de Cliente Conectada") oferece voltar para ela após confirmar o e-mail.
  useEffect(() => {
    if (slug) rememberLastStoreSlug(typeof window !== 'undefined' ? window.localStorage : null, slug);
  }, [slug]);

  // PWA white-label: manifesto/ícone/nome/cores da loja ativa (somente rotas /app/<slug>)
  useEffect(() => {
    const t = storeData?.tenant;
    if (!t) return;
    applyStoreIdentity({ id: t.id, slug: t.slug, name: t.name, theme: storeData?.theme }).catch(err => {
      console.warn('[ClientApp] Falha ao aplicar identidade PWA da loja:', err);
    });
  }, [storeData?.tenant, storeData?.theme]);

  // Persistir carrinho no localStorage sob o ID oficial do tenant
  useEffect(() => {
    if (storeData?.tenant.id) {
      try {
        localStorage.setItem(cartStorageKey(storeData.tenant.id), JSON.stringify(cart));
      } catch {
        // ignore
      }
    }
  }, [cart, storeData?.tenant.id]);

  // Rastreia o usuário e tenant anteriormente sincronizados para evitar limpar pedidos indevidamente
  const prevSyncUserTenantRef = useRef<string | null>(null);

  // Sincronizar dados cadastrais do cliente autenticado e limpar histórico anterior SOMENTE ao trocar de usuário ou tenant
  useEffect(() => {
    const currentKey = `${supabaseUser?.id || 'anon'}_${storeData?.tenant.id || 'none'}`;

    if (prevSyncUserTenantRef.current !== currentKey) {
      prevSyncUserTenantRef.current = currentKey;
      setCustomerOrders([]);
      setCustomerOrdersError(null);
    }

    if (supabaseUser && storeData?.tenant.id) {
      customerRepository.getCustomerByUserId(storeData.tenant.id, supabaseUser.id)
        .then((existingCust) => {
          if (existingCust) {
            setCustomerName(existingCust.name);
            setCustomerPhone(formatBRPhone(existingCust.phone));
          } else {
            const metaName = supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name;
            if (metaName) setCustomerName(metaName);
          }
        })
        .catch(() => {});
    }
  }, [supabaseUser?.id, storeData?.tenant.id]);

  // Carregar histórico de pedidos do cliente autenticado
  const loadCustomerOrders = useCallback(async (opts?: { silent?: boolean }) => {
    if (!storeData?.tenant.id || !supabaseUser?.id) {
      setCustomerOrders([]);
      setCustomerOrdersError(null);
      return;
    }

    // Atualização em segundo plano (polling) não troca a lista pelo "Carregando..." a cada ciclo.
    if (!opts?.silent) setIsLoadingOrders(true);
    setCustomerOrdersError(null);
    try {
      const orders = await orderRepository.getCustomerOrders(storeData.tenant.id, supabaseUser.id);
      setCustomerOrders(prev => {
        // Se a busca remota retornou pedidos, mesclamos mantendo qualquer pedido criado localmente
        if (orders && orders.length > 0) {
          const map = new Map<string, Order>();
          // Pedidos remotos têm precedência de status
          orders.forEach(o => map.set(o.id, o));
          // Preserva pedidos locais recentes caso ainda não tenham sido indexados
          prev.forEach(p => {
            if (!map.has(p.id)) map.set(p.id, p);
          });
          return Array.from(map.values()).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        }
        // Se a busca remota retornou vazia mas o cliente tem pedidos no state local deste mesmo tenant, mantém os locais
        const localBelongingToTenant = prev.filter(p => p.tenantId === storeData.tenant.id);
        if (localBelongingToTenant.length > 0) {
          return localBelongingToTenant;
        }
        return orders;
      });
    } catch (err: any) {
      console.warn('[ClientApp] Erro ao carregar pedidos do cliente:', err);
      // Não exibe erro impeditivo se já existirem pedidos carregados em memória
      setCustomerOrders(prev => {
        if (prev.length === 0) {
          setCustomerOrdersError(err.message || 'Falha de comunicação ao consultar seus pedidos.');
        }
        return prev;
      });
    } finally {
      setIsLoadingOrders(false);
    }
  }, [storeData?.tenant.id, supabaseUser?.id]);

  // "Peça de novo": catálogo ATUAL (preço/disponibilidade de agora); itens que não existem mais ficam de fora.
  const handleRepeatOrder = useCallback((order: Order) => {
    if (!storeData || !order.items || order.items.length === 0) return;
    const r = buildReorderCart(order.items, storeData.products, storeData.tenant.id);
    if (r.lines.length === 0) {
      showToast({ type: 'warning', title: 'Itens indisponíveis', message: 'Nenhum item deste pedido está disponível agora.' });
      return;
    }
    setCart(prev => {
      const next = [...prev];
      for (const l of r.lines) {
        const ex = next.find(x => x.key === l.key);
        if (ex) ex.quantity += l.quantity;
        else next.push({ key: l.key, product: l.product, quantity: l.quantity, notes: l.notes, origin: l.origin });
      }
      return next.map(x => ({ ...x }));
    });
    setNavTab('cart');
    const notes: string[] = [];
    if (r.unavailable.length) notes.push(`Indisponível agora: ${r.unavailable.join(', ')}.`);
    if (r.priceChanged.length) notes.push(`Preço atualizado: ${r.priceChanged.map(c => `${c.name} ${formatBRL(c.now)}`).join(', ')}.`);
    showToast({
      type: r.unavailable.length ? 'warning' : 'success',
      title: 'Itens na sacola',
      message: notes.length ? notes.join(' ') : 'Os itens do pedido foram adicionados à sua sacola.',
    });
  }, [storeData, showToast, setNavTab]);

  useEffect(() => {
    if (navTab === 'orders') {
      loadCustomerOrders();
      // Acompanhamento ao vivo: recarrega a cada 8 s enquanto a aba Pedidos está aberta e visível,
      // e imediatamente ao voltar para o app (aba/PWA em primeiro plano).
      const interval = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        loadCustomerOrders({ silent: true });
      }, 8000);
      const onVisible = () => {
        if (document.visibilityState === 'visible') loadCustomerOrders({ silent: true });
      };
      document.addEventListener('visibilitychange', onVisible);
      // 19/10: Supabase Realtime (public.orders na publicação supabase_realtime; RLS filtra os eventos).
      // Cada mudança do pedido recarrega em ~0,4 s; o polling acima continua como reserva.
      let rtTimer: ReturnType<typeof setTimeout> | null = null;
      const unsubscribeRealtime = storeData?.tenant.id && supabaseUser?.id
        ? orderRepository.subscribeToCustomerOrders(storeData.tenant.id, () => {
            if (rtTimer) clearTimeout(rtTimer);
            rtTimer = setTimeout(() => loadCustomerOrders({ silent: true }), 400);
          })
        : () => {};
      return () => {
        clearInterval(interval);
        document.removeEventListener('visibilitychange', onVisible);
        if (rtTimer) clearTimeout(rtTimer);
        unsubscribeRealtime();
      };
    }
  }, [navTab, loadCustomerOrders, storeData?.tenant.id, supabaseUser?.id]);

  // Favoritos, endereço selecionado e leitura de notificações: por usuário (e por loja quando aplicável).
  useEffect(() => {
    if (!storeData?.tenant.id) return;
    setFavoriteIds(loadFavorites(kv, userKey, storeData.tenant.id));
    setNotificationsSeenAt(loadNotificationsSeenAt(kv, userKey, storeData.tenant.id));
  }, [kv, userKey, storeData?.tenant.id]);

  const applySavedAddress = useCallback((a: SavedAddress) => {
    setSelectedAddress(a);
    setStreetAddress(a.street);
    setAddressNumber(a.number);
    setNeighborhood(a.neighborhood || '');
    setCity(a.city || '');
    setState(a.state || '');
    setPostalCode(a.postalCode || '');
    setComplement(a.complement || '');
    setReference(a.reference || '');
    setFormattedAddress(a.formattedAddress || '');
    setLatitude(a.latitude);
    setLongitude(a.longitude);
    setPlaceId(a.placeId);
  }, []);

  useEffect(() => {
    const b = loadAddressBook(kv, userKey);
    const sel = b.items.find(a => a.id === b.selectedId) || null;
    if (sel) applySavedAddress(sel);
    else setSelectedAddress(null);
  }, [kv, userKey, applySavedAddress]);

  // Cliente logado: carrega os pedidos uma vez (silencioso) para a central de notificações e o ponto no Perfil.
  useEffect(() => {
    if (supabaseUser?.id && storeData?.tenant.id) loadCustomerOrders({ silent: true });
  }, [supabaseUser?.id, storeData?.tenant.id, loadCustomerOrders]);

  // Aviso do aparelho quando o status de um pedido muda com o app aberto (se o cliente permitiu).
  const lastStatusRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const prev = lastStatusRef.current;
    const next = new Map(customerOrders.map(o => [o.id, o.status as string]));
    lastStatusRef.current = next;
    if (!prev || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!loadNotificationPrefs(kv, userKey).orderStatus) return;
    for (const o of customerOrders) {
      const before = prev.get(o.id);
      if (before && before !== o.status) {
        const n = buildNotifications([{ ...o, statusHistory: [{ status: o.status, timestamp: new Date().toISOString(), changedBy: '' }] }], 0)[0];
        if (!n) continue;
        try {
          const title = `${storeData?.tenant.name || 'Pedido'}: ${n.title}`;
          if (navigator.serviceWorker?.controller) navigator.serviceWorker.ready.then(r => r.showNotification(title, { body: n.body, tag: n.id })).catch(() => {});
          else new Notification(title, { body: n.body, tag: n.id });
        } catch {
          // navegador sem suporte
        }
      }
    }
  }, [customerOrders, kv, userKey, storeData?.tenant.name]);

  const notifications = useMemo(() => buildNotifications(customerOrders, notificationsSeenAt), [customerOrders, notificationsSeenAt]);
  const unreadCount = notifications.filter(n => n.unread).length;
  const markAllNotificationsSeen = useCallback(() => {
    if (!storeData?.tenant.id) return;
    const at = Date.now();
    markNotificationsSeen(kv, userKey, storeData.tenant.id, at);
    setNotificationsSeenAt(at);
  }, [kv, userKey, storeData?.tenant.id]);

  // Convite suave para ativar notificações: na aba Pedidos (logado), nunca durante o checkout. Respeita 7 dias.
  useEffect(() => {
    if (navTab !== 'orders' || !supabaseUser || isCheckoutOpen || completedOrder) return;
    const perm = typeof Notification !== 'undefined' ? Notification.permission : null;
    if (!shouldShowPushPrompt(kv, perm)) return;
    const t = setTimeout(() => setPushPromptOpen(true), 1500);
    return () => clearTimeout(t);
  }, [navTab, supabaseUser, isCheckoutOpen, completedOrder, kv]);

  // Mantém a URL coerente com a aba (#pedidos) sem criar entradas no histórico.
  useEffect(() => {
    try {
      const next = trackingUrlFor(window.location.href, navTab === 'orders');
      if (next) window.history.replaceState(window.history.state, '', next);
    } catch {
      // ambientes sem history
    }
    if (navTab !== 'orders') setFocusOrderId(null);
  }, [navTab]);

  // Pedido do deep link: rola até o cartão quando ele aparecer na lista.
  useEffect(() => {
    if (navTab !== 'orders' || !focusOrderId) return;
    if (!customerOrders.some(o => o.id === focusOrderId)) return;
    const el = document.getElementById(`pedido-${focusOrderId}`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [navTab, focusOrderId, customerOrders]);

  // Tema visual dinâmico do estabelecimento
  const theme: Partial<TenantTheme> = storeData?.theme || {
    primaryColor: '#15803d',
    secondaryColor: '#166534',
    backgroundColor: '#f8fafc',
    cardColor: '#ffffff',
    buttonColor: '#15803d',
    textColor: '#0f172a',
    borderRadius: '1rem',
    fontFamily: 'Inter',
    storeName: '',
    tagline: '',
  };

  const primaryColor = theme.primaryColor || '#15803d';
  const buttonColor = theme.buttonColor || primaryColor;
  const borderRadius = theme.borderRadius || '1rem';

  // --------------------------------------------------------------------------
  // CÁLCULOS DO CARRINHO
  // --------------------------------------------------------------------------
  const cartTotalCount = cart.reduce((acc, item) => acc + item.quantity, 0);

  // Preço de cada linha conforme a ORIGEM da compra (catálogo => preço do produto; campanha => preço do item
  // de campanha selecionado, se válido). Nunca o menor preço entre fontes. O servidor revalida tudo.
  const campaignsForPricing = storeData?.promotionCarousels || [];
  const tenantIdForPricing = storeData?.tenant.id || '';
  const priceCartItem = (item: CartItem) => {
    const r = priceLineByOrigin({ product: item.product, quantity: item.quantity, origin: item.origin, campaigns: campaignsForPricing, tenantId: tenantIdForPricing });
    // Linha de campanha inválida é convertida pelo efeito de revalidação; até lá, exibe preço de catálogo.
    return r.ok ? r.line : productToPricingLine(item.product, item.quantity);
  };
  const pricedLines = cart.map(priceCartItem);
  const subtotal = pricedLines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);

  // Revalida linhas de campanha (expirada/inativa/outra loja): converte para catálogo e avisa o cliente.
  useEffect(() => {
    if (!storeData || cart.length === 0) return;
    const { cart: next, converted } = revalidateOriginCart<Product>(cart, storeData.promotionCarousels || [], storeData.tenant.id);
    if (converted.length > 0) {
      setCart(next as CartItem[]);
      const names = converted.map((c) => {
        const p = storeData.products.find((x) => x.id === c.productId);
        return `"${p?.name || 'produto'}" (${CAMPAIGN_REASON_TEXT[c.reason]})`;
      });
      showToast({
        type: 'warning',
        title: 'Oferta indisponível',
        message: `${names.join(', ')}: o item segue na sacola pelo preço normal do catálogo.`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, storeData]);

  // Recalcular desconto de cupom quando o subtotal do carrinho mudar
  useEffect(() => {
    if (!appliedCoupon) {
      setCouponDiscount(0);
      return;
    }
    if (subtotal <= 0) {
      setAppliedCoupon(null);
      setCouponDiscount(0);
      setCouponMessage(null);
      return;
    }
    if (appliedCoupon.minOrderValue && subtotal < appliedCoupon.minOrderValue) {
      setAppliedCoupon(null);
      setCouponDiscount(0);
      setCouponMessage({
        type: 'error',
        text: `O cupom ${appliedCoupon.code} requer pedido mínimo de ${formatBRL(appliedCoupon.minOrderValue)}.`,
      });
      return;
    }
    if (appliedCoupon.discountType === 'PERCENTAGE') {
      const disc = Number(((subtotal * appliedCoupon.discountValue) / 100).toFixed(2));
      setCouponDiscount(disc);
    } else {
      const disc = Math.min(subtotal, Number(appliedCoupon.discountValue.toFixed(2)));
      setCouponDiscount(disc);
    }
  }, [subtotal, appliedCoupon]);

  const handleApplyCoupon = async () => {
    if (!storeData?.tenant.id) return;
    const clean = couponCodeInput.trim().toUpperCase();
    if (!clean) {
      setCouponMessage({ type: 'error', text: 'Digite o código do cupom.' });
      return;
    }
    setCouponLoading(true);
    setCouponMessage(null);
    try {
      // Prévia no servidor (validate_coupon); o consumo é atômico dentro do checkout (N2).
      const res = await promotionRepository.validatePublicCoupon(
        storeData.tenant.slug,
        clean,
        cart.map(item => ({ productId: item.product.id, quantity: item.quantity }))
      );
      if (res.isValid && res.coupon) {
        setAppliedCoupon(res.coupon);
        setCouponDiscount(res.discountAmount);
        setCouponMessage({ type: 'success', text: res.message });
        showToast({ type: 'success', title: 'Cupom Aplicado', message: res.message });
      } else {
        setAppliedCoupon(null);
        setCouponDiscount(0);
        setCouponMessage({ type: 'error', text: res.message });
      }
    } catch (err: any) {
      setCouponMessage({ type: 'error', text: err.message || 'Erro ao validar cupom.' });
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponDiscount(0);
    setCouponCodeInput('');
    setCouponMessage(null);
  };

  // Modalidade + desconto de retirada + cupom + taxa: fonte única em lib/pricing/fulfillmentPricing.
  // Apenas EXIBIÇÃO; o servidor recalcula tudo (o navegador envia só itens, quantidades e modalidade).
  const fulfillmentSettings = fulfillmentSettingsFromTenant(storeData?.settings);
  const availableModes = resolveAvailableModes(fulfillmentSettings);
  const pricing = computeFulfillmentPricing({
    mode: fulfillmentType,
    lines: pricedLines,
    settings: fulfillmentSettings,
    coupon: appliedCoupon
      ? { code: appliedCoupon.code, discountType: appliedCoupon.discountType, discountValue: appliedCoupon.discountValue, minOrderValue: appliedCoupon.minOrderValue, stackWithPickupDiscount: appliedCoupon.stackWithPickupDiscount }
      : null,
  });
  const couponDiscount = pricing.couponDiscount;
  const pickupDiscount = pricing.pickupDiscount;
  const deliveryFee = pricing.deliveryFee;
  const grandTotal = pricing.total;
  const cashChangeInfo = computeCashChange(cashChange, grandTotal);
  const modeKey = availableModes.modes.join(',');

  useEffect(() => {
    if (availableModes.modes.length > 0 && !availableModes.modes.includes(fulfillmentType)) {
      setFulfillmentType(availableModes.modes[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey]);

  // Chave de idempotência por tentativa de checkout (renovada após pedido concluído).
  const checkoutIdempotencyKeyRef = useRef<string>(newIdempotencyKey());

  // Normalização de telefone / WhatsApp com máscara brasileira
  const handlePhoneChange = (val: string) => {
    setCustomerPhone(formatBRPhone(val));
  };

  // Manipulação de Carrinho
  const handleAddToCart = (product: Product, origin: PurchaseOrigin = CATALOG_ORIGIN, opts?: { silent?: boolean }) => {
    const isAvailable = product.isAvailable !== undefined ? product.isAvailable : (product.stockQuantity > 0);
    if (!isAvailable) {
      showToast({
        type: 'warning',
        title: 'Produto Esgotado',
        message: `O item "${product.name}" está temporariamente indisponível.`,
      });
      return;
    }

    // Sempre guarda o produto CANÔNICO do catálogo (o preço da campanha vem da origem, nunca de um produto alterado).
    const canonical = storeData?.products.find((x) => x.id === product.id && x.tenantId === storeData.tenant.id) || product;
    // Mesmo produto de origens diferentes = linhas diferentes (não mescla catálogo com campanha).
    setCart((prev) => addToOriginCart<Product>(prev, canonical, origin) as CartItem[]);

    if (opts?.silent) return;
    showToast({
      type: 'success',
      title: 'Adicionado à Sacola',
      message: `${product.name} adicionado com sucesso.`,
    });
  };

  // Remove/decrementa pela CHAVE da linha (produto + origem); a origem nunca se perde ao mudar a quantidade.
  const handleRemoveFromCart = (lineKey: string) => {
    setCart((prev) => decrementOriginCart<Product>(prev, lineKey) as CartItem[]);
  };

  const qtyOfCatalog = (productId: string) => cart.find(i => i.key === cartLineKey(productId, CATALOG_ORIGIN))?.quantity || 0;
  const qtyOfOffer = (it: OfferListItem) => cart.find(i => i.key === cartLineKey(it.product.id, it.origin))?.quantity || 0;
  const handleIncLine = (lineKey: string) => {
    const line = cart.find(l => l.key === lineKey);
    if (line) handleAddToCart(line.product, line.origin, { silent: true });
  };
  const handleRemoveLineEntirely = (lineKey: string) => {
    setCart(prev => prev.filter(l => l.key !== lineKey));
    showToast({ type: 'success', title: 'Item removido da sacola' });
  };
  const handleLineNote = (lineKey: string, note: string) => {
    setCart(prev => prev.map(l => (l.key === lineKey ? { ...l, notes: note || undefined } : l)));
  };
  const handleToggleFavorite = (productId: string) => {
    if (!storeData) return;
    const next = toggleFavorite(kv, userKey, storeData.tenant.id, productId);
    setFavoriteIds(next);
    showToast({ type: 'success', title: next.includes(productId) ? 'Adicionado aos favoritos' : 'Removido dos favoritos' });
  };
  const loadMyCpf = useCallback(async () => {
    if (!storeData?.tenant.id || !supabaseUser?.id) return null;
    return customerAppRepository.getMyCpf(storeData.tenant.id, supabaseUser.id);
  }, [storeData?.tenant.id, supabaseUser?.id]);

  const handleSaveProfile = useCallback(async (d: { name: string; phone: string; cpf: string }) => {
    if (!storeData || !supabaseUser) return;
    const digits = d.phone.trim() ? normalizeBRPhone(d.phone) : '';
    setCustomerName(d.name);
    if (digits) setCustomerPhone(formatBRPhone(digits));
    try {
      localStorage.setItem('adegafood_cust_name', d.name);
      if (digits) localStorage.setItem('adegafood_cust_phone', formatBRPhone(digits));
    } catch { /* ignore */ }
    try {
      const r = await customerAppRepository.updateMyProfile(storeData.tenant.id, supabaseUser.id, { name: d.name, phone: digits ? `+55${digits}` : '', cpf: d.cpf || null });
      showToast(r === 'server'
        ? { type: 'success', title: 'Dados salvos', message: 'Seus dados foram atualizados.' }
        : r === 'no_customer'
          ? { type: 'success', title: 'Dados salvos', message: 'Vamos usar estes dados no seu próximo pedido nesta loja.' }
          : { type: 'success', title: 'Dados salvos', message: d.cpf ? 'Nome e telefone atualizados. O CPF será gravado assim que a atualização do sistema for concluída.' : 'Seus dados foram atualizados.' });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Não foi possível salvar', message: e?.message || 'Tente novamente.' });
    }
  }, [storeData, supabaseUser, showToast]);

  const handleRequestDeletion = useCallback(async (reason: string) => {
    const r = await customerAppRepository.requestAccountDeletion(reason);
    if (r.ok) {
      showToast({ type: 'success', title: 'Solicitação registrada', message: 'Seus dados pessoais serão anonimizados. Você foi desconectado.' });
      await signOut();
      setProfilePage('menu');
      return { ok: true };
    }
    return { ok: false, message: r.message };
  }, [showToast, signOut]);

  const openProductFromList = (p: Product, o: PurchaseOrigin = CATALOG_ORIGIN) => {
    setSelectedProductOrigin(o);
    setSelectedProductModal(o.source === 'campaign' ? p : (storeData?.products.find(x => x.id === p.id) || p));
  };

  // --------------------------------------------------------------------------
  // NAVEGAÇÃO E SELEÇÃO DE PRODUTO (OFERTAS & LINKS INTERNOS)
  // --------------------------------------------------------------------------
  const handleSelectProduct = useCallback((targetProductId: string) => {
    if (!storeData) return;

    // Validação estrita de segurança: o produto DEVE pertencer ao mesmo tenant da vitrine
    const product = storeData.products.find(
      p => p.id === targetProductId && p.tenantId === storeData.tenant.id
    );

    if (!product) {
      console.warn(`[ClientApp] Produto ${targetProductId} não encontrado ou não pertence a este estabelecimento.`);
      return;
    }

    if (!product.isActive) {
      console.warn(`[ClientApp] Produto ${targetProductId} está inativo.`);
      return;
    }

    // 1. Abre o modal com os dados detalhados do produto (origem: catálogo)
    setSelectedProductOrigin(CATALOG_ORIGIN);
    setSelectedProductModal(product);

    // 2. Garante que o card esteja acessível na vitrine (limpa busca e ajusta filtro de categoria)
    setSearchTerm('');
    if (activeCategory !== 'ALL' && activeCategory !== product.categoryId) {
      setActiveCategory(product.categoryId);
    }

    // 3. Aplica destaque visual e rolagem suave até o card correspondente
    setHighlightedProductId(product.id);
    setTimeout(() => {
      const el = document.getElementById(`product-${product.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);

    // 4. Desativa o anel de destaque após 4 segundos
    setTimeout(() => {
      setHighlightedProductId(prev => prev === product.id ? null : prev);
    }, 4000);
  }, [storeData, activeCategory]);

  const handleOfferClick = useCallback((offer: Offer) => {
    // Validação de segurança: a oferta deve pertencer exatamente ao tenant atual
    if (offer.tenantId !== storeData?.tenant.id) {
      console.warn(`[ClientApp] Oferta recusada por segurança: tenant mismatch (${offer.tenantId} != ${storeData?.tenant.id})`);
      return;
    }

    // N5 (somente n1n6): clique no card como evento de funil (estimativa; best-effort).
    if (storeData?.tenant.slug) {
      void campaignRepository.trackEvent({
        storeSlug: storeData.tenant.slug,
        eventType: 'CARD_CLICK',
        sessionId: getCampaignSessionId(),
        campaignId: offer.campaignId,
        cardId: offer.campaignCardId,
        offerId: offer.source === 'CAMPAIGN_CARD' ? undefined : offer.id,
      });
    }

    // MODO 1: APENAS VISUAL (Sem abrir produto nem checkout)
    if (offer.destinationType === 'BANNER_ONLY' && !offer.productId && !offer.hasPromoCheckout) {
      if (offer.linkUrl && offer.linkUrl.startsWith('http')) {
        window.open(offer.linkUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    // MODO 3: CHECKOUT PROMOCIONAL PRÓPRIO (Fluxo Direto de Oferta)
    if (offer.destinationType === 'CUSTOM_OFFER' || offer.hasPromoCheckout) {
      setSelectedPromoOffer(offer);
      setIsPromoCheckoutOpen(true);
      return;
    }

    // MODO 2: PRODUTO DO CATÁLOGO
    let targetProductId = offer.productId;

    // Fallback: extrai do internalLink (?product=UUID) se necessário
    if (!targetProductId && offer.internalLink) {
      const match = offer.internalLink.match(/[?&]product=([a-f0-9-]+)/i);
      if (match && match[1]) {
        targetProductId = match[1];
      }
    }

    if (targetProductId) {
      // Atualiza URL com o productId preservando histórico limpo
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('product', targetProductId);
        window.history.replaceState({}, '', url.toString());
      } catch {
        // Ignora em ambientes restritos
      }

      handleSelectProduct(targetProductId);
    }
  }, [storeData, handleSelectProduct]);

  const handleCloseProductModal = useCallback(() => {
    setSelectedProductModal(null);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('product')) {
        url.searchParams.delete('product');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // Ignora em ambientes restritos
    }
  }, []);

  // Leitura automática do query param ?product={productId} ao carregar a loja
  useEffect(() => {
    if (!storeData) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const queryProductId = params.get('product');
      if (queryProductId) {
        handleSelectProduct(queryProductId);
      }
    } catch {
      // Ignora erro de parsing em ambientes sem window
    }
  }, [storeData, handleSelectProduct]);

  // Filtragem de Produtos
  const filteredProducts = useMemo(() => {
    if (!storeData) return [];
    // Busca sem acento/maiúsculas por nome, descrição e categoria (mesma regra da aba Busca).
    const base = searchTerm.trim() ? searchProducts(storeData.products, storeData.categories, searchTerm) : storeData.products;
    return base.filter(p => activeCategory === 'ALL' || p.categoryId === activeCategory);
  }, [storeData, activeCategory, searchTerm]);

  // --------------------------------------------------------------------------
  // AUTENTICAÇÃO DO CLIENTE (GOOGLE OU E-MAIL)
  // --------------------------------------------------------------------------
  const handleGoogleLogin = async () => {
    setIsGoogleAuthenticating(true);
    try {
      if (isSupabaseConfigured) {
        await signInWithGoogle({ returnTo: `/app/${slug}`, intent: 'customer' });
      } else {
        showToast({
          type: 'info',
          title: 'Modo Offline / Demonstração',
          message: 'Autenticação simulada no ambiente de testes.',
        });
        setIsAuthModalOpen(false);
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Falha no login com Google',
        message: err.message || 'Não foi possível autenticar com o Google.',
      });
    } finally {
      setIsGoogleAuthenticating(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim() || !authPassword.trim()) {
      showToast({ type: 'warning', title: 'Dados Incompletos', message: 'Preencha e-mail e senha.' });
      return;
    }

    setIsAuthenticating(true);
    try {
      if (authMode === 'login') {
        const res = await signInWithPassword(authEmail.trim(), authPassword);
        if (!res.success && res.code === 'EMAIL_NOT_CONFIRMED') {
          // Não é erro: aviso amigável e persistente com opção de reenviar o link.
          setAuthNotice({ email: authEmail.trim(), kind: 'unconfirmed' });
          return;
        }
        if (!res.success) throw new Error(res.error || 'Credenciais inválidas.');
        setAuthNotice(null);
        showToast({ type: 'success', title: 'Login realizado!', message: 'Você está conectado como cliente.' });
        setIsAuthModalOpen(false);
      } else {
        if (!authName.trim()) {
          showToast({ type: 'warning', title: 'Nome obrigatório', message: 'Informe seu nome completo.' });
          setIsAuthenticating(false);
          return;
        }
        const phoneDigits = authPhone.trim() ? normalizeBRPhone(authPhone) : '';
        if (phoneDigits === null) {
          showToast({ type: 'warning', title: 'WhatsApp inválido', message: 'Informe DDD + número (10 ou 11 dígitos) ou deixe em branco.' });
          setIsAuthenticating(false);
          return;
        }
        const res = await signUp(authEmail.trim(), authPassword, authName.trim(), phoneDigits ? `+55${phoneDigits}` : undefined, { user_type: 'customer' });
        if (!res.success) throw new Error(res.error || 'Falha ao criar conta.');
        setCustomerName(authName.trim());
        if (phoneDigits) setCustomerPhone(formatBRPhone(phoneDigits));
        if (res.requiresEmailConfirmation) {
          // Mantém o aviso visível no modal/checkout até o cliente confirmar (não fecha em silêncio).
          setAuthNotice({ email: authEmail.trim(), kind: 'signup' });
          setAuthPassword('');
          return;
        }
        setAuthNotice(null);
        showToast({ type: 'success', title: 'Conta criada!', message: 'Sua conta de cliente foi criada com sucesso.' });
        setIsAuthModalOpen(false);
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro na autenticação',
        message: err.message || 'Verifique suas credenciais e tente novamente.',
      });
    } finally {
      setIsAuthenticating(false);
    }
  };

  // --------------------------------------------------------------------------
  // FINALIZAR PEDIDO (CHECKOUT COM SUPABASE E ATOMICIDADE REAL)
  // --------------------------------------------------------------------------
  const handleFinishOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeData) return;
    if (isSubmittingOrder) return; // Proteção estrita contra múltiplos envios simultâneos

    // REGRA FUNDAMENTAL: NÃO EXISTE CHECKOUT ANÔNIMO
    if (!supabaseUser) {
      setIsAuthModalOpen(true);
      showToast({
        type: 'warning',
        title: 'Identificação Necessária',
        message: 'Para sua segurança e acompanhamento, entre ou crie sua conta de cliente para finalizar.',
      });
      return;
    }

    if (!customerName.trim()) {
      showToast({
        type: 'warning',
        title: 'Nome Obrigatório',
        message: 'Por favor, informe seu nome completo.',
      });
      return;
    }

    const cleanPhone = normalizeBRPhone(customerPhone) || '';
    if (!cleanPhone) {
      showToast({
        type: 'warning',
        title: 'WhatsApp Inválido',
        message: 'Por favor, informe um número de WhatsApp válido com DDD (ex: 11 98765-4321).',
      });
      return;
    }

    if (!availableModes.modes.includes(fulfillmentType)) {
      showToast({
        type: 'error',
        title: 'Modalidade Indisponível',
        message: availableModes.blockedReason || 'A modalidade escolhida não está disponível neste estabelecimento.',
      });
      return;
    }

    if (fulfillmentType === 'DELIVERY') {
      if (!streetAddress.trim() || !addressNumber.trim()) {
        showToast({
          type: 'warning',
          title: 'Endereço Incompleto',
          message: 'Rua e número são obrigatórios para a entrega em domicílio.',
        });
        return;
      }
    }

    const minOrder = storeData.settings.minOrderValue || 0;
    if (minOrder > 0 && subtotal < minOrder) {
      showToast({
        type: 'warning',
        title: 'Pedido Mínimo',
        message: `O valor mínimo deste estabelecimento é de ${formatBRL(minOrder)}.`,
      });
      return;
    }

    // Persistir dados do cliente no LocalStorage para conveniência
    try {
      localStorage.setItem('adegafood_cust_name', customerName);
      localStorage.setItem('adegafood_cust_phone', customerPhone);
      if (streetAddress) localStorage.setItem('adegafood_cust_street', streetAddress);
      if (addressNumber) localStorage.setItem('adegafood_cust_number', addressNumber);
      if (neighborhood) localStorage.setItem('adegafood_cust_neighborhood', neighborhood);
    } catch {
      // ignore
    }

    const fullDeliveryAddress = fulfillmentType === 'DELIVERY'
      ? `${streetAddress}, ${addressNumber}${neighborhood ? ` - ${neighborhood}` : ''}${city ? `, ${city}` : ''}${complement ? ` (${complement})` : ''}`
      : `Retirada no Balcão: ${storeData.settings.address}`;

    // Troco: validado e gravado na observação do pedido (orders.notes), visível para a loja e o entregador.
    const cashInfo = paymentMethod === 'CASH' ? computeCashChange(cashChange, grandTotal) : ({ status: 'none' } as const);
    if (cashInfo.status === 'insufficient' || cashInfo.status === 'invalid') {
      showToast({
        type: 'warning',
        title: 'Confira o troco',
        message: cashInfo.status === 'insufficient'
          ? `O valor para troco (${formatBRL(cashInfo.amount)}) é menor que o total (${formatBRL(cashInfo.total)}). Corrija ou deixe em branco.`
          : 'Informe um valor válido para o troco (ex.: 50,00) ou deixe em branco.',
      });
      return;
    }
    const cashText = cashChangeLabel(cashInfo);
    const notesWithCash = cashText
      ? `${orderNotes ? `${orderNotes} | ` : ''}${cashText}`
      : orderNotes;

    const finalNotes = appliedCoupon && couponDiscount > 0
      ? `${notesWithCash ? `${notesWithCash} | ` : ''}[Cupom: ${appliedCoupon.code} -${formatBRL(couponDiscount)}]`
      : notesWithCash;

    setIsSubmittingOrder(true);
    setCartAdjustNotice(null);

    try {
      const order = await orderService.createPublic(storeData.tenant.slug, {
        customerName: customerName.trim(),
        customerPhone: `+55${cleanPhone}`,
        customerEmail: supabaseUser.email || undefined,
        deliveryAddress: fullDeliveryAddress,
        addressDetails: {
          street: streetAddress,
          number: addressNumber,
          complement: complement || undefined,
          neighborhood: neighborhood || '',
          city: city || 'São Paulo',
          state: state || 'SP',
          cep: postalCode || undefined,
          reference: reference || undefined,
          formattedAddress: formattedAddress || undefined,
          latitude,
          longitude,
          placeId,
        },
        paymentMethod,
        fulfillmentType,
        notes: finalNotes,
        origin,
        idempotencyKey: checkoutIdempotencyKeyRef.current,
        couponCode: appliedCoupon && couponDiscount > 0 ? appliedCoupon.code : undefined,
        // Sem preço: só produto, quantidade, observação e (para itens de campanha) a referência da origem.
        items: cart.map(item => toCheckoutItem(item)),
      });

      // O cupom é consumido pelo servidor dentro do checkout (sem resgate pelo navegador).
      setCompletedCouponRedemption(null);

      // Limpar carrinho e exibir confirmação
      setCompletedOrder(order);
      checkoutIdempotencyKeyRef.current = newIdempotencyKey();
      setCart([]);
      setAppliedCoupon(null);
      setCouponDiscount(0);
      setCouponCodeInput('');
      setCouponMessage(null);
      setIsCheckoutOpen(false);

      // Atualiza imediatamente o estado de pedidos do cliente em memória (sem race condition)
      setCustomerOrders(prev => {
        const exists = prev.some(o => o.id === order.id);
        if (exists) return prev;
        return [order, ...prev];
      });

      showToast({
        type: 'success',
        title: 'Pedido Confirmado!',
        message: `Pedido #${order.orderNumber || order.id.slice(0, 6)} enviado para ${storeData.tenant.name} com sucesso!`,
      });
    } catch (err: any) {
      console.error('[ClientApp] Erro na criação do pedido:', err);
      if (err?.code === 'CAMPAIGN_SOURCE_UNAVAILABLE') {
        // Servidor sem preço de oferta no carrinho: converte as linhas de oferta para o catálogo (a sacola
        // continua válida) e mantém um aviso fixo no checkout até o cliente confirmar de novo.
        setCart(prev => prev.reduce<CartItem[]>((acc, l) => {
          const line: CartItem = l.origin.source === 'campaign'
            ? { ...l, key: cartLineKey(l.product.id, CATALOG_ORIGIN), origin: CATALOG_ORIGIN }
            : l;
          const ex = acc.find(x => x.key === line.key);
          return ex
            ? acc.map(x => (x.key === line.key ? { ...x, quantity: x.quantity + line.quantity } : x))
            : [...acc, line];
        }, []));
        setCartAdjustNotice(err.message || 'Ajustamos os itens de oferta da sua sacola para o preço normal. Confira os valores e confirme novamente.');
        return;
      }
      showToast({
        type: 'error',
        title: 'Não foi possível finalizar seu pedido',
        message: err.message || 'Ocorreu um erro no processamento. Tente novamente.',
      });
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  // legacy-020: não existe BR Code por pedido no servidor; exibimos só a chave PIX que a própria loja
  // publicou (get_public_store), para cópia manual. Nenhum código PIX é montado no navegador.
  const legacyStorePixKey = storeData?.settings?.pixKey?.trim() || '';
  const handleCopyPix = () => {
    if (!legacyStorePixKey) return;
    navigator.clipboard.writeText(legacyStorePixKey);
    setCopiedPix(true);
    showToast({
      type: 'success',
      title: 'Chave PIX copiada!',
      message: `Pague ${completedOrder ? formatBRL(completedOrder.totalAmount) : ''} no app do seu banco usando a chave da loja.`,
    });
    setTimeout(() => setCopiedPix(false), 3000);
  };

  const openWhatsAppContact = (orderNumber?: number, customText?: string) => {
    if (!storeData) return;
    const phone = storeData.settings.phoneWhatsApp || storeData.tenant.phone;
    const cleanPhone = brPhoneDigits(phone);
    if (!cleanPhone) {
      showToast({ type: 'warning', title: 'WhatsApp indisponível', message: 'Esta loja ainda não informou um WhatsApp.' });
      return;
    }
    const message = customText ? customText : orderNumber
      ? `Olá! Gostaria de informações sobre meu Pedido #${orderNumber} feito no app do ${storeData.tenant.name}.`
      : `Olá! Tenho uma dúvida sobre o cardápio do ${storeData.tenant.name}.`;
    window.open(`https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  // --------------------------------------------------------------------------
  // ESTADO DE CARREGAMENTO INICIAL DO CATÁLOGO
  // --------------------------------------------------------------------------
  if (isLoadingStore) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-700 flex items-center justify-center text-white font-black text-xl shadow-md animate-pulse mb-4">
          AF
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
          <span>Carregando cardápio oficial...</span>
        </div>
        <p className="text-xs text-gray-400 mt-1 font-medium font-mono">/app/{slug}</p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // ERRO TÉCNICO AO CARREGAR A VITRINE (não é "loja inexistente")
  // --------------------------------------------------------------------------
  if (storeLoadError) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-gray-200 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <Store className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-950">Não foi possível carregar a vitrine</h2>
          <p className="text-xs text-gray-600 leading-relaxed">
            Ocorreu uma falha ao buscar o cardápio de <strong className="font-mono">/app/{slug}</strong>. Tente novamente em instantes.
          </p>
          <div className="pt-2">
            <Button
              className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
              onClick={() => {
                loadStore();
              }}
            >
              Tentar novamente
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // ESTADO 404: ESTABELECIMENTO NÃO ENCONTRADO (SEM FALLBACK MOCK)
  // --------------------------------------------------------------------------
  if (storeNotFound || !storeData) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-gray-200 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
            <Store className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-950">Estabelecimento Não Encontrado</h2>
          <p className="text-xs text-gray-600 leading-relaxed">
            Não encontramos nenhum estabelecimento ativo correspondente ao endereço: <br />
            <strong className="text-gray-900 font-mono text-sm">/app/{slug}</strong>
          </p>
          <p className="text-[11px] text-gray-400">
            Verifique se o link ou QR Code foi gerado corretamente para este estabelecimento comercial.
          </p>
          <div className="pt-2 flex flex-col sm:flex-row gap-2">
            <Button
              className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
              onClick={() => {
                window.location.href = '/app/adega-premium';
              }}
            >
              Abrir Catálogo Modelo
            </Button>
            <Button
              variant="outline"
              className="flex-1 cursor-pointer border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              Voltar ao Painel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const orderStoreName = storeDisplayName(theme.storeName, storeData.tenant.name);
  const renderOrderCard = (order: Order) => {
    const timeline = buildCustomerTimeline(order);
    const isDelivered = timeline.delivered;
    const isCancelled = timeline.cancelled;
    const isPending = order.status === 'PENDING';
    const isDelivery = !isCancelled && !isDelivered && (order.status === 'OUT_FOR_DELIVERY' || order.status === 'READY' || order.status === 'WAITING_FOR_DRIVER');
    const isPreparing = !isCancelled && !isDelivered && !isPending && !isDelivery;
    const isFocused = focusOrderId === order.id;

    return (
      <div 
        key={order.id} 
        id={`pedido-${order.id}`}
        className={`p-4 sm:p-5 bg-white rounded-3xl border shadow-xs hover:shadow-md transition-all space-y-4 ${isFocused ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-gray-200/90'}`}
      >
        {/* 19/10: loja do pedido sempre explícita (o histórico é por loja; evita confundir lojas). */}
        <div className="flex items-center gap-2 min-w-0" data-testid="order-store">
          <StoreLogo logoUrl={theme.logoUrl} name={orderStoreName} color={primaryColor} className="w-6 h-6 text-[10px] shrink-0" />
          <span className="text-xs font-bold text-gray-700 truncate">{orderStoreName}</span>
        </div>
        <DeliveryCodeCard orderId={order.id} status={order.status} />
        <PickupArrivalCard orderId={order.id} status={order.status} fulfillmentType={order.fulfillmentType} />
        {/* TOPO: NÚMERO DO PEDIDO + DATA + TOTAL EM DESTAQUE */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <ShoppingBag className="w-4 h-4 text-emerald-700 shrink-0" />
              <span className="font-black text-base text-gray-900 font-mono">
                Pedido #{order.orderNumber || order.id.slice(0, 6)}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 font-mono mt-0.5">
              {new Date(order.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          </div>

          <div className="text-right">
            <span className="inline-block px-3 py-1 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-800 font-mono font-black text-base">
              {formatBRL(order.totalAmount)}
            </span>
          </div>
        </div>

        {/* STATUS BADGES & ATENDIMENTO */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`px-2.5 py-1 rounded-lg font-mono font-bold text-[11px] uppercase border flex items-center gap-1.5 ${
            isPending ? 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse' :
            isPreparing ? 'bg-blue-50 text-blue-800 border-blue-200' :
            isDelivery ? 'bg-purple-50 text-purple-800 border-purple-200' :
            isDelivered ? 'bg-emerald-100 text-emerald-900 border-emerald-300' :
            'bg-rose-50 text-rose-800 border-rose-200'
          }`}>
            {isPending && <Clock className="w-3 h-3 text-amber-600 animate-spin" />}
            {isPreparing && <Clock className="w-3 h-3 text-blue-600 animate-spin" />}
            {isDelivery && <Bike className="w-3 h-3 text-purple-600" />}
            {isDelivered && <CheckCircle2 className="w-3 h-3 text-emerald-700" />}
            {isCancelled && <AlertCircle className="w-3 h-3 text-rose-700" />}
            <span>
              {order.status === 'PREPARING' && timeline.current?.key === 'preparing'
                ? `Em preparo (${order.prepTimeMinutes || storeData.settings.defaultPrepTimeMinutes || 30} min)`
                : timeline.headline}
            </span>
          </span>

          <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 font-mono font-bold text-[10px] uppercase border border-gray-200">
            {order.fulfillmentType === 'PICKUP' ? '🛍️ Retirada no Balcão' : '🛵 Entrega Delivery'}
          </span>

          <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 font-mono font-bold text-[10px] uppercase border border-emerald-200">
            {paymentMethodLabel(order.paymentMethod)}
          </span>
        </div>

        {/* MAPA AO VIVO DO MOTOBOY (só em rota; para sozinho em DELIVERED/CANCELLED) */}
        {isLiveTrackable(order) && (
          <LiveDriverTracking
            orderId={order.id}
            status={order.status}
            destination={order.addressDetails}
            destinationLabel={order.deliveryAddress}
            accentColor={buttonColor}
          />
        )}

        {/* LINHA DO TEMPO COMPLETA (atualiza ao vivo pelo polling da aba Pedidos) */}
        {!isCancelled ? (
          <OrderTrackingTimeline timeline={timeline} accentColor={buttonColor} />
        ) : (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-800 font-bold">
            Pedido cancelado{timeline.cancelledAt ? ` às ${new Date(timeline.cancelledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}.
          </div>
        )}

        {/* LISTA DE ITENS DO PEDIDO */}
        <div className="bg-gray-50/70 border border-gray-200/60 rounded-2xl p-3 space-y-1.5 text-xs">
          <div className="flex justify-between items-center text-[10px] font-mono font-bold uppercase tracking-wider text-gray-400 pb-1 border-b border-gray-200/50">
            <span>Produtos ({order.items.length})</span>
            <span>Valor</span>
          </div>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {order.items.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center text-gray-800">
                <span className="truncate pr-2">
                  <strong className="text-emerald-700 font-mono mr-1.5">{item.quantity}x</strong>
                  {item.productName}
                </span>
                <span className="font-mono font-medium text-gray-700 shrink-0">
                  {formatBRL(item.totalPrice)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ENDEREÇO & AÇÕES OPERACIONAIS */}
        <div className="pt-1 border-t border-gray-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-1.5 text-gray-600 min-w-0">
            <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="truncate text-[11px] font-medium">
              {order.fulfillmentType === 'PICKUP' ? 'Retirada no Balcão do Estabelecimento' : order.deliveryAddress}
            </span>
          </div>

          <div className="grid grid-cols-3 sm:flex items-stretch sm:items-center gap-2 shrink-0 text-center">
            <button
              type="button"
              onClick={() => { setHelpOrder(order); setProfilePage('help'); setNavTab('profile'); }}
              className="flex-1 sm:flex-initial py-1.5 px-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              data-testid="order-help-btn"
            >
              <LifeBuoy className="w-3.5 h-3.5" />
              <span>Ajuda com este pedido</span>
            </button>

            <button
              type="button"
              onClick={() => openWhatsAppContact(order.orderNumber)}
              className="flex-1 sm:flex-initial py-1.5 px-3 rounded-xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/80 text-emerald-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
              <span>WhatsApp</span>
            </button>

            <button
              type="button"
              onClick={() => handleRepeatOrder(order)}
              className="flex-1 sm:flex-initial py-1.5 px-3 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Peça de novo</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="min-h-screen pb-44 font-sans text-gray-900 transition-colors"
      style={{ 
        backgroundColor: theme.backgroundColor || '#f8fafc',
        fontFamily: theme.fontFamily || 'Inter'
      }}
    >
      <InstallStoreAppHint
        tenantId={storeData.tenant.id}
        storeName={theme.storeName || storeData.tenant.name}
        color={theme.primaryColor || '#334155'}
        logoUrl={theme.logoUrl}
        hidden={isCheckoutOpen || isPromoCheckoutOpen || addressFlow.open || navTab === 'cart'}
        busy={pushPromptOpen}
        bottomOffset={installHintBottomOffset({ bottomNav: true, floatingCartBar: cart.length > 0 && !isCheckoutOpen && (navTab === 'home' || navTab === 'search' || navTab === 'offers') })}
      />
      {/* Barra de Retorno ao Painel: só para a equipe autenticada DESTE estabelecimento. */}
      {isStaffPreview(!!supabaseUser, activeTenant?.id, storeData.tenant.id) && (
      <div className="bg-slate-950 text-white text-xs px-3.5 py-2 flex items-center justify-between border-b border-slate-800 z-40 relative">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
          <span className="font-bold text-[11px] sm:text-xs text-white truncate">
            Vitrine do Cliente • Visualização em Tempo Real
          </span>
          <span className="text-[10px] text-slate-400 hidden sm:inline truncate">
            ({storeData.tenant.name})
          </span>
        </div>
        <button
          type="button"
          onClick={() => { window.location.href = '/'; }}
          className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 text-white font-bold text-[11px] transition-all cursor-pointer flex items-center gap-1.5 shrink-0 shadow-xs"
          title="Voltar ao Painel Administrativo"
        >
          <span>← Voltar ao Painel</span>
        </button>
      </div>
      )}

      {/* Top Header com Marca Oficial do Estabelecimento */}
      <div 
        className="sticky top-0 z-30 shadow-xs px-4 py-3 flex items-center justify-between border-b border-black/5 backdrop-blur-md"
        style={{ backgroundColor: `${theme.cardColor || '#ffffff'}f2` }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <StoreLogo logoUrl={theme.logoUrl} name={theme.storeName || storeData.tenant.name} color={primaryColor} />
          <div className="min-w-0">
            <h1 className="font-extrabold text-sm text-gray-900 truncate flex items-center gap-1.5">
              <span>{storeData.tenant.name}</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0" title="Aberto para pedidos" />
            </h1>
            <p className="text-[11px] text-gray-500 truncate flex items-center gap-1">
              <Clock className="w-3 h-3 text-gray-400" />
              <span>{storeData.settings.defaultPrepTimeMinutes ? `Preparo: ${storeData.settings.defaultPrepTimeMinutes} min` : (storeData.settings.estimatedDeliveryTime || 'Preparo: 30 min')}</span>
              <span>•</span>
              <span className="font-medium text-emerald-700">
                {storeDeliveryLabel(storeData.settings)}
              </span>
            </p>
          </div>
        </div>

        {/* Status de Login do Cliente / Botão de Acesso */}
        <div className="flex items-center gap-2">
          {supabaseUser ? (
            <button
              onClick={() => { setProfilePage('menu'); setNavTab('profile'); }}
              data-testid="header-profile"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 cursor-pointer transition-all"
            >
              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span className="max-w-[100px] truncate">{customerName || supabaseUser.email?.split('@')[0]}</span>
            </button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsAuthModalOpen(true)}
              className="text-xs h-8 px-2.5 rounded-xl cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5 mr-1" />
              Entrar
            </Button>
          )}
        </div>
      </div>

      {/* Visualização de Pedidos do Cliente */}
      {navTab === 'orders' ? (
        <div className="max-w-lg mx-auto p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <StoreLogo logoUrl={theme.logoUrl} name={orderStoreName} color={primaryColor} className="w-9 h-9 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-xl font-extrabold text-gray-900 truncate" data-testid="orders-title">{customerOrdersTitle(orderStoreName)}</h2>
                <p className="text-[11px] text-gray-500 leading-tight">{CUSTOMER_ORDERS_SCOPE_HINT}</p>
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setNavTab('home')} className="text-xs shrink-0">
              Ver cardápio
            </Button>
          </div>

          {!supabaseUser ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-gray-200 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <LogIn className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-gray-900 text-sm">Acesse sua Conta de Cliente</h3>
              <p className="text-xs text-gray-500">
                Entre com seu e-mail ou Google para acompanhar em tempo real o status dos seus pedidos.
              </p>
              <Button
                onClick={() => setIsAuthModalOpen(true)}
                className="w-full text-white font-bold"
                style={{ backgroundColor: buttonColor }}
              >
                Entrar ou Criar Conta
              </Button>
            </div>
          ) : isLoadingOrders && customerOrders.length === 0 ? (
            <SkeletonRows rows={3} />
          ) : customerOrdersError ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-amber-200/80 space-y-3 shadow-xs">
              <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-gray-900 text-sm">Não foi possível carregar seus pedidos</h3>
              <p className="text-xs text-gray-500 max-w-xs mx-auto">
                {customerOrdersError}
              </p>
              <Button
                size="sm"
                onClick={() => loadCustomerOrders()}
                disabled={isLoadingOrders}
                className="text-white font-bold text-xs"
                style={{ backgroundColor: buttonColor }}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoadingOrders ? 'animate-spin' : ''}`} />
                Tentar Novamente
              </Button>
            </div>
          ) : customerOrders.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-gray-200 space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-gray-900 text-sm">Nenhum pedido realizado nesta loja com esta conta.</h3>
              <p className="text-xs text-gray-500 max-w-xs mx-auto leading-relaxed">
                Você está conectado como <span className="font-semibold text-gray-700 font-mono">{supabaseUser.email}</span>. Se realizou a compra com outro e-mail, verifique sua conta.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setProfilePage('menu'); setNavTab('profile'); }}
                  className="w-full sm:w-auto text-xs"
                >
                  <UserIcon className="w-3.5 h-3.5 mr-1 text-slate-500" />
                  Verificar conta
                </Button>
                <Button
                  size="sm"
                  onClick={() => setNavTab('home')}
                  className="w-full sm:w-auto text-white font-bold text-xs"
                  style={{ backgroundColor: buttonColor }}
                >
                  Ver Cardápio
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {groupOrderHistory(customerOrders, nowTick).map(day => (
                <section key={day.dayKey} className="space-y-3" data-testid="orders-day">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-500 pt-1">{day.label}</h3>
                  {day.entries.map(entry => {
                    if (entry.kind === 'order') return <React.Fragment key={entry.order.id}>{renderOrderCard(entry.order)}</React.Fragment>;
                    const gk = entry.latest.id;
                    const open = Boolean(expandedFailedGroups[gk]);
                    return (
                      <div key={gk} className="bg-white rounded-3xl border border-rose-100 shadow-xs overflow-hidden" data-testid="failed-group">
                        <button type="button" onClick={() => setExpandedFailedGroups(m => ({ ...m, [gk]: !open }))}
                          className="w-full p-4 flex items-center gap-3 text-left cursor-pointer">
                          <span className="w-9 h-9 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center shrink-0"><AlertCircle className="w-5 h-5" /></span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-bold text-gray-900">{entry.orders.length} tentativas não concluídas</span>
                            <span className="block text-xs text-gray-500 truncate">
                              {entry.latest.items.map(it => `${it.quantity}x ${it.productName}`).join(', ')} · {formatBRL(entry.latest.totalAmount)}
                            </span>
                          </span>
                          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                        </button>
                        {open && (
                          <ul className="px-4 pb-3 space-y-1 text-xs text-gray-600 dc-fade-in">
                            {entry.orders.map(o => (
                              <li key={o.id} className="flex justify-between"><span>Pedido #{o.orderNumber} · cancelado</span><span>{new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</span></li>
                            ))}
                          </ul>
                        )}
                        <div className="px-4 pb-4">
                          <button type="button" onClick={() => handleRepeatOrder(entry.latest)} className="w-full h-10 rounded-xl bg-gray-900 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer">
                            <RotateCcw className="w-3.5 h-3.5" /> Tentar de novo
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </div>
      ) : navTab === 'cart' ? (
        <CartScreen
          storeName={storeData.tenant.name}
          lines={cart.map((item, idx) => ({ key: item.key, product: item.product, quantity: item.quantity, notes: item.notes, unitPrice: pricedLines[idx]?.unitPrice ?? item.product.price, isCampaign: item.origin.source === 'campaign' }))}
          color={buttonColor}
          subtotal={subtotal}
          deliveryFee={deliveryFee}
          pickupDiscount={pickupDiscount}
          couponDiscount={couponDiscount}
          couponCode={appliedCoupon?.code}
          total={grandTotal}
          minOrderValue={storeData.settings.minOrderValue || 0}
          modes={availableModes.modes}
          mode={fulfillmentType}
          onModeChange={setFulfillmentType}
          addressLine={selectedAddress ? `${selectedAddress.street}${selectedAddress.number ? `, ${selectedAddress.number}` : ''}${selectedAddress.complement ? ` - ${selectedAddress.complement}` : ''}` : undefined}
          onChangeAddress={() => setAddressFlow({ open: true, mode: 'select' })}
          orderNotes={orderNotes}
          onOrderNotes={setOrderNotes}
          onInc={handleIncLine}
          onDec={handleRemoveFromCart}
          onRemoveLine={handleRemoveLineEntirely}
          onLineNote={handleLineNote}
          onContinue={() => {
            // Entrega sem endereço escolhido: pede para escolher (não usa o último endereço digitado no aparelho).
            if (fulfillmentType === 'DELIVERY' && !selectedAddress) {
              continueAfterAddressRef.current = true;
              setAddressFlow({ open: true, mode: 'select' });
              return;
            }
            setIsCheckoutOpen(true);
          }}
          onKeepShopping={() => setNavTab('home')}
        />
      ) : navTab === 'search' ? (
        <SearchScreen
          products={storeData.products}
          categories={storeData.categories}
          userId={userKey}
          color={buttonColor}
          qtyOf={qtyOfCatalog}
          onAdd={(p) => handleAddToCart(p)}
          onRemove={(p) => handleRemoveFromCart(cartLineKey(p.id, CATALOG_ORIGIN))}
          onOpen={(p) => openProductFromList(p)}
          isFavorite={(id) => favoriteIds.includes(id)}
          onToggleFavorite={handleToggleFavorite}
        />
      ) : navTab === 'offers' ? (
        <OffersScreen
          products={storeData.products}
          carousels={storeData.promotionCarousels || []}
          tenantId={storeData.tenant.id}
          storefrontCards={storefrontCards}
          clockOffsetMs={storeData.serverTimeOffsetMs}
          nowMs={storefrontClockTick + storeData.serverTimeOffsetMs}
          color={buttonColor}
          qtyOf={qtyOfOffer}
          onAdd={(it) => handleAddToCart(it.product, it.origin)}
          onRemove={(it) => handleRemoveFromCart(cartLineKey(it.product.id, it.origin))}
          onOpen={(it) => openProductFromList(it.origin.source === 'campaign' ? { ...it.product, promotionalPrice: it.offerPrice } : it.product, it.origin)}
          onCardClick={handleOfferClick}
        />
      ) : navTab === 'profile' ? (
        <ProfileScreen
          page={profilePage}
          onNavigate={(pg) => { setProfilePage(pg); try { window.scrollTo({ top: 0 }); } catch { /* jsdom */ } }}
          color={buttonColor}
          user={supabaseUser ? { id: supabaseUser.id, email: supabaseUser.email || undefined } : null}
          customerName={customerName}
          customerPhone={customerPhone}
          onLogin={() => setIsAuthModalOpen(true)}
          onSignOut={async () => {
            await signOut();
            setProfilePage('menu');
            showToast({ type: 'info', title: 'Sessão encerrada', message: 'Você saiu da sua conta.' });
          }}
          onOpenAddresses={() => setAddressFlow({ open: true, mode: 'manage' })}
          addressSummary={selectedAddress ? `${addressTitle(selectedAddress)}${addressSubtitle(selectedAddress) ? ` · ${addressSubtitle(selectedAddress)}` : ''}` : undefined}
          notifications={notifications}
          unreadCount={unreadCount}
          onNotificationsSeen={markAllNotificationsSeen}
          onOpenOrder={(id) => { setFocusOrderId(id); setNavTab('orders'); }}
          storeSlug={storeData.tenant.slug}
          campaigns={storeData.campaigns || []}
          nowMs={nowTick}
          onUseCoupon={(code) => {
            setCouponCodeInput(code);
            setCouponMessage(null);
            setNavTab('cart');
            showToast({ type: 'info', title: 'Cupom pronto', message: `Toque em "Aplicar" no cupom ${code} ao finalizar o pedido.` });
          }}
          loadCoupons={customerAppRepository.listStoreCoupons}
          loadCpf={loadMyCpf}
          onSaveProfile={handleSaveProfile}
          favoriteProducts={favoriteIds.map(id => storeData.products.find(p => p.id === id)).filter((p): p is Product => Boolean(p))}
          qtyOf={qtyOfCatalog}
          onAdd={(p) => handleAddToCart(p)}
          onRemove={(p) => handleRemoveFromCart(cartLineKey(p.id, CATALOG_ORIGIN))}
          onOpenProduct={(p) => openProductFromList(p)}
          onToggleFavorite={handleToggleFavorite}
          onClearSearchHistory={() => { clearSearchHistory(kv, userKey); showToast({ type: 'success', title: 'Histórico de busca apagado' }); }}
          onRequestDeletion={handleRequestDeletion}
          storeName={storeData.tenant.name}
          onWhatsApp={(text) => openWhatsAppContact(undefined, text)}
          helpOrder={helpOrder}
          onClearHelpOrder={() => setHelpOrder(null)}
          onAboutStore={() => setIsAccountOpen(true)}
        />
      ) : (
        /* Visualização da Vitrine e Cardápio */
        <div className="max-w-lg mx-auto p-4 space-y-4">
          {/* Banner Principal se configurado */}
          {theme.bannerUrl && (
            <div className="relative rounded-2xl overflow-hidden shadow-xs border border-gray-200/80">
              <img
                src={theme.bannerUrl}
                alt={storeData.tenant.name}
                className="w-full h-36 sm:h-44 object-cover"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent flex flex-col justify-end p-4 text-white">
                <p className="text-xs font-semibold text-emerald-300 drop-shadow-sm">Cardápio Oficial</p>
                <h2 className="text-lg font-extrabold drop-shadow-sm">{storeData.tenant.name}</h2>
                {theme.tagline && <p className="text-xs text-white/90 line-clamp-1">{theme.tagline}</p>}
              </div>
            </div>
          )}

          {/* Carrossel de Ofertas Válidas do Estabelecimento */}
          {storefrontCards.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Ofertas & Promoções em Destaque</span>
              </div>
              <OfferCarousel
                offers={storefrontCards}
                onOfferClick={handleOfferClick}
                clockOffsetMs={storeData.serverTimeOffsetMs}
              />
            </div>
          )}

          {/* Carrosséis Promocionais da Vitrine (COMANDO 138) */}
          {storeData.promotionCarousels && storeData.promotionCarousels.length > 0 && !searchTerm.trim() && (
            <div className="space-y-5">
              {storeData.promotionCarousels
                .filter(carousel => carousel.isActive && carousel.showInStore && carousel.items && carousel.items.length > 0)
                .map((carousel) => (
                  <div key={carousel.id} className="space-y-2">
                    {/* Header do Carrossel Promocional */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                          <Flame className="w-3.5 h-3.5 text-amber-500" />
                        </div>
                        <div>
                          <h3 className="text-sm font-extrabold text-gray-900 tracking-tight">
                            {carousel.name}
                          </h3>
                          {carousel.description && (
                            <p className="text-[11px] text-gray-500 line-clamp-1">{carousel.description}</p>
                          )}
                        </div>
                      </div>
                      <span className="text-[11px] text-gray-400 font-medium">
                        {carousel.items.length} {carousel.items.length === 1 ? 'item' : 'itens'}
                      </span>
                    </div>

                    {/* Rolagem Horizontal de Cards Promocionais */}
                    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory pt-0.5">
                      {carousel.items.map((item) => {
                        if (!item.product) return null;
                        const p = item.product;
                        const campaignOrigin: PurchaseOrigin = { source: 'campaign', campaignItemId: item.id, carouselId: carousel.id };
                        const campaignKey = cartLineKey(p.id, campaignOrigin);
                        const inCart = cart.find(i => i.key === campaignKey);
                        const isOutOfStock = p.isAvailable !== undefined ? !p.isAvailable : ((p.stockQuantity ?? 1) <= 0);
                        const discountPct = item.calculatedDiscountPercentage > 0 
                          ? item.calculatedDiscountPercentage 
                          : (p.price > item.promotionalPrice && item.promotionalPrice > 0 
                              ? Math.round(((p.price - item.promotionalPrice) / p.price) * 100) 
                              : 0);

                        const promoProduct: Product = {
                          ...p,
                          promotionalPrice: item.promotionalPrice > 0 ? item.promotionalPrice : p.promotionalPrice,
                        };

                        return (
                          <div
                            key={item.id}
                            onClick={() => {
                              setSelectedProductOrigin(campaignOrigin);
                              setSelectedProductModal(promoProduct);
                            }}
                            className={`w-40 sm:w-44 shrink-0 bg-white border rounded-2xl p-2.5 flex flex-col justify-between shadow-2xs hover:shadow-md transition-all cursor-pointer snap-start relative group ${
                              highlightedProductId === p.id 
                                ? 'ring-2 ring-emerald-500 bg-emerald-50/40 border-emerald-400' 
                                : 'border-gray-200/90 hover:border-gray-300'
                            } ${isOutOfStock ? 'opacity-70 bg-gray-50/60' : ''}`}
                            style={{ borderRadius }}
                          >
                            {/* Imagem do Produto + Badges */}
                            <div className="relative w-full h-28 sm:h-32 rounded-xl overflow-hidden bg-gray-100 mb-2">
                              {p.imageUrl ? (
                                <img
                                  src={p.imageUrl}
                                  alt={p.name}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-300">
                                  <ShoppingBag className="w-7 h-7" />
                                </div>
                              )}

                              {item.showDiscountBadge !== false && discountPct > 0 && (
                                <span className="absolute top-1.5 left-1.5 bg-rose-600 text-white text-[9.5px] font-black uppercase px-2 py-0.5 rounded-full shadow-xs flex items-center gap-0.5">
                                  <Flame className="w-2.5 h-2.5 fill-current" />
                                  {discountPct}% OFF
                                </span>
                              )}

                              {isOutOfStock && (
                                <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center">
                                  <span className="text-[10px] font-bold text-white bg-black/70 px-2 py-0.5 rounded-md uppercase">
                                    Esgotado
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Detalhes do Produto */}
                            <div className="space-y-1 min-w-0 mb-2 flex-1">
                              <h4 className="font-bold text-xs text-gray-900 leading-snug line-clamp-2" title={p.name}>
                                {p.name}
                              </h4>
                              {p.description && (
                                <p className="text-[10px] text-gray-400 line-clamp-1">
                                  {p.description}
                                </p>
                              )}
                            </div>

                            {/* Preço e Botão Adicionar */}
                            <div className="pt-1.5 border-t border-gray-100 flex items-end justify-between gap-1.5">
                              <div className="min-w-0">
                                {item.promotionalPrice > 0 && item.promotionalPrice < p.price ? (
                                  <div>
                                    <span className="text-[10px] text-gray-400 line-through font-mono block leading-tight">
                                      {formatBRL(p.price)}
                                    </span>
                                    <span className="font-extrabold text-xs sm:text-sm text-emerald-800 font-mono leading-tight">
                                      {formatBRL(item.promotionalPrice)}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="font-extrabold text-xs sm:text-sm text-gray-900 font-mono">
                                    {formatBRL(p.price)}
                                  </span>
                                )}
                              </div>

                              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                                {isOutOfStock ? (
                                  <span className="text-[9px] font-bold text-gray-400 uppercase">
                                    Off
                                  </span>
                                ) : inCart ? (
                                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 shadow-2xs">
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveFromCart(campaignKey)}
                                      className="w-5 h-5 rounded bg-white flex items-center justify-center text-gray-700 hover:bg-gray-200 cursor-pointer shadow-xs"
                                    >
                                      <Minus className="w-2.5 h-2.5" />
                                    </button>
                                    <span className="text-[11px] font-black font-mono px-0.5">{inCart.quantity}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleAddToCart(p, campaignOrigin)}
                                      className="w-5 h-5 rounded text-white flex items-center justify-center cursor-pointer shadow-xs"
                                      style={{ backgroundColor: buttonColor }}
                                    >
                                      <Plus className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleAddToCart(p, campaignOrigin)}
                                    className="h-6 px-2 rounded-lg text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shadow-xs hover:opacity-95 transition-opacity"
                                    style={{ backgroundColor: buttonColor }}
                                  >
                                    <Plus className="w-3 h-3" />
                                    <span>Adicionar</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Barra de Busca de Produtos */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar produtos, bebidas ou petiscos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9.5 pr-4 py-2.5 rounded-2xl border border-gray-200 text-xs bg-white shadow-2xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Filtro Horizontal de Categorias */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setActiveCategory('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 cursor-pointer transition-all ${
                activeCategory === 'ALL'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
              style={{
                backgroundColor: activeCategory === 'ALL' ? primaryColor : undefined,
                borderRadius
              }}
            >
              Todos ({storeData.products.length})
            </button>
            {storeData.categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 cursor-pointer transition-all ${
                  activeCategory === c.id
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
                style={{
                  backgroundColor: activeCategory === c.id ? primaryColor : undefined,
                  borderRadius
                }}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* Listagem de Produtos Reais com UUIDs do Banco */}
          <div className="space-y-3 pt-1">
            {filteredProducts.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-2xl border border-gray-200 text-gray-400 space-y-1">
                <p className="font-bold text-gray-600">Nenhum produto encontrado</p>
                <p className="text-xs">Tente selecionar outra categoria ou buscar por outro termo.</p>
              </div>
            ) : (
              filteredProducts.map((p) => {
                const inCart = cart.find(i => i.key === cartLineKey(p.id, CATALOG_ORIGIN));
                const isOutOfStock = p.isAvailable !== undefined ? !p.isAvailable : p.stockQuantity <= 0;

                return (
                  <div
                    key={p.id}
                    id={`product-${p.id}`}
                    onClick={() => handleSelectProduct(p.id)}
                    className={`p-3.5 border bg-white flex items-center justify-between gap-3 shadow-xs hover:border-gray-300 transition-all cursor-pointer ${
                      highlightedProductId === p.id 
                        ? 'ring-2 ring-emerald-500 bg-emerald-50/50 shadow-md border-emerald-400' 
                        : 'border-gray-200/80'
                    } ${
                      isOutOfStock ? 'opacity-70 bg-gray-50/50' : ''
                    }`}
                    style={{ borderRadius }}
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-gray-900 leading-snug truncate">{p.name}</h3>
                        {isOutOfStock ? (
                          <Badge variant="danger" size="sm">Esgotado</Badge>
                        ) : null}
                      </div>

                      <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                        {p.description}
                      </p>

                      <div className="flex items-baseline gap-2 pt-1">
                        {p.promotionalPrice && p.promotionalPrice > 0 ? (
                          <>
                            <span className="font-extrabold text-sm text-emerald-800 font-mono">
                              {formatBRL(p.promotionalPrice)}
                            </span>
                            <span className="text-xs text-gray-400 line-through font-mono">
                              {formatBRL(p.price)}
                            </span>
                          </>
                        ) : (
                          <span className="font-extrabold text-sm text-gray-900 font-mono">
                            {formatBRL(p.price)}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 font-mono uppercase">/{p.unit || 'un'}</span>
                      </div>
                    </div>

                    <div className="relative shrink-0 flex flex-col items-center gap-2">
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt={p.name}
                          className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover border border-gray-100"
                        />
                      ) : (
                        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-gray-100 flex items-center justify-center text-gray-300">
                          <ShoppingBag className="w-8 h-8" />
                        </div>
                      )}

                      {isOutOfStock ? (
                        <span className="text-[10px] font-bold text-gray-400 uppercase py-1">
                          Indisponível
                        </span>
                      ) : inCart ? (
                        <div className="flex items-center gap-1.5 bg-gray-100 rounded-xl p-1 shadow-2xs">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveFromCart(cartLineKey(p.id, CATALOG_ORIGIN)); }}
                            className="w-6 h-6 rounded-lg bg-white flex items-center justify-center text-gray-700 hover:bg-gray-200 cursor-pointer shadow-xs"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-xs font-black font-mono px-1">{inCart.quantity}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAddToCart(p); }}
                            className="w-6 h-6 rounded-lg text-white flex items-center justify-center cursor-pointer shadow-xs"
                            style={{ backgroundColor: buttonColor }}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={(e) => { e.stopPropagation(); handleAddToCart(p); }}
                          className="text-xs py-1 h-7 rounded-xl px-3 cursor-pointer"
                          style={{ backgroundColor: buttonColor }}
                        >
                          Adicionar
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Floating Bottom Cart Bar */}
      {cart.length > 0 && !isCheckoutOpen && (navTab === 'home' || navTab === 'search' || navTab === 'offers') && (
        <div className="fixed bottom-16 left-0 right-0 z-40 p-4 max-w-lg mx-auto pointer-events-none">
          <div
            onClick={() => setNavTab('cart')}
            data-testid="floating-cart"
            className="pointer-events-auto p-3.5 rounded-2xl text-white shadow-xl flex items-center justify-between cursor-pointer hover:opacity-95 transition-all"
            style={{ backgroundColor: buttonColor, borderRadius }}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center font-black text-xs font-mono">
                {cartTotalCount}
              </div>
              <div className="text-xs">
                <div className="font-bold">Ver Sacola de Compras</div>
                <div className="text-white/80">
                  {cart.length} {cart.length === 1 ? 'item' : 'itens'} adicionados
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 font-mono font-extrabold text-sm">
              <span>{formatBRL(subtotal)}</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL DE CHECKOUT & AUTENTICAÇÃO DO CLIENTE */}
      {/* ---------------------------------------------------------------------- */}
      <Modal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        title="Finalizar Pedido"
        size="md"
      >
        <div className="space-y-4">
          {/* BARREIRA OBRIGATÓRIA DE LOGIN: NÃO EXISTE CHECKOUT ANÔNIMO (exceto PRÉVIA no demo local; confirmar continua exigindo login em handleFinishOrder) */}
          {!supabaseUser && !DEMO_CHECKOUT_PREVIEW ? (
            <div className="space-y-4 py-2">
              <div className="text-center space-y-1.5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
                  <UserCheck className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-gray-900">Entre na sua Conta para Finalizar</h3>
                <p className="text-xs text-gray-500 max-w-xs mx-auto">
                  Para confirmar seu pedido com segurança e receber atualizações em tempo real, acesse como cliente:
                </p>
              </div>

              {/* Botão de Login com Google */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isAuthenticating || isGoogleAuthenticating}
                className="w-full py-2.5 px-4 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 shadow-xs flex items-center justify-center gap-2.5 cursor-pointer transition-all"
              >
                {isGoogleAuthenticating ? (
                  <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                ) : (
                  <>
                    <GoogleIcon />
                    <span>Continuar com Google</span>
                  </>
                )}
              </button>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-gray-200 w-full" />
                <span className="bg-white px-2 text-[10px] text-gray-400 uppercase font-bold shrink-0">
                  ou com seu e-mail
                </span>
              </div>

              {/* Abas Entrar / Criar Conta com E-mail */}
              <div className="grid grid-cols-2 p-1 bg-gray-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => { setAuthMode('login'); setAuthNotice(null); }}
                  className={`py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                    authMode === 'login' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Já tenho conta
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthMode('signup'); setAuthNotice(null); }}
                  className={`py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                    authMode === 'signup' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Criar conta
                </button>
              </div>

              {authNotice && (
                <CustomerEmailConfirmNotice
                  email={authNotice.email}
                  kind={authNotice.kind}
                  onResend={(email) => resendConfirmationEmail(email)}
                  onBackToLogin={() => { setAuthEmail(authNotice.email); setAuthMode('login'); setAuthNotice(null); }}
                />
              )}
              {!(authNotice && authNotice.kind === 'signup') && (
              <form onSubmit={handleEmailAuth} className="space-y-3">
                {authMode === 'signup' && (
                  <Input
                    label="Seu Nome Completo"
                    placeholder="Ex: João da Silva"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    required
                    className="text-xs"
                  />
                )}
                {authMode === 'signup' && (
                  <Input
                    label="WhatsApp (opcional)"
                    type="tel"
                    inputMode="tel"
                    placeholder="(11) 91234-5678"
                    value={authPhone}
                    onChange={(e) => setAuthPhone(e.target.value)}
                    className="text-xs"
                  />
                )}
                <Input
                  label="E-mail"
                  type="email"
                  placeholder="seu@email.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                  className="text-xs"
                />
                <Input
                  label="Senha"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  required
                  className="text-xs"
                />

                <Button
                  type="submit"
                  disabled={isAuthenticating || isGoogleAuthenticating}
                  className="w-full text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer"
                  style={{ backgroundColor: buttonColor }}
                >
                  {isAuthenticating ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : authMode === 'login' ? (
                    'Entrar e Continuar Pedido'
                  ) : (
                    'Criar Conta e Continuar Pedido'
                  )}
                </Button>
              </form>
              )}
            </div>
          ) : (
            /* CLIENTE AUTENTICADO: FORMULÁRIO OPERACIONAL DO PEDIDO */
            <form onSubmit={handleFinishOrder} className="space-y-4">
              {/* Badge de Cliente Autenticado */}
              {!supabaseUser ? (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                  <span className="font-bold">Prévia (modo demonstração local):</span> confira modalidade e totais. Para confirmar o pedido é preciso entrar na sua conta.
                </div>
              ) : (
              <div className="p-2.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold text-[10px]">
                    ✓
                  </div>
                  <div>
                    <span className="font-bold text-emerald-950">Cliente Conectado:</span>{' '}
                    <span className="text-emerald-800">{supabaseUser.email}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="text-[11px] text-emerald-700 hover:text-emerald-900 underline font-semibold cursor-pointer"
                >
                  Trocar
                </button>
              </div>
              )}

              {/* Resumo dos Itens da Sacola */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-gray-700 uppercase tracking-wider">
                  <span>Itens Selecionados ({cartTotalCount})</span>
                  <span>Subtotal: {formatBRL(subtotal)}</span>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 divide-y divide-gray-100">
                  {cart.map((item, idx) => {
                    const price = pricedLines[idx]?.unitPrice ?? item.product.price;
                    return (
                      <div key={item.key} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs" data-testid="cart-line" data-origin={item.origin.source}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold font-mono text-emerald-800">{item.quantity}x</span>
                          <span className="text-gray-800 truncate">{item.product.name}</span>
                          {item.origin.source === 'campaign' && (
                            <span className="text-[9px] font-bold uppercase text-amber-700 bg-amber-50 border border-amber-200 px-1 rounded shrink-0">Oferta</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-bold text-gray-900">
                            {formatBRL((price * item.quantity))}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveFromCart(item.key)}
                            className="text-gray-400 hover:text-rose-600 p-0.5 cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modalidade de atendimento (configuração da loja) */}
              <div className="space-y-1.5 pt-2 border-t border-gray-100" data-testid="fulfillment-mode-selector">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Como você quer receber?
                </label>
                {availableModes.modes.length === 0 ? (
                  <p className="p-2.5 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700 font-semibold">
                    {availableModes.blockedReason}
                  </p>
                ) : (
                  <div className={`grid gap-2 ${availableModes.modes.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {availableModes.modes.includes('DELIVERY') && (
                      <button
                        type="button"
                        onClick={() => setFulfillmentType('DELIVERY')}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                          fulfillmentType === 'DELIVERY'
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Bike className="w-4 h-4" />
                        Receber em casa
                      </button>
                    )}
                    {availableModes.modes.includes('PICKUP') && (
                      <button
                        type="button"
                        onClick={() => setFulfillmentType('PICKUP')}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                          fulfillmentType === 'PICKUP'
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Store className="w-4 h-4" />
                        <span>
                          Retirar na loja
                          {fulfillmentSettings.pickupDiscountEnabled && fulfillmentSettings.pickupDiscountPercent > 0 && (
                            <span className="block text-[10px] text-emerald-700">{fulfillmentSettings.pickupDiscountPercent}% de desconto</span>
                          )}
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Dados Obrigatórios do Cliente */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Dados do Comprador
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    label="Seu Nome Completo *"
                    placeholder="Ex: João Silva"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    required
                    className="text-xs"
                  />
                  <Input
                    label="WhatsApp para Contato *"
                    placeholder="(11) 98765-4321"
                    value={customerPhone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Endereço de Entrega com Google Autocomplete */}
              {fulfillmentType === 'DELIVERY' ? (
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Endereço de Entrega
                  </h4>

                  {/* Endereço salvo (fluxo com mapa) — os campos abaixo continuam editáveis */}
                  <button
                    type="button"
                    onClick={() => setAddressFlow({ open: true, mode: 'select' })}
                    data-testid="checkout-address-picker"
                    className="w-full p-3 rounded-xl border border-gray-200 bg-white flex items-center gap-3 text-left cursor-pointer hover:bg-gray-50"
                  >
                    <MapPin className="w-5 h-5 shrink-0" style={{ color: buttonColor }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-bold text-gray-900 truncate">
                        {selectedAddress ? `${selectedAddress.label === 'Outro' && selectedAddress.nickname ? selectedAddress.nickname : selectedAddress.label} · ${addressTitle(selectedAddress)}` : 'Escolher no mapa ou nos endereços salvos'}
                      </span>
                      <span className="block text-[11px] text-gray-500 truncate">
                        {selectedAddress ? addressSubtitle(selectedAddress) || 'Endereço salvo' : 'Busque a rua ou use sua localização atual'}
                      </span>
                    </span>
                    <span className="text-[11px] font-bold shrink-0" style={{ color: buttonColor }}>{selectedAddress ? 'Trocar' : 'Escolher'}</span>
                  </button>

                  {/* Autocomplete do Google Places Integrado */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-700 flex items-center justify-between">
                      <span>Buscar rua / endereço</span>
                      <span className="text-[10px] text-emerald-700 font-normal">Autocomplete Inteligente</span>
                    </label>
                    <AddressAutocompleteInput
                      value={streetAddress}
                      onChange={(val) => setStreetAddress(val)}
                      onAddressSelect={(parsed: ParsedAddress) => {
                        setStreetAddress(parsed.street || parsed.formattedAddress);
                        if (parsed.number) setAddressNumber(parsed.number);
                        if (parsed.neighborhood) setNeighborhood(parsed.neighborhood);
                        if (parsed.city) setCity(parsed.city);
                        if (parsed.state) setState(parsed.state);
                        if (parsed.postalCode) setPostalCode(parsed.postalCode);
                        setLatitude(parsed.latitude);
                        setLongitude(parsed.longitude);
                        setPlaceId(parsed.placeId);
                        setFormattedAddress(parsed.formattedAddress);
                      }}
                      placeholder="Comece a digitar sua rua ou avenida..."
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1">
                      <Input
                        label="Número *"
                        placeholder="Ex: 120"
                        value={addressNumber}
                        onChange={(e) => setAddressNumber(e.target.value)}
                        required
                        className="text-xs"
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        label="Bairro"
                        placeholder="Ex: Jardins"
                        value={neighborhood}
                        onChange={(e) => setNeighborhood(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      label="Complemento / Apto"
                      placeholder="Ex: Bloco B, Apto 42"
                      value={complement}
                      onChange={(e) => setComplement(e.target.value)}
                      className="text-xs"
                    />
                    <Input
                      label="Ponto de Referência"
                      placeholder="Ex: Próximo à padaria"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-1">
                  <div className="font-bold text-gray-800 flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-emerald-700" />
                    Retirada no Estabelecimento:
                  </div>
                  <p className="text-gray-600">{storeData.settings.address}</p>
                  {fulfillmentSettings.pickupInstructions && (
                    <p className="text-gray-700 whitespace-pre-line" data-testid="pickup-instructions">{fulfillmentSettings.pickupInstructions}</p>
                  )}
                  <p className="text-[11px] text-emerald-700 font-bold">
                    Taxa de entrega: Grátis (R$ 0,00)
                  </p>
                </div>
              )}

              {/* Forma de Pagamento */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Forma de Pagamento
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'PIX', label: 'PIX Instantâneo', icon: <QrCode className="w-4 h-4" /> },
                    { id: 'CREDIT_CARD', label: 'Cartão de Crédito', icon: <CreditCard className="w-4 h-4" /> },
                    { id: 'DEBIT_CARD', label: 'Cartão de Débito', icon: <CreditCard className="w-4 h-4" /> },
                    { id: 'CASH', label: 'Dinheiro', icon: <Tag className="w-4 h-4" /> },
                  ].map((pm) => (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => setPaymentMethod(pm.id as any)}
                      className={`p-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 cursor-pointer transition-all ${
                        paymentMethod === pm.id
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <span className={paymentMethod === pm.id ? 'text-emerald-700' : 'text-gray-400'}>
                        {pm.icon}
                      </span>
                      <span>{pm.label}</span>
                    </button>
                  ))}
                </div>

                {paymentMethod === 'CASH' && (
                  <Input
                    label="Precisa de troco para quanto? (Deixe em branco se não precisar)"
                    placeholder="Ex: 50,00"
                    inputMode="decimal"
                    value={cashChange}
                    onChange={(e) => setCashChange(e.target.value)}
                    className="text-xs"
                  />
                )}
                {paymentMethod === 'CASH' && cashChangeInfo.status !== 'ok' && <CashChangeHint info={cashChangeInfo} />}
              </div>

              {/* Observações */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700">Observações para o Pedido (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ex: Não tocar campainha, bebidas bem geladas..."
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-gray-200 text-xs bg-white shadow-2xs"
                />
              </div>

              {/* Cupom de Desconto (COMANDO 138) */}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Ticket className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Cupom de Desconto</span>
                </label>
                {appliedCoupon ? (
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-emerald-700 text-white flex items-center justify-center text-xs font-black">
                        %
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-extrabold text-emerald-900 tracking-wider">
                            {appliedCoupon.code}
                          </span>
                          {appliedCoupon.usageLimit && (
                            <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.2 rounded-md">
                              Restam {Math.max(0, appliedCoupon.usageLimit - (appliedCoupon.timesUsed || 0))}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-emerald-700">
                          Desconto de {formatBRL(couponDiscount)} aplicado
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveCoupon}
                      className="text-xs text-rose-600 hover:text-rose-800 font-semibold cursor-pointer px-2 py-1"
                    >
                      Remover
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Ex: PRIMEIRACOMPRA"
                        value={couponCodeInput}
                        onChange={(e) => {
                          setCouponCodeInput(e.target.value.toUpperCase());
                          if (couponMessage) setCouponMessage(null);
                        }}
                        className="flex-1 p-2.5 rounded-xl border border-gray-200 text-xs font-mono uppercase bg-white shadow-2xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={handleApplyCoupon}
                        disabled={couponLoading || !couponCodeInput.trim()}
                        className="px-3 py-2 rounded-xl text-xs font-bold text-white transition-opacity disabled:opacity-50 cursor-pointer shadow-xs"
                        style={{ backgroundColor: buttonColor }}
                      >
                        {couponLoading ? 'Aplicando...' : 'Aplicar'}
                      </button>
                    </div>
                    {couponMessage && (
                      <p className={`text-[11px] ${couponMessage.type === 'success' ? 'text-emerald-700 font-medium' : 'text-rose-600'}`}>
                        {couponMessage.text}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Valores Totais Oficiais */}
              <div className="p-3 bg-gray-50 rounded-xl space-y-1.5 text-xs">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span className="font-mono">{formatBRL(subtotal)}</span>
                </div>
                {pickupDiscount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-semibold" data-testid="pickup-discount-line">
                    <span className="flex items-center gap-1">
                      <Store className="w-3 h-3" />
                      Desconto retirada ({pricing.pickupDiscountPercent}%)
                    </span>
                    <span className="font-mono">- {formatBRL(pickupDiscount)}</span>
                  </div>
                )}
                {appliedCoupon && pricing.couponRejectedReason && (
                  <div className="text-[11px] text-amber-700">
                    {pricing.couponRejectedReason === 'COUPON_NO_ELIGIBLE_ITEMS'
                      ? 'O cupom vale apenas para itens fora de promoção.'
                      : pricing.couponRejectedReason === 'COUPON_NOT_STACKABLE_WITH_PICKUP'
                      ? 'Este cupom não acumula com o desconto de retirada. Escolha "Receber em casa" ou use outro cupom.'
                      : `O cupom exige ${formatBRL((appliedCoupon.minOrderValue || 0))} em itens fora de promoção.`}
                  </div>
                )}
                {couponDiscount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span className="flex items-center gap-1">
                      <Ticket className="w-3 h-3" />
                      Desconto ({appliedCoupon?.code})
                    </span>
                    <span className="font-mono">- {formatBRL(couponDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-600">
                  <span>{fulfillmentType === 'PICKUP' ? 'Taxa de Entrega (retirada)' : 'Taxa de Entrega'}</span>
                  <span className="font-mono text-emerald-700 font-bold">
                    {deliveryFee === 0 ? 'Grátis' : `${formatBRL(deliveryFee)}`}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-gray-900 border-t border-gray-200 pt-1.5">
                  <span>Total</span>
                  <span className="font-mono text-emerald-800 text-base">{formatBRL(grandTotal)}</span>
                </div>
                {paymentMethod === 'CASH' && cashChangeInfo.status === 'ok' && (
                  <CashChangeHint info={cashChangeInfo} className="pt-1" />
                )}
              </div>

              {cartAdjustNotice && (
                <div data-testid="cart-adjust-notice" role="alert" className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-xs text-amber-950 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-px" />
                  <div className="space-y-1.5 min-w-0">
                    <p className="font-bold">Sua sacola foi ajustada</p>
                    <p>{cartAdjustNotice}</p>
                    <button type="button" onClick={() => setCartAdjustNotice(null)} className="font-bold underline cursor-pointer">Entendi, revisar sacola</button>
                  </div>
                </div>
              )}

              {/* Botão de Confirmação do Pedido */}
              <Button
                type="submit"
                disabled={isSubmittingOrder || cart.length === 0 || availableModes.modes.length === 0}
                className="w-full text-white font-extrabold text-sm py-3 rounded-xl shadow-md cursor-pointer"
                style={{ backgroundColor: buttonColor }}
              >
                {isSubmittingOrder ? (
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processando seu pedido no servidor...</span>
                  </div>
                ) : !supabaseUser ? (
                  `Entre para finalizar • ${formatBRL(grandTotal)}`
                ) : (
                  `Confirmar Pedido • ${formatBRL(grandTotal)}`
                )}
              </Button>
            </form>
          )}
        </div>
      </Modal>

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL DE CONFIRMAÇÃO DE SUCESSO DO PEDIDO */}
      {/* ---------------------------------------------------------------------- */}
      <Modal
        isOpen={Boolean(completedOrder)}
        onClose={() => setCompletedOrder(null)}
        title="Pedido Realizado com Sucesso!"
        size="md"
      >
        <div className="space-y-4 text-center py-2">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-xs">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div className="space-y-1">
            <h3 className="text-xl font-black text-gray-900">PEDIDO REALIZADO!</h3>
            <p className="text-sm font-extrabold text-emerald-800 font-mono">
              Pedido #{completedOrder?.orderNumber || completedOrder?.id.slice(0, 6)}
            </p>
            <p className="text-xs text-gray-500">
              Enviado para <strong className="text-gray-900">{storeData.tenant.name}</strong>
            </p>
          </div>

          <div className="p-3.5 bg-gray-50 rounded-2xl text-left text-xs font-mono space-y-1 border border-gray-100">
            <div className="flex justify-between">
              <span className="text-gray-500">Total:</span>
              <span className="font-extrabold text-gray-900">{formatBRL(completedOrder?.totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Pagamento:</span>
              <span className="font-bold text-gray-900">{paymentMethodLabel(completedOrder?.paymentMethod)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Status:</span>
              <span className="font-bold text-emerald-700">Recebido pelo Estabelecimento</span>
            </div>
          </div>

          {/* Banner de Recompensa Atômica do Cupom (COMANDO 139) */}
          {completedCouponRedemption?.redemptionNumber && (
            <div className="p-3.5 bg-linear-to-r from-emerald-50 to-teal-50 border border-emerald-300 rounded-2xl text-left space-y-1 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs font-black text-emerald-950">
                <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Oferta Limitada Garantida!</span>
              </div>
              <p className="text-[11px] text-emerald-900 leading-snug">
                Parabéns! Você foi o comprador nº <strong>{completedCouponRedemption.redemptionNumber}</strong> e garantiu o desconto exclusivo do cupom <strong>{completedCouponRedemption.couponCode}</strong>!
              </p>
            </div>
          )}

          {/* PIX: n1n6 = BR Code gerado pelo servidor para este pedido; legacy-020 = chave publicada pela loja. */}
          {completedOrder?.paymentMethod === 'PIX' && completedOrder.id && isN1N6Backend() && <OrderPixPanel orderId={completedOrder.id} />}
          {completedOrder?.paymentMethod === 'PIX' && !isN1N6Backend() && (
            <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-2xl space-y-2 text-left">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-950">
                <QrCode className="w-4 h-4 text-emerald-700" />
                <span>Pagamento via PIX</span>
              </div>
              {legacyStorePixKey ? (
                <>
                  <p className="text-[11px] text-gray-600">
                    Pague <strong>{formatBRL(completedOrder.totalAmount)}</strong> usando a chave PIX da loja:
                  </p>
                  <Button
                    size="sm"
                    onClick={handleCopyPix}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                  >
                    {copiedPix ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                    {copiedPix ? 'Chave PIX copiada!' : 'Copiar chave PIX da loja'}
                  </Button>
                </>
              ) : (
                <p className="text-[11px] text-gray-600">A loja enviará os dados do PIX pelo WhatsApp.</p>
              )}
            </div>
          )}

          <div className="pt-2 flex flex-col gap-2">
            <Button
              className="w-full text-white font-bold"
              style={{ backgroundColor: buttonColor }}
              onClick={() => {
                if (completedOrder?.id) setFocusOrderId(completedOrder.id);
                setCompletedOrder(null);
                setNavTab('orders');
              }}
            >
              Acompanhar Meus Pedidos
            </Button>
            <Button
              variant="outline"
              onClick={() => openWhatsAppContact(completedOrder?.orderNumber)}
              className="w-full flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-4 h-4 text-emerald-600" />
              Falar no WhatsApp da Loja
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL DE CONTA DO CLIENTE & INFORMAÇÕES DA LOJA */}
      {/* ---------------------------------------------------------------------- */}
      <Modal
        isOpen={isAccountOpen}
        onClose={() => setIsAccountOpen(false)}
        title="Minha Conta & Contato"
        size="sm"
      >
        <div className="space-y-4 text-xs py-1">
          {supabaseUser ? (
            <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl space-y-2">
              <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-800">Conta Conectada</span>
                <span className="text-[11px] font-mono font-medium text-emerald-950 truncate max-w-[180px]">{supabaseUser.email}</span>
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <div className="w-8 h-8 rounded-full bg-emerald-700 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  {customerName ? customerName.substring(0, 2).toUpperCase() : 'CL'}
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-gray-900 truncate">{customerName || 'Cliente'}</h4>
                  <p className="text-[11px] text-gray-500 font-mono truncate">{supabaseUser.email}</p>
                </div>
              </div>
              {customerPhone && (
                <p className="text-[11px] text-gray-600">
                  <strong>WhatsApp:</strong> {customerPhone}
                </p>
              )}
              <div className="pt-1 border-t border-emerald-100">
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  Esta é sua conta do Delivery Channel. Você pode usá-la para comprar em diferentes estabelecimentos parceiros com total segurança.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await signOut();
                  setIsAccountOpen(false);
                  showToast({ type: 'info', title: 'Sessão encerrada', message: 'Você saiu da sua conta.' });
                }}
                className="w-full text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 mr-1" />
                Sair da Minha Conta
              </Button>
            </div>
          ) : (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-2xl text-center space-y-2">
              <p className="text-gray-600 font-medium">Você ainda não está conectado.</p>
              <Button
                size="sm"
                onClick={() => {
                  setIsAccountOpen(false);
                  setIsAuthModalOpen(true);
                }}
                className="w-full text-white font-bold"
                style={{ backgroundColor: buttonColor }}
              >
                Entrar ou Criar Conta
              </Button>
            </div>
          )}

          <div className="p-3 bg-gray-50 rounded-2xl text-left font-mono text-[11px] space-y-1.5 border border-gray-100">
            <div className="font-bold text-gray-900 text-xs font-sans pb-1 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-emerald-700" />
              <span>{storeData.tenant.name}</span>
            </div>
            <div><strong>Telefone:</strong> {storeData.tenant.phone}</div>
            {storeData.settings.phoneWhatsApp && (
              <div><strong>WhatsApp:</strong> {storeData.settings.phoneWhatsApp}</div>
            )}
            <div><strong>Endereço:</strong> {storeData.settings.address}</div>
            <div><strong>Tempo de Preparo:</strong> {storeData.settings.defaultPrepTimeMinutes ? `${storeData.settings.defaultPrepTimeMinutes} min` : '30 min'}</div>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => openWhatsAppContact()}
            leftIcon={<MessageCircle className="w-4 h-4 text-emerald-600" />}
          >
            Falar no WhatsApp da Loja
          </Button>
        </div>
      </Modal>

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL DIRETO DE AUTENTICAÇÃO */}
      {/* ---------------------------------------------------------------------- */}
      <Modal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        title="Conta do Cliente"
        size="sm"
      >
        <div className="space-y-4 py-1">
          <div className="text-center space-y-1">
            <h4 className="text-sm font-bold text-gray-900">Identificação para Pedidos</h4>
            <p className="text-xs text-gray-500">
              Acesse sua conta para comprar em <strong>{storeData.tenant.name}</strong>:
            </p>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isAuthenticating || isGoogleAuthenticating}
            className="w-full py-2.5 px-4 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 shadow-xs flex items-center justify-center gap-2.5 cursor-pointer transition-all"
          >
            {isGoogleAuthenticating ? (
              <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
            ) : (
              <>
                <GoogleIcon />
                <span>Continuar com Google</span>
              </>
            )}
          </button>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-gray-200 w-full" />
            <span className="bg-white px-2 text-[10px] text-gray-400 uppercase font-bold shrink-0">
              ou com e-mail
            </span>
          </div>

          <div className="grid grid-cols-2 p-1 bg-gray-100 rounded-xl">
            <button
              type="button"
              onClick={() => { setAuthMode('login'); setAuthNotice(null); }}
              className={`py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                authMode === 'login' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => { setAuthMode('signup'); setAuthNotice(null); }}
              className={`py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                authMode === 'signup' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Criar Conta
            </button>
          </div>

          {authNotice && (
            <CustomerEmailConfirmNotice
              email={authNotice.email}
              kind={authNotice.kind}
              onResend={(email) => resendConfirmationEmail(email)}
              onBackToLogin={() => { setAuthEmail(authNotice.email); setAuthMode('login'); setAuthNotice(null); }}
            />
          )}
          {!(authNotice && authNotice.kind === 'signup') && (
          <form onSubmit={handleEmailAuth} className="space-y-3">
            {authMode === 'signup' && (
              <Input
                label="Seu Nome Completo"
                placeholder="Ex: Maria Oliveira"
                value={authName}
                onChange={(e) => setAuthName(e.target.value)}
                required
                className="text-xs"
              />
            )}
            {authMode === 'signup' && (
              <Input
                label="WhatsApp (opcional)"
                type="tel"
                inputMode="tel"
                placeholder="(11) 91234-5678"
                value={authPhone}
                onChange={(e) => setAuthPhone(e.target.value)}
                className="text-xs"
              />
            )}
            <Input
              label="E-mail"
              type="email"
              placeholder="seu@email.com"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              required
              className="text-xs"
            />
            <Input
              label="Senha"
              type="password"
              placeholder="Mínimo 6 caracteres"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              required
              className="text-xs"
            />

            <Button
              type="submit"
              disabled={isAuthenticating || isGoogleAuthenticating}
              className="w-full text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer"
              style={{ backgroundColor: buttonColor }}
            >
              {isAuthenticating ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : authMode === 'login' ? (
                'Entrar'
              ) : (
                'Cadastrar'
              )}
            </Button>
          </form>
          )}
        </div>
      </Modal>

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL DE DETALHES DO PRODUTO (OFERTAS & NAVEGAÇÃO INTERNA) */}
      {/* ---------------------------------------------------------------------- */}
      {selectedProductModal && (
        <Modal
          isOpen={Boolean(selectedProductModal)}
          onClose={handleCloseProductModal}
          title={selectedProductModal.name}
          size="md"
        >
          <div className="space-y-4 py-1">
            {/* Imagem do Produto */}
            <div className="w-full h-48 sm:h-56 rounded-2xl overflow-hidden bg-gray-100 relative border border-gray-200/80">
              {selectedProductModal.imageUrl ? (
                <img
                  src={selectedProductModal.imageUrl}
                  alt={selectedProductModal.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300">
                  <ShoppingBag className="w-16 h-16" />
                </div>
              )}
              {selectedProductModal.isFeatured && (
                <div className="absolute top-3 left-3">
                  <Badge variant="warning" size="sm">Destaque da Casa</Badge>
                </div>
              )}
              {selectedProductModal.promotionalPrice && selectedProductModal.promotionalPrice > 0 && (
                <div className="absolute top-3 right-3 bg-emerald-600 text-white text-xs font-black uppercase px-2.5 py-1 rounded-full shadow-sm">
                  {Math.round(((selectedProductModal.price - selectedProductModal.promotionalPrice) / selectedProductModal.price) * 100)}% OFF
                </div>
              )}
            </div>

            {/* Informações de Título e Descrição */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-extrabold text-base text-gray-900 leading-snug">
                  {selectedProductModal.name}
                </h3>
                <span className="text-xs text-gray-500 font-mono uppercase bg-gray-100 px-2 py-0.5 rounded-lg shrink-0">
                  {selectedProductModal.unit || 'un'}
                </span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">
                {selectedProductModal.description}
              </p>
            </div>

            {/* Preços e Disponibilidade */}
            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200/80 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-gray-400 font-bold uppercase block">Preço</span>
                <div className="flex items-baseline gap-2">
                  {selectedProductModal.promotionalPrice && selectedProductModal.promotionalPrice > 0 ? (
                    <>
                      <span className="text-lg font-extrabold text-emerald-800 font-mono">
                        {formatBRL(selectedProductModal.promotionalPrice)}
                      </span>
                      <span className="text-xs text-gray-400 line-through font-mono">
                        {formatBRL(selectedProductModal.price)}
                      </span>
                    </>
                  ) : (
                    <span className="text-lg font-extrabold text-gray-900 font-mono">
                      {formatBRL(selectedProductModal.price)}
                    </span>
                  )}
                </div>
              </div>

              <div>
                {selectedProductModal.isAvailable === false || selectedProductModal.stockQuantity <= 0 ? (
                  <Badge variant="danger" size="sm">Esgotado</Badge>
                ) : (
                  <Badge variant="success" size="sm">Disponível</Badge>
                )}
              </div>
            </div>

            {/* Botão de Ação / Adicionar ao Carrinho */}
            <div className="pt-1 flex items-center gap-3">
              {(() => {
                const modalKey = cartLineKey(selectedProductModal.id, selectedProductOrigin);
                const inCart = cart.find(i => i.key === modalKey);
                const isOutOfStock = selectedProductModal.isAvailable === false || selectedProductModal.stockQuantity <= 0;

                if (isOutOfStock) {
                  return (
                    <Button
                      variant="outline"
                      className="w-full text-xs"
                      disabled
                    >
                      Produto Indisponível no Momento
                    </Button>
                  );
                }

                if (inCart) {
                  return (
                    <div className="w-full flex items-center justify-between p-2 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <span className="text-xs font-bold text-emerald-900">
                        No Carrinho: <strong className="font-mono text-sm">{inCart.quantity}</strong> item(s)
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRemoveFromCart(modalKey)}
                          className="w-8 h-8 rounded-lg bg-white border border-emerald-300 flex items-center justify-center text-emerald-900 hover:bg-emerald-100 cursor-pointer shadow-xs"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddToCart(selectedProductModal, selectedProductOrigin)}
                          className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center hover:bg-emerald-800 cursor-pointer shadow-xs"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <Button
                    className="w-full text-xs font-bold py-2.5 rounded-xl cursor-pointer"
                    onClick={() => handleAddToCart(selectedProductModal, selectedProductOrigin)}
                    leftIcon={<Plus className="w-4 h-4" />}
                    style={{ backgroundColor: buttonColor }}
                  >
                    Adicionar à Sacola
                  </Button>
                );
              })()}
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL DE CHECKOUT PROMOCIONAL PRÓPRIO (MODO 3) */}
      {selectedPromoOffer && storeData && (
        <PromotionalCheckoutModal
          isOpen={isPromoCheckoutOpen}
          onClose={() => {
            setIsPromoCheckoutOpen(false);
            setSelectedPromoOffer(null);
          }}
          offer={selectedPromoOffer}
          storeData={storeData}
          onOrderCompleted={(order, celebrationMessage) => {
            setCompletedOrder(order);
            setCustomerOrders(prev => {
              const exists = prev.some(o => o.id === order.id);
              if (exists) return prev;
              return [order, ...prev];
            });
            if (celebrationMessage) {
              showToast({
                type: 'success',
                title: '🎉 Parabéns!',
                message: celebrationMessage,
              });
            }
          }}
        />
      )}

      {/* Navegação Inferior Mobile */}
      {!isCheckoutOpen && !isPromoCheckoutOpen && !addressFlow.open && (
        <MobileNavigation
          type="customer"
          activeTab={navTab}
          onTabChange={(tab) => {
            const t = tab as CustomerTab;
            if (t === 'profile') setProfilePage('menu');
            if (t === 'home' && navTab === 'home') { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* jsdom */ } }
            setNavTab(t);
          }}
          cartCount={cartTotalCount}
          profileBadge={unreadCount}
          primaryColor={buttonColor}
        />
      )}

      <AddressFlow
        open={addressFlow.open}
        mode={addressFlow.mode}
        userId={userKey}
        color={buttonColor}
        onClose={() => { continueAfterAddressRef.current = false; setAddressFlow(a => ({ ...a, open: false })); }}
        onSelected={(a) => {
          applySavedAddress(a);
          if (addressFlow.mode === 'select') setFulfillmentType('DELIVERY');
          if (continueAfterAddressRef.current) {
            continueAfterAddressRef.current = false;
            setAddressFlow(f => ({ ...f, open: false }));
            setIsCheckoutOpen(true);
          }
        }}
      />

      <BottomSheet open={pushPromptOpen} onClose={() => { markPushPromptShown(kv); setPushPromptOpen(false); }}>
        <div className="text-center space-y-3 px-2 pb-1" data-testid="push-prompt">
          <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center" style={{ backgroundColor: `${buttonColor}1a`, color: buttonColor }}>
            <BellRing className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-extrabold text-gray-900">Acompanhe seu pedido em tempo real</h3>
          <p className="text-sm text-gray-600">Ative as notificações para saber quando o pedido for confirmado, sair para entrega e chegar.</p>
          <button type="button" data-testid="push-enable" className="w-full h-12 rounded-xl text-white font-extrabold text-sm cursor-pointer" style={{ backgroundColor: buttonColor }}
            onClick={async () => {
              markPushPromptShown(kv);
              setPushPromptOpen(false);
              try {
                const r = await Notification.requestPermission();
                showToast(r === 'granted'
                  ? { type: 'success', title: 'Notificações ativadas', message: 'Vamos avisar cada etapa do seu pedido.' }
                  : { type: 'info', title: 'Tudo bem', message: 'Você pode ativar depois em Perfil > Configurações.' });
              } catch { /* sem suporte */ }
            }}>
            Ativar notificações
          </button>
          <button type="button" data-testid="push-later" className="w-full h-11 rounded-xl text-sm font-bold text-gray-600 cursor-pointer" onClick={() => { markPushPromptShown(kv); setPushPromptOpen(false); }}>
            Não ativar agora
          </button>
        </div>
      </BottomSheet>
    </div>
  );
};
