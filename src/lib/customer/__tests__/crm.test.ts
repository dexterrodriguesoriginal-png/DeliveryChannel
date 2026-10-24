import { describe, expect, it } from 'vitest';
import {
  classifyCustomerSegment,
  computeCrmOverviewMetrics,
  computeCustomerAverageTicket,
  computeCustomerOrderInsights,
  computeDaysSinceLastOrder,
  customerWhatsAppLink,
  filterAndSortCrmCustomers,
  formatCustomerPhone,
  normalizeCustomerPhone,
  isCrmOrderFinanciallyValid,
  resolveCustomerOriginMeta,
  sanitizeCustomerTags,
  validateManualCustomerInput,
} from '../crm';
import type { CustomerCrmItem, CustomerCrmOrderHistoryItem } from '../../../repositories/customerRepository';

const REF_DATE = new Date('2026-10-20T12:00:00Z');

const SAMPLE_CUSTOMERS: CustomerCrmItem[] = [
  {
    id: 'c-vip-app',
    name: 'Renato Sampaio',
    phone: '11998761122',
    origin: 'qr_code',
    totalOrders: 6,
    totalSpent: 890.4,
    lastOrderAt: '2026-10-18T19:00:00Z',
    contactConsent: true,
    hasLgpdConsent: true,
    isManual: false,
    notes: 'Prefere vinhos tintos reservas',
    tags: ['VIP', 'Vinhos'],
  },
  {
    id: 'c-rec-manual',
    name: 'Beatriz Vasconcelos',
    phone: '(11) 98888-4455',
    email: 'beatriz@email.com',
    origin: 'whatsapp',
    totalOrders: 3,
    totalSpent: 240,
    lastOrderAt: '2026-10-10T20:00:00Z',
    contactConsent: true,
    hasLgpdConsent: true,
    isManual: true,
    notes: 'Cliente de balcão e WhatsApp',
    tags: ['Recorrente'],
  },
  {
    id: 'c-novo-app',
    name: 'Lucas Andrade',
    phone: '11977776655',
    origin: 'storefront',
    totalOrders: 1,
    totalSpent: 65,
    lastOrderAt: '2026-10-19T14:00:00Z',
    contactConsent: false,
    hasLgpdConsent: true,
    isManual: false,
    notes: '',
    tags: [],
  },
  {
    id: 'c-inativo',
    name: 'Fernanda Lima',
    phone: '11966665544',
    origin: 'marketplace',
    totalOrders: 4,
    totalSpent: 320,
    lastOrderAt: '2026-07-01T18:00:00Z',
    contactConsent: true,
    hasLgpdConsent: true,
    isManual: false,
    notes: '',
    tags: [],
  },
  {
    id: 'c-sem-pedidos',
    name: 'Carlos Eduardo',
    phone: '11955554433',
    email: 'carlos@empresa.com',
    origin: 'direct',
    totalOrders: 0,
    totalSpent: 0,
    lastOrderAt: undefined,
    contactConsent: false,
    hasLgpdConsent: true,
    isManual: true,
    notes: 'Cadastrado no balcão',
    tags: ['Atendimento Balcão'],
  },
];

describe('customerWhatsAppLink & phone utilities', () => {
  it('does not provide contact access without explicit consent', () => {
    expect(customerWhatsAppLink('11999998888', false)).toBeNull();
  });

  it('adds Brazil country code to a local phone number', () => {
    expect(customerWhatsAppLink('(11) 99999-8888', true)).toBe('https://wa.me/5511999998888');
  });

  it('keeps an existing country code and rejects invalid numbers', () => {
    expect(customerWhatsAppLink('+55 11 99999-8888', true)).toBe('https://wa.me/5511999998888');
    expect(customerWhatsAppLink('1234', true)).toBeNull();
  });

  it('appends URL-encoded custom message when provided', () => {
    expect(customerWhatsAppLink('11999998888', true, 'Olá Cliente!')).toBe(
      'https://wa.me/5511999998888?text=Ol%C3%A1%20Cliente!'
    );
  });

  it('normalizes and formats Brazilian phones accurately', () => {
    expect(normalizeCustomerPhone('+55 (11) 99876-1122')).toBe('11998761122');
    expect(formatCustomerPhone('5511998761122')).toBe('(11) 99876-1122');
    expect(formatCustomerPhone('1133445566')).toBe('(11) 3344-5566');
  });
});

