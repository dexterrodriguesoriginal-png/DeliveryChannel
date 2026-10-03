export type RoleId = 
  | 'CEO' 
  | 'SUPER_ADMIN' 
  | 'OWNER' 
  | 'MANAGER' 
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
  pixKey?: string;
}

export interface Tenant {
  id: string;
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
  | 'outros';

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
  title: string;
  subtitle?: string;
  description?: string;
  badge?: string;
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
  product?: Product;
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

export interface Coupon {
  id: string;
  tenantId: string;
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minOrderValue?: number;
  usageLimit?: number; // Quantidade máxima de cupons (ex: 20)
  usageLimitPerCustomer?: number; // Limite por cliente (1 ou ilimitado)
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

export type FulfillmentType = 'DELIVERY' | 'PICKUP';
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
  notes?: string;
  prepTimeMinutes?: number;
  status: OrderStatus;
  statusHistory: OrderStatusHistoryItem[];
  createdAt: string;
  updatedAt: string;
  driverId?: string;
  driverName?: string;
  origin: CustomerOrigin;
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
  status?: DriverStatus;
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

export interface TeamMember {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  email: string;
  role: RoleId;
  phone?: string;
  status: 'ACTIVE' | 'INVITED' | 'INACTIVE';
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
