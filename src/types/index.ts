export type RoleId = 
  | 'CEO' 
  | 'SUPER_ADMIN' 
  | 'OWNER' 
  | 'MANAGER' 
  | 'WAITER'
  | 'OPERATOR' 
  | 'CASHIER' 
  | 'DELIVERY_MANAGER' 
  | 'DRIVER'
  | 'CUSTOMER';

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  role: RoleId | null;
  tenantId?: string; // Assigned tenant if store staff/owner
}

export type TenantStatus = 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'BLOCKED' | 'PENDING' | 'INACTIVE';
export type PlanTier = 'FREE_TRIAL' | 'STANDARD' | 'PRO' | 'ENTERPRISE';
export type BusinessType =
  | 'RESTAURANTE' | 'BAR' | 'LANCHONETE_CAFE' | 'PIZZARIA' | 'MERCADO' | 'ADEGA'
  | 'ROUPAS' | 'PERFUMARIA' | 'SALAO_BARBEARIA' | 'CONSTRUCAO' | 'AMBULANTE' | 'OUTRO';

export interface TenantEmailConfirmation {
  id: string;
  tenantId: string;
  userId: string;
  email: string;
  status: 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';
  requestedAt: string;
  expiresAt: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantTheme {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  cardColor: string;
  buttonColor?: string;
  textColor: string;
  borderRadius: string; // e.g. '0.75rem', '1rem', '1.25rem'
  fontFamily?: string;
  bannerUrl?: string;
  logoUrl?: string;
  storeName: string;
  tagline: string;
}

export interface TenantSettings {
  isOpen: boolean;
  minOrderValue: number;
  deliveryFee: number;
  freeDeliveryThreshold?: number;
  estimatedDeliveryTime: string; // e.g. '25-40 min'
  defaultPrepTimeMinutes?: number; // Tempo de preparo padrão em minutos (1 a 240 min, padrão: 30)
  address: string;
  city: string;
  phoneWhatsApp: string;
  /** Somente modo legacy-020 (tenant_settings.pix_key). No N1–N6 a chave fica em tenant_payment_settings. */
  pixKey?: string;
  // Modalidades de atendimento e desconto para retirada (proposta 20261013000100; opcionais = compat)
  deliveryEnabled?: boolean; // padrão true
  pickupEnabled?: boolean; // padrão true
  pickupDiscountEnabled?: boolean; // padrão false
  pickupDiscountPercent?: number; // 0–50, padrão 0
  pickupDiscountExcludePromotional?: boolean; // padrão false
  pickupDiscountExcludedProductIds?: string[];
  pickupDiscountExcludedOfferIds?: string[];
  pickupInstructions?: string;
}

export interface Tenant {
  id: string;
  businessType?: BusinessType | null;
  slug: string;
  name: string;
  legalName: string;
  document: string; // CNPJ / CPF
  phone: string;
  email: string;
  category: 'ADEGA' | 'BURGER' | 'PIZZARIA' | 'MERCADO' | 'RESTAURANTE';
  status: TenantStatus;
  planTier: PlanTier;
  createdAt: string;
  theme: TenantTheme;
  settings: TenantSettings;
  // Metrics for CEO
  gmvMonthly: number;
  activeOrdersToday: number;
  totalCustomers: number;
  isDemo?: boolean;
}

export type CustomerOrigin = 
  | 'marketplace' 
  | 'qr_code' 
  | 'whatsapp' 
  | 'instagram' 
  | 'google' 
  | 'indicacao' 
  | 'direto' 
  | 'direct'
  | 'promotional_checkout'
  | 'outros';

/**
 * Origem gravada em orders.origin pelo servidor: além das origens de cliente,
 * 'storefront' (checkout v2 N2), 'storefront_promo' (checkout promocional N6) e 'pos' (PDV N2).
 */
export type OrderOrigin = CustomerOrigin | 'storefront' | 'storefront_promo' | 'pos';

export interface Customer {
  id: string;
  tenantId: string;
  userId?: string;
  name: string;
  phone: string;
  email?: string;
  origin: CustomerOrigin;
  totalOrders: number;
  ltvAmount: number;
  firstOrderDate: string;
  lastOrderDate: string;
  consentLgpd: boolean;
  isDemo?: boolean;
}

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  order: number;
  isActive: boolean;
  createdAt?: string;
  isDemo?: boolean;
  station?: 'KITCHEN' | 'BAR' | null;
}