describe('CRM commercial segmentation & metrics', () => {
  it('classifies VIP, RECORRENTE, NOVO, INATIVO, and SEM_PEDIDOS accurately', () => {
    expect(classifyCustomerSegment(SAMPLE_CUSTOMERS[0], REF_DATE)).toBe('VIP');
    expect(classifyCustomerSegment(SAMPLE_CUSTOMERS[1], REF_DATE)).toBe('RECORRENTE');
    expect(classifyCustomerSegment(SAMPLE_CUSTOMERS[2], REF_DATE)).toBe('NOVO');
    expect(classifyCustomerSegment(SAMPLE_CUSTOMERS[3], REF_DATE)).toBe('INATIVO');
    expect(classifyCustomerSegment(SAMPLE_CUSTOMERS[4], REF_DATE)).toBe('SEM_PEDIDOS');
  });

  it('computes days since last order and average ticket', () => {
    expect(computeDaysSinceLastOrder('2026-10-18T12:00:00Z', REF_DATE)).toBe(2);
    expect(computeDaysSinceLastOrder(undefined, REF_DATE)).toBeNull();
    expect(computeCustomerAverageTicket({ totalOrders: 3, totalSpent: 240 })).toBe(80);
    expect(computeCustomerAverageTicket({ totalOrders: 0, totalSpent: 0 })).toBe(0);
  });

  it('computes executive CRM overview metrics across app and manual customers', () => {
    const metrics = computeCrmOverviewMetrics(SAMPLE_CUSTOMERS, 5, REF_DATE);
    expect(metrics).toMatchObject({
      totalCustomers: 5,
      customersWithOrders: 4,
      recurringCustomers: 3,
      vipCustomers: 1,
      newCustomers: 1,
      inactiveCustomers: 1,
      withoutOrdersCustomers: 1,
      manualCustomers: 2,
      appCustomers: 3,
      contactConsentCount: 3,
      lgpdConsentCount: 5,
      totalRevenue: 1515.4,
      totalOrdersCount: 14,
      averageTicket: 108.24,
      averageLtvPerBuyer: 378.85,
    });
  });
});

