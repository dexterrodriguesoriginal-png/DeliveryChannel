import type { CustomerOrigin } from '../../types';
import type {
  CreateCustomerInput,
  CustomerCrmItem,
  CustomerCrmOrderHistoryItem,
} from '../../repositories/customerRepository';

export type CustomerCrmSegment = 'VIP' | 'RECORRENTE' | 'NOVO' | 'INATIVO' | 'SEM_PEDIDOS';

export type CustomerRegistrationKind = 'APP' | 'MANUAL';

export type CustomerCrmSortBy =
  | 'RECENT_CREATED'
  | 'LAST_ORDER_DESC'
  | 'TOTAL_SPENT_DESC'
  | 'TOTAL_ORDERS_DESC'
  | 'TICKET_AVG_DESC'
  | 'NAME_ASC';

export interface CustomerOriginMeta {
  code: string;
  label: string;
  shortLabel: string;
  category: 'DIGITAL' | 'DIRETO_BALCAO' | 'EXTERNO';
  variant: 'brand' | 'success' | 'warning' | 'info' | 'neutral';
}

export interface CustomerSegmentMeta {
  segment: CustomerCrmSegment;
  label: string;
  description: string;
  recommendation: string;
  tone: 'emerald' | 'blue' | 'amber' | 'rose' | 'slate';
}

export interface CustomerCrmOverviewMetrics {
  totalCustomers: number;
  customersWithOrders: number;
  recurringCustomers: number;
  vipCustomers: number;
  newCustomers: number;
  inactiveCustomers: number;
  withoutOrdersCustomers: number;
  manualCustomers: number;
  appCustomers: number;
  contactConsentCount: number;
  lgpdConsentCount: number;
  totalRevenue: number;
  totalOrdersCount: number;
  averageTicket: number;
  averageLtvPerBuyer: number;
}

export interface CustomerCrmFilterState {
  search?: string;
  origin?: string;
  registrationKind?: 'ALL' | CustomerRegistrationKind;
  segment?: 'ALL' | CustomerCrmSegment;
  consent?: 'ALL' | 'WHATSAPP_ALLOWED' | 'NO_WHATSAPP' | 'LGPD_PENDING';
  tag?: string;
  sortBy?: CustomerCrmSortBy;
}

export interface CustomerOrderInsights {
  totalOrdersCount: number;
  validOrdersCount: number;
  cancelledOrdersCount: number;
  refundedOrdersCount: number;
  pendingOrdersCount: number;
  validTotalSpent: number;
  averageTicket: number;
  firstOrderAt?: string;
  lastOrderAt?: string;
  daysSinceLastOrder: number | null;
  preferredFulfillment?: string;
  preferredPaymentMethod?: string;
  topItems: Array<{ name: string; quantity: number; totalSpent: number }>;
}

/**
 * Regra financeira canônica para considerar uma compra válida e com gasto efetivo:
 * - Status CANCELLED não é válido.
 * - PaymentStatus REFUNDED não é válido (estornado).
 * - PaymentStatus PENDING não é contabilizado como gasto efetivo realizado.
 * - PaymentStatus PAYMENT_ON_DELIVERY só conta quando o pagamento for efetivamente registrado como PAID.
 */
export function isCrmOrderFinanciallyValid(order: {
  status?: string;
  paymentStatus?: string;
}): boolean {
  const status = String(order.status || '').toUpperCase();
  if (status === 'CANCELLED') return false;

  const paymentStatus = order.paymentStatus ? String(order.paymentStatus).toUpperCase() : undefined;
  if (paymentStatus === 'REFUNDED') return false;
  if (paymentStatus === 'PENDING') return false;
  if (paymentStatus === 'PAYMENT_ON_DELIVERY') return false;

  return true;
}

export const SUGGESTED_CRM_TAGS: string[] = [
  'VIP',
  'Recorrente',
  'Prefere Retirada',
  'Prefere Entrega',
  'Atendimento Balcão',
  'Cliente Corporativo',
  'Bom Pagador',
  'Aniversariante',
];