export interface Product {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  promotionalPrice?: number;
  cost?: number;
  sku?: string;
  imageUrl: string;
  isAvailable: boolean;
  isActive: boolean;
  isFeatured?: boolean;
  stockQuantity: number;
  minStock?: number;
  unit: string; // 'un', 'kg', 'lata', 'garrafa', 'porção'
  createdAt?: string;
  updatedAt?: string;
  isDemo?: boolean;
  optionGroups?: ProductOptionGroup[];
}

export type ProductOptionGroupType = 'STANDARD' | 'FLAVOR_SPLIT';
export type ProductOptionPricingRule = 'SUM' | 'HIGHEST' | 'AVERAGE';

export interface ProductOption {
  id: string;
  tenantId: string;
  groupId: string;
  name: string;
  extraPriceCents: number;
  active: boolean;
  soldOut: boolean;
  sort: number;
}

export interface ProductOptionGroup {
  id: string;
  tenantId: string;
  name: string;
  type: ProductOptionGroupType;
  minSelect: number;
  maxSelect: number;
  allowRepeat: boolean;
  pricingRule: ProductOptionPricingRule;
  active: boolean;
  sort: number;
  options: ProductOption[];
}

export interface SelectedProductOption {
  groupId: string;
  optionId: string;
  qty: number;
  fraction?: number | null;
}

export interface OrderItemOption {
  groupId: string;
  optionId: string;
  groupName: string;
  optionName: string;
  qty: number;
  unitPriceCents: number;
  fraction?: number | null;
}

export type CardFormat = 'HORIZONTAL' | 'SQUARE' | 'QUADRADO' | 'VERTICAL';
export type CardMediaType = 'IMAGE' | 'VIDEO';
export type CardStatus = 'ACTIVE' | 'SCHEDULED' | 'PAUSED' | 'EXPIRED';
export type CardDisplayMode = 'FULL_MEDIA' | 'EDITABLE_CARD';
export type CardDestination = 'BANNER_ONLY' | 'PRODUCT' | 'CUSTOM_OFFER';
export type PromoCardModel = 'HERO' | 'HIGHLIGHT' | 'ANIMATED';

export interface PromotionalCard {
  id: string;
  tenantId: string;
  source?: 'OFFER' | 'CAMPAIGN_CARD';
  /** N6: card de campanha (campaign_cards) — o checkout promocional usa p_card_id/p_campaign_id. */
  campaignId?: string;
  campaignCardId?: string;
  /** N6: calculado pelo servidor (limite, estoque, produto ativo). */
  promoAvailable?: boolean;
  promoFulfillment?: 'DELIVERY' | 'PICKUP' | 'BOTH';
  promoMaxQtyPerOrder?: number;
  /** N3/N4: asset publicado em marketing-public referenciado por offers.media_asset_id (n1n6). */
  mediaAssetId?: string;
  title: string;
  subtitle?: string;
  description?: string;
  badge?: string;
  ctaText?: string;
  cardFormat?: CardFormat;
  mediaType?: CardMediaType;
  displayMode?: CardDisplayMode;
  cardModel?: PromoCardModel;
  autoOverlay?: boolean;
  destinationType?: CardDestination;
  mediaUrl?: string;
  imageUrl?: string; // espelho de mediaUrl para compatibilidade
  durationSeconds?: number; // para imagens (ex: 5s, 8s, 10s...)
  videoDuration?: number; // duração real detectada para vídeos (ex: 8.4s)
  detectedWidth?: number;
  detectedHeight?: number;
  aspectRatio?: string;
  discountPercentage?: number;
  originalPrice?: number;
  promotionalPrice?: number;
  productId?: string;
  linkUrl?: string;
  internalLink?: string;
  startDate?: string;
  endDate?: string;
  startAt?: string;
  endAt?: string;
  noEndDate?: boolean;
  order: number;
  backgroundColor?: string;
  accentColor?: string;
  isActive: boolean;
  computedStatus?: CardStatus;
  internalTitle?: string;
  internalDescription?: string;
  