describe('CRM filtering, sorting & validation', () => {
  it('filters by registration kind (APP vs MANUAL), segment, consent, tag, and search', () => {
    const onlyManual = filterAndSortCrmCustomers(
      SAMPLE_CUSTOMERS,
      { registrationKind: 'MANUAL' },
      REF_DATE
    );
    expect(onlyManual.map((c) => c.id)).toEqual(['c-rec-manual', 'c-sem-pedidos']);

    const onlyVip = filterAndSortCrmCustomers(
      SAMPLE_CUSTOMERS,
      { segment: 'VIP' },
      REF_DATE
    );
    expect(onlyVip.map((c) => c.id)).toEqual(['c-vip-app']);

    const byPhoneDigits = filterAndSortCrmCustomers(
      SAMPLE_CUSTOMERS,
      { search: '988884455' },
      REF_DATE
    );
    expect(byPhoneDigits.map((c) => c.id)).toEqual(['c-rec-manual']);

    const byTag = filterAndSortCrmCustomers(
      SAMPLE_CUSTOMERS,
      { tag: 'vinhos' },
      REF_DATE
    );
    expect(byTag.map((c) => c.id)).toEqual(['c-vip-app']);
  });

  it('sorts customers by totalSpent, totalOrders, averageTicket, and name', () => {
    const bySpent = filterAndSortCrmCustomers(
      SAMPLE_CUSTOMERS,
      { sortBy: 'TOTAL_SPENT_DESC' },
      REF_DATE
    );
    expect(bySpent[0].id).toBe('c-vip-app');
    expect(bySpent[1].id).toBe('c-inativo');

    const byName = filterAndSortCrmCustomers(
      SAMPLE_CUSTOMERS,
      { sortBy: 'NAME_ASC' },
      REF_DATE
    );
    expect(byName[0].name).toBe('Beatriz Vasconcelos');
  });

  it('validates manual customer registration and sanitizes tags', () => {
    expect(
      validateManualCustomerInput(
        {
          name: 'Ana',
          phone: '(11) 98888-7777',
          origin: 'whatsapp',
          consentLgpd: false,
          contactConsent: true,
        },
        false
      ).valid
    ).toBe(false);

    expect(
      validateManualCustomerInput(
        {
          name: 'Ana Paula',
          phone: '(11) 98888-7777',
          email: 'ana@teste.com',
          origin: 'whatsapp',
          consentLgpd: true,
          contactConsent: true,
        },
        false
      )
    ).toEqual({ valid: true, normalizedPhone: '11988887777' });

    expect(sanitizeCustomerTags('VIP, vip, Recorrente,  , Bom Pagador')).toEqual([
      'VIP',
      'Recorrente',
      'Bom Pagador',
    ]);
  });

  it('computes order history insights excluding cancelled orders from revenue', () => {
    const orders: CustomerCrmOrderHistoryItem[] = [
      {
        id: 'o1',
        orderNumber: 101,
        createdAt: '2026-10-18T19:00:00Z',
        status: 'DELIVERED',
        totalAmount: 120,
        paymentMethod: 'PIX',
        fulfillmentType: 'DELIVERY',
        items: [{ productName: 'Vinho Reserva', quantity: 2, unitPrice: 60, totalPrice: 120 }],
      },
      {
        id: 'o2',
        orderNumber: 102,
        createdAt: '2026-10-19T19:00:00Z',
        status: 'CANCELLED',
        totalAmount: 95,
        paymentMethod: 'PIX',
        fulfillmentType: 'DELIVERY',
      },
    ];
    const insights = computeCustomerOrderInsights(orders, REF_DATE);
    expect(insights.validOrdersCount).toBe(1);
    expect(insights.cancelledOrdersCount).toBe(1);
    expect(insights.validTotalSpent).toBe(120);
    expect(insights.averageTicket).toBe(120);
    expect(insights.preferredPaymentMethod).toBe('PIX');
    expect(insights.preferredFulfillment).toBe('DELIVERY');
    expect(insights.topItems[0]).toEqual({
      name: 'Vinho Reserva',
      quantity: 2,
      totalSpent: 120,
    });
  });

  it('resolves origin metadata consistently', () => {
    expect(resolveCustomerOriginMeta('qr_code').label).toBe('Link / QR Code');
    expect(resolveCustomerOriginMeta('storefront').label).toBe('Loja online');
    expect(resolveCustomerOriginMeta('pos').label).toBe('Balcão / PDV');
  });

  it('validates canonical financial rules via isCrmOrderFinanciallyValid', () => {
    // Valid paid order
    expect(isCrmOrderFinanciallyValid({ status: 'DELIVERED', paymentStatus: 'PAID' })).toBe(true);
    // Cancelled orders are never financially valid
    expect(isCrmOrderFinanciallyValid({ status: 'CANCELLED', paymentStatus: 'PAID' })).toBe(false);
    expect(isCrmOrderFinanciallyValid({ status: 'CANCELLED', paymentStatus: 'PENDING' })).toBe(false);
    // Refunded orders are excluded from revenue
    expect(isCrmOrderFinanciallyValid({ status: 'DELIVERED', paymentStatus: 'REFUNDED' })).toBe(false);
    // Unconfirmed payments are excluded until paid
    expect(isCrmOrderFinanciallyValid({ status: 'PREPARING', paymentStatus: 'PENDING' })).toBe(false);
    expect(isCrmOrderFinanciallyValid({ status: 'DISPATCHED', paymentStatus: 'PAYMENT_ON_DELIVERY' })).toBe(false);
    // Backwards-compatible legacy orders without paymentStatus
    expect(isCrmOrderFinanciallyValid({ status: 'COMPLETED' })).toBe(true);
    expect(isCrmOrderFinanciallyValid({ status: 'CANCELLED' })).toBe(false);
  });

  it('computes order history insights excluding cancelled, refunded, and pending orders from revenue', () => {
    const orders: CustomerCrmOrderHistoryItem[] = [
      {
        id: 'o-paid-1',
        orderNumber: 201,
        createdAt: '2026-10-18T19:00:00Z',
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        totalAmount: 150,
      },
      {
        id: 'o-refunded',
        orderNumber: 202,
        createdAt: '2026-10-17T14:00:00Z',
        status: 'DELIVERED',
        paymentStatus: 'REFUNDED',
        totalAmount: 80,
      },
      {
        id: 'o-pending',
        orderNumber: 203,
        createdAt: '2026-10-19T10:00:00Z',
        status: 'PREPARING',
        paymentStatus: 'PENDING',
        totalAmount: 45,
      },
      {
        id: 'o-cancelled',
        orderNumber: 204,
        createdAt: '2026-10-16T12:00:00Z',
        status: 'CANCELLED',
        paymentStatus: 'PENDING',
        totalAmount: 110,
      },
    ];
    const insights = computeCustomerOrderInsights(orders, REF_DATE);
    expect(insights.validOrdersCount).toBe(1);
    expect(insights.validTotalSpent).toBe(150);
    expect(insights.cancelledOrdersCount).toBe(1);
    expect(insights.refundedOrdersCount).toBe(1);
    expect(insights.pendingOrdersCount).toBe(1);
    expect(insights.averageTicket).toBe(150);
  });

  it('strictly enforces the 5-step classification hierarchy matching SQL', () => {
    // 1. Zero orders: VIP only with tag, otherwise SEM_PEDIDOS
    expect(classifyCustomerSegment({ totalOrders: 0, totalSpent: 0, tags: [] }, REF_DATE)).toBe('SEM_PEDIDOS');
    expect(classifyCustomerSegment({ totalOrders: 0, totalSpent: 0, tags: ['VIP'] }, REF_DATE)).toBe('VIP');
    expect(classifyCustomerSegment({ totalOrders: 0, totalSpent: 0, tags: ['Cliente VIP'] }, REF_DATE)).toBe('VIP');

    // 2. Orders > 0 and last order > 45 days: MUST be INATIVO (inactivity overrides VIP criteria)
    expect(
      classifyCustomerSegment(
        {
          totalOrders: 10,
          totalSpent: 2000,
          lastOrderAt: '2026-08-01T12:00:00Z', // > 45 days before 2026-10-20
          tags: ['VIP'],
        },
        REF_DATE
      )
    ).toBe('INATIVO');

    // 3. Active (<= 45 days) and VIP by orders (>= 5) or spent (>= 500) or tag
    expect(
      classifyCustomerSegment(
        { totalOrders: 5, totalSpent: 200, lastOrderAt: '2026-10-10T12:00:00Z', tags: [] },
        REF_DATE
      )
    ).toBe('VIP');
    expect(
      classifyCustomerSegment(
        { totalOrders: 1, totalSpent: 550, lastOrderAt: '2026-10-10T12:00:00Z', tags: [] },
        REF_DATE
      )
    ).toBe('VIP');
    expect(
      classifyCustomerSegment(
        { totalOrders: 1, totalSpent: 50, lastOrderAt: '2026-10-10T12:00:00Z', tags: ['vip'] },
        REF_DATE
      )
    ).toBe('VIP');

    // 4. Active with >= 2 orders and not VIP: RECORRENTE
    expect(
      classifyCustomerSegment(
        { totalOrders: 2, totalSpent: 100, lastOrderAt: '2026-10-10T12:00:00Z', tags: [] },
        REF_DATE
      )
    ).toBe('RECORRENTE');

    // 5. Active with 1 order and not VIP: NOVO
    expect(
      classifyCustomerSegment(
        { totalOrders: 1, totalSpent: 100, lastOrderAt: '2026-10-10T12:00:00Z', tags: [] },
        REF_DATE
      )
    ).toBe('NOVO');
  });
});