export const CUSTOMER_ORIGINS_META: Record<string, CustomerOriginMeta> = {
  qr_code: {
    code: 'qr_code',
    label: 'Link / QR Code',
    shortLabel: 'QR Code',
    category: 'DIGITAL',
    variant: 'brand',
  },
  storefront: {
    code: 'storefront',
    label: 'Loja online',
    shortLabel: 'Loja online',
    category: 'DIGITAL',
    variant: 'brand',
  },
  storefront_promo: {
    code: 'storefront_promo',
    label: 'Loja online (Oferta)',
    shortLabel: 'Loja online',
    category: 'DIGITAL',
    variant: 'brand',
  },
  promotional_checkout: {
    code: 'promotional_checkout',
    label: 'Checkout promocional',
    shortLabel: 'Checkout',
    category: 'DIGITAL',
    variant: 'brand',
  },
  whatsapp: {
    code: 'whatsapp',
    label: 'WhatsApp',
    shortLabel: 'WhatsApp',
    category: 'DIRETO_BALCAO',
    variant: 'success',
  },
  pos: {
    code: 'pos',
    label: 'Balcão / PDV',
    shortLabel: 'PDV',
    category: 'DIRETO_BALCAO',
    variant: 'neutral',
  },
  direct: {
    code: 'direct',
    label: 'Balcão / Acesso direto',
    shortLabel: 'Direto',
    category: 'DIRETO_BALCAO',
    variant: 'neutral',
  },
  direto: {
    code: 'direto',
    label: 'Balcão / Acesso direto',
    shortLabel: 'Direto',
    category: 'DIRETO_BALCAO',
    variant: 'neutral',
  },
  indicacao: {
    code: 'indicacao',
    label: 'Indicação',
    shortLabel: 'Indicação',
    category: 'DIRETO_BALCAO',
    variant: 'success',
  },
  marketplace: {
    code: 'marketplace',
    label: 'Marketplace',
    shortLabel: 'Marketplace',
    category: 'EXTERNO',
    variant: 'warning',
  },
  instagram: {
    code: 'instagram',
    label: 'Instagram',
    shortLabel: 'Instagram',
    category: 'EXTERNO',
    variant: 'info',
  },
  google: {
    code: 'google',
    label: 'Google',
    shortLabel: 'Google',
    category: 'EXTERNO',
    variant: 'neutral',
  },
  outros: {
    code: 'outros',
    label: 'Outros canais',
    shortLabel: 'Outros',
    category: 'EXTERNO',
    variant: 'neutral',
  },
};

export const CUSTOMER_SEGMENT_META: Record<CustomerCrmSegment, CustomerSegmentMeta> = {
  VIP: {
    segment: 'VIP',
    label: 'VIP',
    description: 'Alta recorrência ou alto valor acumulado na loja',
    recommendation: 'Priorize atendimento personalizado, pré-lançamentos e mimos de fidelidade.',
    tone: 'emerald',
  },
  RECORRENTE: {
    segment: 'RECORRENTE',
    label: 'Recorrente',
    description: 'Cliente ativo com 2 ou mais compras concluídas',
    recommendation: 'Estimule aumento de ticket médio com combos ou ofertas da semana.',
    tone: 'blue',
  },
  NOVO: {
    segment: 'NOVO',
    label: '1ª Compra',
    description: 'Realizou o primeiro pedido recentemente',
    recommendation: 'Ótimo momento para pós-venda e incentivo ao segundo pedido.',
    tone: 'amber',
  },
  INATIVO: {
    segment: 'INATIVO',
    label: 'Inativo (+45d)',
    description: 'Já comprou na loja, mas está há mais de 45 dias sem pedir',
    recommendation: 'Considere contato de reativação caso o cliente tenha autorizado WhatsApp.',
    tone: 'rose',
  },
  SEM_PEDIDOS: {
    segment: 'SEM_PEDIDOS',
    label: 'Sem compras',
    description: 'Cadastrado na base da loja, ainda sem pedidos concluídos',
    recommendation: 'Apresente o cardápio digital ou registre o primeiro pedido pelo PDV.',
    tone: 'slate',
  },
};

export function resolveCustomerOriginMeta(origin?: string | null): CustomerOriginMeta {
  if (!origin) {
    return CUSTOMER_ORIGINS_META.direct;
  }
  return (
    CUSTOMER_ORIGINS_META[origin] || {
      code: origin,
      label: origin,
      shortLabel: origin,
      category: 'EXTERNO',
      variant: 'neutral',
    }
  );
}

export function normalizeCustomerPhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return digits.slice(2);
  }
  return digits;
}

export function formatCustomerPhone(phone: string): string {
  const local = normalizeCustomerPhone(phone);
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return phone || '—';
}

export function customerWhatsAppLink(
  phone: string,
  contactConsent: boolean,
  customMessage?: string
): string | null {
  if (!contactConsent) return null;
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 13) return null;
  const base = `https://wa.me/${digits}`;
  if (customMessage && customMessage.trim()) {
    return `${base}?text=${encodeURIComponent(customMessage.trim())}`;
  }
  return base;
}