  // Checkout Promocional Próprio (Modo 3 - Sem depender de produto de catálogo)
  hasPromoCheckout?: boolean;
  promoTitle?: string;
  promoDescription?: string;
  promoPrice?: number;
  promoOriginalPrice?: number;
  promoDiscountPercentage?: number;
  promoUnit?: string;
  promoMinQuantity?: number;
  promoMaxQuantityPerCustomer?: number;
  promoNotes?: string;
  promoFulfillmentTypes?: ('DELIVERY' | 'PICKUP')[];
  promoPaymentMethods?: ('PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'CASH')[];
  promoCouponCode?: string;
  promoUsageLimit?: number;
  promoTimesUsed?: number;
  isExhausted?: boolean;
  remainingUses?: number | null;

  createdAt?: string;
  updatedAt?: string;
  isDemo?: boolean;
}

export type Offer = PromotionalCard;

export type PromotionDiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'PROMOTIONAL_PRICE';

// --- GERENCIADOR PROFISSIONAL DE CAMPANHAS PROMOCIONAIS (COMANDO MASTER) ---
export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'SOLD_OUT' | 'ARCHIVED';

export type CampaignCardModel = 'FULL_MEDIA' | 'PROMO_CARD' | 'OFFER_CARD';

export type CampaignCardDestination = 'PRODUCT' | 'BANNER_ONLY' | 'CUSTOM_OFFER';

export interface CampaignCard {
  id: string;
  campaignId: string;
  tenantId: string;
  displayOrder: number;
  model: CampaignCardModel; // MODELO 1 (FULL MEDIA), MODELO 2 (PROMO CARD), MODELO 3 (OFFER CARD)
  mediaType: CardMediaType; // 'IMAGE' | 'VIDEO'
  mediaUrl: string;
  storagePath?: string;
  durationSeconds: number; // para imagens (ex: 5s, 8s, 10s...)
  videoDuration?: number; // para vídeos: reproduz pela duração real do arquivo
  title?: string;
  subtitle?: string;
  description?: string;
  badge?: string;
  ctaText?: string;
  autoOverlay: boolean; // Sobreposição automática: OFF por padrão no Full Media
  destinationType: CampaignCardDestination;
  productId?: string;
  product?: Partial<Product> & { id: string; name: string; price: number; isAvailable: boolean };
  couponId?: string;
  coupon?: {
    id: string;
    code: string;
    discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
    discountValue: number;
    usageLimit?: number;
    timesUsed: number;
    remainingUses?: number | null;
    isExhausted?: boolean;
  };
  
  // Oferta Personalizada (Custom Offer com Checkout Real)
  customTitle?: string;
  customDescription?: string;
  customPrice?: number;
  customPromotionalPrice?: number;
  customDiscountPercentage?: number;
  customQuantityAvailable?: number;
  customUnit?: string;
  customNotes?: string;