export function computeDaysSinceLastOrder(
  lastOrderAt?: string | null,
  referenceDate: Date = new Date()
): number | null {
  if (!lastOrderAt) return null;
  const parsed = new Date(lastOrderAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const diffMs = referenceDate.getTime() - parsed.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export function classifyCustomerSegment(
  customer: Pick<CustomerCrmItem, 'totalOrders' | 'totalSpent' | 'lastOrderAt' | 'tags'>,
  referenceDate: Date = new Date()
): CustomerCrmSegment {
  const orders = Number(customer.totalOrders || 0);
  const spent = Number(customer.totalSpent || 0);
  const days = computeDaysSinceLastOrder(customer.lastOrderAt, referenceDate);
  const hasVipTag = (customer.tags || []).some(
    (t) => t.trim().toUpperCase() === 'VIP' || t.trim().toUpperCase() === 'CLIENTE VIP'
  );

  if (orders <= 0) {
    return hasVipTag ? 'VIP' : 'SEM_PEDIDOS';
  }

  if (days !== null && days > 45) {
    return 'INATIVO';
  }

  if (orders >= 5 || spent >= 500 || hasVipTag) {
    return 'VIP';
  }

  if (orders >= 2) {
    return 'RECORRENTE';
  }

  return 'NOVO';
}

export function computeCustomerAverageTicket(
  customer: Pick<CustomerCrmItem, 'totalOrders' | 'totalSpent'>
): number {
  const orders = Number(customer.totalOrders || 0);
  const spent = Number(customer.totalSpent || 0);
  if (orders <= 0 || spent <= 0) return 0;
  return Math.round(((spent / orders) + Number.EPSILON) * 100) / 100;
}

export function resolveRegistrationKind(
  customer: Pick<CustomerCrmItem, 'isManual'>
): CustomerRegistrationKind {
  return customer.isManual ? 'MANUAL' : 'APP';
}

export function sanitizeCustomerTags(rawTags: string | string[]): string[] {
  const list = Array.isArray(rawTags) ? rawTags : String(rawTags || '').split(',');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const clean = item.trim().slice(0, 32);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 10) break;
  }
  return out;
}

export function validateManualCustomerInput(
  input: CreateCustomerInput,
  isEditing = false
): { valid: boolean; error?: string; normalizedPhone: string } {
  const name = String(input.name || '').trim();
  if (name.length < 2 || name.length > 255) {
    return {
      valid: false,
      error: 'Informe o nome do cliente (entre 2 e 255 caracteres).',
      normalizedPhone: '',
    };
  }

  const digits = String(input.phone || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) {
    return {
      valid: false,
      error: 'Informe um telefone válido com DDD (10 a 13 dígitos).',
      normalizedPhone: digits,
    };
  }

  const email = String(input.email || '').trim();
  if (email) {
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return {
        valid: false,
        error: 'Informe um endereço de e-mail válido.',
        normalizedPhone: digits,
      };
    }
  }

  if (!isEditing && !input.consentLgpd) {
    return {
      valid: false,
      error: 'Registre o consentimento LGPD antes de cadastrar um cliente manualmente.',
      normalizedPhone: digits,
    };
  }

  const allowedOrigins: CustomerOrigin[] = [
    'whatsapp',
    'direct',
    'direto',
    'indicacao',
    'outros',
  ];
  if (!isEditing && input.origin && !allowedOrigins.includes(input.origin)) {
    return {
      valid: false,
      error: 'Selecione um canal de origem válido para cadastro manual.',
      normalizedPhone: digits,
    };
  }

  return { valid: true, normalizedPhone: digits };
}

export function matchesOriginFilter(customerOrigin: string, filterOrigin?: string): boolean {
  if (!filterOrigin || filterOrigin === 'ALL') return true;
  if (filterOrigin === 'direct' || filterOrigin === 'direto') {
    return customerOrigin === 'direct' || customerOrigin === 'direto';
  }
  if (filterOrigin === 'storefront') {
    return (
      customerOrigin === 'storefront' ||
      customerOrigin === 'storefront_promo' ||
      customerOrigin === 'promotional_checkout'
    );
  }
  return customerOrigin === filterOrigin;
}