  backgroundColor?: string;
  accentColor?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  status: CampaignStatus;
  startAt?: string;
  endAt?: string;
  noEndDate: boolean;
  timezone: string;
  createdBy?: string;
  publishedAt?: string;
  endedAt?: string;
  isActive: boolean;
  displayOrder: number;
  cards: CampaignCard[];
  createdAt?: string;
  updatedAt?: string;
}

export type CampaignAnalyticsEventType = 
  | 'CAMPAIGN_IMPRESSION'
  | 'CARD_IMPRESSION'
  | 'CARD_CLICK'
  | 'PRODUCT_OPEN'
  | 'ADD_TO_CART'
  | 'CHECKOUT_STARTED'
  | 'CHECKOUT_COMPLETED'
  | 'COUPON_VIEWED'
  | 'COUPON_APPLIED'
  | 'COUPON_REJECTED'
  | 'CAMPAIGN_SOLD_OUT'
  | 'CAMPAIGN_EXPIRED';

export interface CampaignCardMetric {
  cardId: string;
  title: string;
  model: string;
  mediaType: string;
  impressions: number;
  clicks: number;
  ctr: number;
  checkouts: number;
  orders: number;
  conversionRate: number;
  revenue: number;
}

export interface CampaignAnalyticsSummary {
  campaignId?: string;
  campaignName?: string;
  impressions: number;
  clicks: number;
  ctr: number;
  productsOpened: number;
  cartAdditions: number;
  checkoutsStarted: number;
  ordersCompleted: number;
  conversionRate: number;
  couponsUsed: number;
  revenue: number;
  averageTicket: number;
  discountsGranted: number;
  cardMetrics: CampaignCardMetric[];
}

export interface PromotionCarouselItem {
  id: string;
  carouselId: string;
  productId: string;
  tenantId: string;
  product?: Product;
  discountType: PromotionDiscountType;
  discountValue: number;
  promotionalPrice: number;
  calculatedDiscountPercentage: number;
  showDiscountBadge: boolean;
  showPromotionalPrice: boolean;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
  displayOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PromotionCarousel {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  isActive: boolean;
  showInStore: boolean;
  displayOrder: number;
  /** N4: janela de validade da campanha inteira (start_at/end_at). */
  startDate?: string;
  endDate?: string;
  items: PromotionCarouselItem[];
  createdAt?: string;
  updatedAt?: string;
}

export type CouponDiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';

export interface CouponRedemption {
  id: string;
  tenantId: string;
  couponId: string;
  customerId?: string;
  orderId?: string;
  redemptionNumber: number;
  discountApplied: number;
  createdAt: string;
}

export type CouponStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface Coupon {
  id: string;
  tenantId: string;
  code: string;
  /** N2 */
  description?: string;
  maxDiscountAmount?: number;
  firstOrderOnly?: boolean;
  status?: CouponStatus;
  campaignId?: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minOrderValue?: number;
  usageLimit?: number; // Quantidade máxima de cupons (ex: 20)
  usageLimitPerCustomer?: number; // Limite por cliente (1 ou ilimitado)
  /** D1: acumula com o desconto de retirada (padrão false). Coluna proposta coupons.stack_with_pickup_discount. */
  stackWithPickupDiscount?: boolean;
  timesUsed: number;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RedeemCouponResult {
  success: boolean;
  isExhausted?: boolean;
  couponId?: string;
  couponCode?: string;
  redemptionNumber?: number;
  discountAmount?: number;
  remainingUses?: number | null;
  message: string;
}

export interface ValidateCouponResult {
  isValid: boolean;
  coupon?: Coupon;
  discountAmount: number;
  remainingUses?: number | null;
  message: string;
}

export type OrderStatus = 
  | 'PENDING' 
  | 'CONFIRMED' 
  | 'PREPARING' 
  | 'READY' 
  | 'WAITING_FOR_DRIVER'
  | 'OUT_FOR_DELIVERY' 
  | 'DELIVERED' 
  | 'CANCELLED';

export type FulfillmentType = 'DELIVERY' | 'PICKUP' | 'DINE_IN';
export type PaymentStatus = 'PENDING' | 'PAID' | 'PAYMENT_ON_DELIVERY' | 'REFUNDED';

export interface OrderStatusHistoryItem {
  status: OrderStatus;
  timestamp: string;
  note?: string;
  changedBy: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes?: string;
  unit?: string;
  options?: OrderItemOption[];
}

export interface DeliveryAddressDetails {
  cep?: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state?: string;
  reference?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
}

export interface Order {
  id: string;
  tenantId: string;
  customerId?: string;
  orderNumber: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  deliveryAddress: string;
  addressDetails?: DeliveryAddressDetails;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  totalAmount: number;
  paymentMethod: 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'CASH';
  paymentStatus: PaymentStatus;
  fulfillmentType: FulfillmentType;
  /** Identificador da comanda e metadados da rodada do salão (dados staff-only). */
  tabId?: string;
  tableLabel?: string;
  roundNo?: number;
  /** Parcela do desconto referente à retirada (proposta orders.pickup_discount). `discount` = total de descontos. */
  pickupDiscount?: number;
  /** Parcela do desconto referente ao cupom. */
  couponDiscount?: number;
  idempotencyKey?: string;
  notes?: string;
  prepTimeMinutes?: number;
  status: OrderStatus;
  statusHistory: OrderStatusHistoryItem[];
  createdAt: string;
  updatedAt: string;
  driverId?: string;
  /** 1500: horário do aceite/designação do entregador. */
  driverAcceptedAt?: string;
  /** 1500: horário da retirada confirmada com código. */
  pickedUpAt?: string;
  /** 1700: quanto o entregador recebe (pedidos antigos: ausente → usar deliveryFee). */
  driverPayout?: number;
  /** 1700: parte da taxa de entrega paga pela loja. */
  storeDeliveryShare?: number;
  driverName?: string;
  offerId?: string;
  origin: OrderOrigin;
  couponCode?: string;
  campaignId?: string;
  cardId?: string;
  isDemo?: boolean;
}

export type InventoryMovementType = 'ENTRADA' | 'SAIDA' | 'AJUSTE' | 'VENDA' | 'ESTORNO';

export interface InventoryMovement {
  id: string;
  tenantId: string;
  productId: string;
  productName: string;
  quantity: number; // e.g. -2 for sale, +2 for reversal, +10 for purchase
  type: InventoryMovementType;
  referenceId?: string; // orderId or manual ref
  reason: string;
  previousStock: number;
  newStock: number;
  timestamp: string;
  createdByName?: string;
}

export interface InternalNotification {
  id: string;
  tenantId: string;
  title: string;
  message: string;
  type: 'ORDER_NEW' | 'ORDER_STATUS' | 'STOCK_ALERT' | 'SYSTEM';
  read: boolean;
  orderId?: string;
  createdAt: string;
}

export interface CartItem {
  id: string;
  productId: string;
  productName: string;
  unitPrice: number;
  promotionalPrice?: number;
  quantity: number;
  notes?: string;
  imageUrl?: string;
  unit?: string;
}

export interface Cart {
  tenantId: string;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  fulfillmentType: FulfillmentType;
}

export type DriverStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'ON_DELIVERY' | 'SUSPENDED';

export interface Driver {
  id: string;
  tenantId: string;
  userId?: string;
  name: string;
  phone: string;
  document?: string;
  vehicle: string;
  vehicleType?: string;
  vehicleModel?: string;
  plate: string;
  /** Disponibilidade (drivers.status). */
  status?: DriverStatus;
  /** Aprovação na loja (drivers.approval_status, 0700). UNKNOWN = não confirmada (sem fallback). */
  approvalStatus?: DriverApprovalStatus | 'UNKNOWN';
  isOnline: boolean;
  activeOrderId?: string;
  completedDeliveriesToday: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TeamInvite {
  id: string;
  tenantId: string;
  email: string;
  roleId: RoleId;
  invitedBy: string;
  invitedByName?: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
}

/** drivers.approval_status (proposta 0700). */
export type DriverApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'REMOVED';

export type TeamMemberStatus = 'ACTIVE' | 'INVITED' | 'PENDING' | 'SUSPENDED' | 'INACTIVE';

export interface TeamMember {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  email: string;
  role: RoleId;
  phone?: string;
  /** tenant_users.status (vínculo de acesso). Não confundir com drivers.approval_status. */
  status: TeamMemberStatus;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: RoleId;
  tenantId?: string;
  tenantName?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details: string;
  previousValue?: string;
  newValue?: string;
  ipAddress: string;
  isCeoSupport: boolean;
  timestamp: string;
}

export interface AppEvent {
  id: string;
  eventName: string;
  tenantId: string;
  customerId?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface Sponsor {
  id: string;
  brandName: string;
  campaignTitle: string;
  bannerUrl: string;
  targetCategory: string;
  cpcValue: number; // Cost per click
  totalClicks: number;
  budgetAllocated: number;
  status: 'ACTIVE' | 'PAUSED';
}

// ---------------- N1–N6 (ativos só com VITE_BACKEND_SCHEMA=n1n6) ----------------

/** Configuração de recebimento PIX (N1: tabela tenant_payment_settings; só OWNER/MANAGER). */
export interface TenantPaymentSettings {
  tenantId: string;
  pixEnabled: boolean;
  pixKeyType?: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
  /** Chave mascarada para exibição (a chave completa nunca é devolvida ao navegador após salva). */
  pixKeyMasked?: string;
  merchantName?: string;
  merchantCity?: string;
  updatedAt?: string;
}

/** Validação de cupom pelo servidor (validate_coupon / validate_coupon_pos — prévia, não consome). */
export interface CouponPreview {
  valid: boolean;
  reason?: string | null;
  message: string;
  code?: string | null;
  discount: number;
  eligibleBase: number;
}

/** BR Code PIX gerado no servidor por pedido (get_order_pix_payload). */
export interface OrderPixPayload {
  orderId: string;
  orderNumber: number;
  amount: number;
  merchantName: string;
  brcode: string;
}

export type CampaignCardCommercialMode = 'OFFER' | 'PRODUCT' | 'CUSTOM' | 'BANNER_ONLY';

/** Gestão de campanhas (N5) — tabelas campaigns / campaign_cards (somente OWNER/MANAGER). */
export type CampaignN5Status = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'ARCHIVED';

export interface CampaignN5 {
  id: string;
  tenantId: string;
  name: string;
  publicTitle?: string;
  internalNotes?: string;
  status: CampaignN5Status;
  startAt?: string;
  endAt?: string;
  timezone: string;
  channel?: 'STOREFRONT' | 'QR' | 'LINK' | 'WHATSAPP' | 'EMAIL' | 'SOCIAL';
  shareSlug?: string;
  displayOrder: number;
  publishedAt?: string;
  endedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CampaignCardN5 {
  id: string;
  tenantId: string;
  campaignId: string;
  commercialMode: CampaignCardCommercialMode;
  offerId?: string;
  productId?: string;
  couponId?: string;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  mediaAssetId?: string;
  autoOverlay: boolean;
  showCouponCode: boolean;
  cardPromotionalPrice?: number;
  customName?: string;
  customPrice?: number;
  customOriginalPrice?: number;
  customUsageLimit?: number;
  customUsageLimitPerCustomer?: number;
  /** Somente leitura (contador do servidor). */
  customTimesUsed: number;
  customFulfillment?: 'DELIVERY' | 'PICKUP' | 'BOTH';
  customMaxQtyPerOrder?: number;
  displayOrder: number;
  isActive: boolean;
  startAt?: string;
  endAt?: string;
}

/** Métricas de campanha (get_campaign_metrics): receita vem de orders válidos, nunca do navegador. */
export interface CampaignMetrics {
  campaignId: string;
  from: string;
  to: string;
  funnelEstimate: Record<string, number>;
  funnelIsEstimate: true;
  orders: { validOrders: number; revenue: number; paidRevenue: number; invalidatedOrders: number };
  revenueSource: 'orders';
}

/** Eventos aceitos por track_campaign_event (N5). PURCHASE só é gravado pelo servidor. */
export type TrackableCampaignEvent =
  | 'IMPRESSION'
  | 'CARD_VIEW'
  | 'CARD_CLICK'
  | 'VIDEO_PLAY'
  | 'COUPON_COPY'
  | 'CHECKOUT_START';