export function filterAndSortCrmCustomers(
  customers: CustomerCrmItem[],
  filters: CustomerCrmFilterState,
  referenceDate: Date = new Date()
): CustomerCrmItem[] {
  const searchRaw = String(filters.search || '').trim().toLowerCase();
  const searchDigits = searchRaw.replace(/\D/g, '');
  const originFilter = filters.origin || 'ALL';
  const regKind = filters.registrationKind || 'ALL';
  const segmentFilter = filters.segment || 'ALL';
  const consentFilter = filters.consent || 'ALL';
  const tagFilter = String(filters.tag || '').trim().toLowerCase();
  const sortBy = filters.sortBy || 'RECENT_CREATED';

  const filtered = customers.filter((customer) => {
    if (searchRaw) {
      const nameMatch = customer.name.toLowerCase().includes(searchRaw);
      const emailMatch = Boolean(customer.email && customer.email.toLowerCase().includes(searchRaw));
      const phoneRawMatch = customer.phone.toLowerCase().includes(searchRaw);
      const phoneDigitsMatch =
        searchDigits.length >= 2 &&
        customer.phone.replace(/\D/g, '').includes(searchDigits);
      const tagMatch = (customer.tags || []).some((t) => t.toLowerCase().includes(searchRaw));
      const notesMatch = Boolean(customer.notes && customer.notes.toLowerCase().includes(searchRaw));
      if (!nameMatch && !emailMatch && !phoneRawMatch && !phoneDigitsMatch && !tagMatch && !notesMatch) {
        return false;
      }
    }

    if (!matchesOriginFilter(customer.origin, originFilter)) {
      return false;
    }

    if (regKind !== 'ALL') {
      const kind = resolveRegistrationKind(customer);
      if (kind !== regKind) return false;
    }

    if (segmentFilter !== 'ALL') {
      const seg = classifyCustomerSegment(customer, referenceDate);
      if (seg !== segmentFilter) return false;
    }

    if (consentFilter === 'WHATSAPP_ALLOWED' && !customer.contactConsent) {
      return false;
    }
    if (consentFilter === 'NO_WHATSAPP' && customer.contactConsent) {
      return false;
    }
    if (consentFilter === 'LGPD_PENDING' && customer.hasLgpdConsent) {
      return false;
    }

    if (tagFilter) {
      const hasTag = (customer.tags || []).some((t) => t.toLowerCase() === tagFilter);
      if (!hasTag) return false;
    }

    return true;
  });

  if (sortBy === 'RECENT_CREATED') {
    return filtered;
  }

  return [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'TOTAL_SPENT_DESC':
        return b.totalSpent - a.totalSpent || b.totalOrders - a.totalOrders;
      case 'TOTAL_ORDERS_DESC':
        return b.totalOrders - a.totalOrders || b.totalSpent - a.totalSpent;
      case 'TICKET_AVG_DESC':
        return (
          computeCustomerAverageTicket(b) - computeCustomerAverageTicket(a) ||
          b.totalSpent - a.totalSpent
        );
      case 'LAST_ORDER_DESC': {
        const timeA = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0;
        const timeB = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0;
        return timeB - timeA || b.totalOrders - a.totalOrders;
      }
      case 'NAME_ASC':
        return a.name.localeCompare(b.name, 'pt-BR');
      default:
        return 0;
    }
  });
}

export function computeCrmOverviewMetrics(
  customers: CustomerCrmItem[],
  totalCountOverride?: number,
  referenceDate: Date = new Date()
): CustomerCrmOverviewMetrics {
  let customersWithOrders = 0;
  let recurringCustomers = 0;
  let vipCustomers = 0;
  let newCustomers = 0;
  let inactiveCustomers = 0;
  let withoutOrdersCustomers = 0;
  let manualCustomers = 0;
  let appCustomers = 0;
  let contactConsentCount = 0;
  let lgpdConsentCount = 0;
  let totalRevenue = 0;
  let totalOrdersCount = 0;

  for (const customer of customers) {
    const orders = Number(customer.totalOrders || 0);
    const spent = Number(customer.totalSpent || 0);
    const segment = classifyCustomerSegment(customer, referenceDate);

    if (orders > 0) customersWithOrders += 1;
    if (orders >= 2) recurringCustomers += 1;
    if (segment === 'VIP') vipCustomers += 1;
    if (segment === 'NOVO') newCustomers += 1;
    if (segment === 'INATIVO') inactiveCustomers += 1;
    if (segment === 'SEM_PEDIDOS') withoutOrdersCustomers += 1;

    if (customer.isManual) manualCustomers += 1;
    else appCustomers += 1;

    if (customer.contactConsent) contactConsentCount += 1;
    if (customer.hasLgpdConsent) lgpdConsentCount += 1;

    totalRevenue += spent;
    totalOrdersCount += orders;
  }

  const roundedRevenue = Math.round((totalRevenue + Number.EPSILON) * 100) / 100;
  const averageTicket =
    totalOrdersCount > 0
      ? Math.round(((roundedRevenue / totalOrdersCount) + Number.EPSILON) * 100) / 100
      : 0;
  const averageLtvPerBuyer =
    customersWithOrders > 0
      ? Math.round(((roundedRevenue / customersWithOrders) + Number.EPSILON) * 100) / 100
      : 0;

  return {
    totalCustomers:
      typeof totalCountOverride === 'number' && totalCountOverride > customers.length
        ? totalCountOverride
        : customers.length,
    customersWithOrders,
    recurringCustomers,
    vipCustomers,
    newCustomers,
    inactiveCustomers,
    withoutOrdersCustomers,
    manualCustomers,
    appCustomers,
    contactConsentCount,
    lgpdConsentCount,
    totalRevenue: roundedRevenue,
    totalOrdersCount,
    averageTicket,
    averageLtvPerBuyer,
  };
}

export function computeCustomerOrderInsights(
  orders: CustomerCrmOrderHistoryItem[],
  referenceDate: Date = new Date()
): CustomerOrderInsights {
  const validOrders = orders.filter((o) =>
    isCrmOrderFinanciallyValid({
      status: o.status,
      paymentStatus: o.paymentStatus,
    })
  );
  const cancelledOrders = orders.filter(
    (o) => String(o.status || '').toUpperCase() === 'CANCELLED'
  );
  const refundedOrders = orders.filter(
    (o) => String(o.paymentStatus || '').toUpperCase() === 'REFUNDED'
  );
  const pendingOrders = orders.filter(
    (o) =>
      !cancelledOrders.includes(o) &&
      !refundedOrders.includes(o) &&
      !validOrders.includes(o)
  );

  const validTotalSpent =
    Math.round(
      (validOrders.reduce((acc, o) => acc + Number(o.totalAmount || 0), 0) + Number.EPSILON) * 100
    ) / 100;
  const validOrdersCount = validOrders.length;
  const averageTicket =
    validOrdersCount > 0
      ? Math.round(((validTotalSpent / validOrdersCount) + Number.EPSILON) * 100) / 100
      : 0;

  const sortedByDate = [...validOrders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const lastOrderAt = sortedByDate[0]?.createdAt;
  const firstOrderAt = sortedByDate[sortedByDate.length - 1]?.createdAt;

  const fulfillmentCounts = new Map<string, number>();
  const paymentCounts = new Map<string, number>();
  const itemAgg = new Map<string, { name: string; quantity: number; totalSpent: number }>();

  for (const order of validOrders) {
    if (order.fulfillmentType) {
      fulfillmentCounts.set(
        order.fulfillmentType,
        (fulfillmentCounts.get(order.fulfillmentType) || 0) + 1
      );
    }
    if (order.paymentMethod) {
      paymentCounts.set(order.paymentMethod, (paymentCounts.get(order.paymentMethod) || 0) + 1);
    }
    if (Array.isArray(order.items)) {
      for (const item of order.items) {
        const key = item.productName.trim().toLowerCase();
        const current = itemAgg.get(key) || {
          name: item.productName,
          quantity: 0,
          totalSpent: 0,
        };
        current.quantity += Number(item.quantity || 0);
        current.totalSpent =
          Math.round((current.totalSpent + Number(item.totalPrice || 0) + Number.EPSILON) * 100) /
          100;
        itemAgg.set(key, current);
      }
    }
  }

  let preferredFulfillment: string | undefined;
  let maxFulfillment = 0;
  for (const [k, count] of fulfillmentCounts.entries()) {
    if (count > maxFulfillment) {
      maxFulfillment = count;
      preferredFulfillment = k;
    }
  }

  let preferredPaymentMethod: string | undefined;
  let maxPayment = 0;
  for (const [k, count] of paymentCounts.entries()) {
    if (count > maxPayment) {
      maxPayment = count;
      preferredPaymentMethod = k;
    }
  }

  const topItems = [...itemAgg.values()]
    .sort((a, b) => b.quantity - a.quantity || b.totalSpent - a.totalSpent)
    .slice(0, 5);

  return {
    totalOrdersCount: orders.length,
    validOrdersCount,
    cancelledOrdersCount: cancelledOrders.length,
    refundedOrdersCount: refundedOrders.length,
    pendingOrdersCount: pendingOrders.length,
    validTotalSpent,
    averageTicket,
    firstOrderAt,
    lastOrderAt,
    daysSinceLastOrder: computeDaysSinceLastOrder(lastOrderAt, referenceDate),
    preferredFulfillment,
    preferredPaymentMethod,
    topItems,
  };
}
