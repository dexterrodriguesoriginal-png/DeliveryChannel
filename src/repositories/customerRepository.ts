import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Customer, CustomerOrigin } from '../types';
import { SecurityContext } from '../services/securityEngine';
import { dataStore } from '../services/dataStore';
import { isValidUuid } from '../lib/uuid';
import {
  localOnly,
  requireBackendOrLocalDemo,
  isLocalDemoAllowed,
  isPreviewBypassActive,
} from '../lib/backend';
import {
  matchesOriginFilter,
  normalizeCustomerPhone,
  sanitizeCustomerTags,
  isCrmOrderFinanciallyValid,
  computeCrmOverviewMetrics,
  type CustomerCrmOverviewMetrics,
} from '../lib/customer/crm';

export type CustomerLifecycleStatus = 'NOVO' | 'RECORRENTE' | 'INATIVO';

export interface CustomerSummaryItem {
  id: string;
  tenantId: string;
  userId?: string;
  name: string;
  phone: string;
  email?: string;
  origin: CustomerOrigin;
  totalOrders: number;
  ltvAmount: number;
  averageTicket: number;
  firstOrderDate?: string;
  lastOrderDate?: string;
  hasLgpdConsent: boolean;
  status: CustomerLifecycleStatus;
  createdAt?: string;
}

export interface CustomersListResponse {
  totalCount: number;
  customers: CustomerSummaryItem[];
  limit: number;
  offset: number;
}

export interface CustomerOrderHistoryItem {
  id: string;
  orderNumber: number;
  createdAt: string;
  status: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  totalAmount: number;
  paymentMethod: string;
  fulfillmentType: string;
}

export interface CustomerCrmOrderHistoryItem {
  id: string;
  orderNumber: number;
  createdAt: string;
  status: string;
  paymentStatus?: string;
  totalAmount: number;
  subtotal?: number;
  discount?: number;
  deliveryFee?: number;
  paymentMethod?: string;
  fulfillmentType?: string;
  origin?: string;
  notes?: string;
  items?: Array<{
    productId?: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    unit?: string;
  }>;
}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  email?: string;
  origin: CustomerOrigin;
  consentLgpd: boolean;
  contactConsent: boolean;
  notes?: string;
  tags?: string[];
}

export interface CustomerCrmItem {
  id: string;
  name: string;
  phone: string;
  email?: string;
  origin: CustomerOrigin;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt?: string;
  contactConsent: boolean;
  hasLgpdConsent: boolean;
  isManual: boolean;
  notes: string;
  tags: string[];
}

export interface CustomerCrmListResponse {
  totalCount: number;
  customers: CustomerCrmItem[];
  limit: number;
  offset: number;
}

export interface CustomerCrmExportRow {
  name: string;
  phone: string;
  origin: CustomerOrigin;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt?: string;
  contactConsent: boolean;
  isManual?: boolean;
  tags?: string[];
}

interface LocalCrmProfileMeta {
  tenantId: string;
  customerId: string;
  isManual: boolean;
  privateNotes: string;
  tags: string[];
  hiddenAt?: string | null;
  contactConsent: boolean;
  recordedLgpdConsent: boolean;
  createdAt: string;
  updatedAt: string;
}

const LOCAL_CRM_STORAGE_KEY = 'delivery_channel_crm_profiles_v1';

const DEFAULT_DEMO_PROFILES: Record<string, Partial<LocalCrmProfileMeta>> = {
  'tenant-adega-01:cust-adega-1': {
    isManual: false,
    privateNotes: 'Cliente fiel dos finais de semana. Prefere vinhos tintos encorpados Chileno/Argentino e entrega até as 20h.',
    tags: ['VIP', 'Recorrente', 'Vinhos Tintos'],
    contactConsent: true,
    recordedLgpdConsent: true,
  },
  'tenant-adega-01:cust-adega-2': {
    isManual: true,
    privateNotes: 'Cadastrada no atendimento via WhatsApp. Gosta de cervejas IPA artesanais bem geladas.',
    tags: ['Recorrente', 'Cervejas Artesanais'],
    contactConsent: true,
    recordedLgpdConsent: true,
  },
  'tenant-adega-01:cust-adega-3': {
    isManual: false,
    privateNotes: 'Migrou do marketplace para o aplicativo próprio com cupom na sacola. Compra combos para eventos.',
    tags: ['VIP', 'Eventos', 'Bom Pagador'],
    contactConsent: true,
    recordedLgpdConsent: true,
  },
  'tenant-burger-02:cust-burger-1': {
    isManual: false,
    privateNotes: 'Pede ponto da carne ao ponto para mal passado.',
    tags: ['Recorrente'],
    contactConsent: true,
    recordedLgpdConsent: true,
  },
};

const inMemoryCrmProfiles = new Map<string, LocalCrmProfileMeta>();
const inMemoryManualCustomers = new Map<string, Customer>();

function loadLocalCrmProfiles(): Map<string, LocalCrmProfileMeta> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(LOCAL_CRM_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          profiles?: Record<string, LocalCrmProfileMeta>;
          manualCustomers?: Record<string, Customer>;
        };
        if (parsed.profiles) {
          for (const [k, v] of Object.entries(parsed.profiles)) {
            inMemoryCrmProfiles.set(k, v);
          }
        }
        if (parsed.manualCustomers) {
          for (const [k, v] of Object.entries(parsed.manualCustomers)) {
            inMemoryManualCustomers.set(k, v);
          }
        }
      }
    }
  } catch {
    // ignore storage errors
  }
  return inMemoryCrmProfiles;
}

function saveLocalCrmProfiles(map: Map<string, LocalCrmProfileMeta>): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const profiles: Record<string, LocalCrmProfileMeta> = {};
      for (const [k, v] of map.entries()) {
        profiles[k] = v;
      }
      const manualCustomers: Record<string, Customer> = {};
      for (const [k, v] of inMemoryManualCustomers.entries()) {
        manualCustomers[k] = v;
      }
      window.localStorage.setItem(
        LOCAL_CRM_STORAGE_KEY,
        JSON.stringify({ profiles, manualCustomers })
      );
    }
  } catch {
    // ignore storage errors
  }
}

function canUseLocalDemoCrm(tenantId: string): boolean {
  if (!tenantId) return false;
  if (isValidUuid(tenantId)) {
    return !isSupabaseConfigured && (isLocalDemoAllowed || isPreviewBypassActive());
  }
  return tenantId.startsWith('tenant-') || isLocalDemoAllowed || isPreviewBypassActive();
}

function buildLocalSecContext(tenantId: string): SecurityContext {
  return {
    userId: 'crm-local-operator',
    userName: 'Gestor da Loja',
    userRole: 'OWNER',
    tenantId,
  };
}

function ensureLocalTenantCrmProfiles(tenantId: string): {
  customers: Customer[];
  profiles: Map<string, LocalCrmProfileMeta>;
} {
  const profiles = loadLocalCrmProfiles();
  const ctx = buildLocalSecContext(tenantId);
  const storeCustomers = dataStore.getCustomers(ctx, tenantId);
  const mergedMap = new Map<string, Customer>();

  for (const [k, manual] of inMemoryManualCustomers.entries()) {
    if (k.startsWith(`${tenantId}:`) && manual.tenantId === tenantId) {
      mergedMap.set(manual.id, manual);
    }
  }
  for (const c of storeCustomers) {
    if (!mergedMap.has(c.id)) {
      mergedMap.set(c.id, c);
    }
  }

  const customers = [...mergedMap.values()];
  let changed = false;

  for (const c of customers) {
    const key = `${tenantId}:${c.id}`;
    if (!profiles.has(key)) {
      const preset = DEFAULT_DEMO_PROFILES[key];
      const isManualDefault =
        preset?.isManual !== undefined
          ? preset.isManual
          : !c.userId && (c.origin === 'whatsapp' || c.origin === 'direct' || c.origin === 'direto' || c.origin === 'indicacao');
      profiles.set(key, {
        tenantId,
        customerId: c.id,
        isManual: isManualDefault,
        privateNotes: preset?.privateNotes ?? '',
        tags: preset?.tags ?? [],
        hiddenAt: null,
        contactConsent: preset?.contactConsent ?? Boolean(c.consentLgpd),
        recordedLgpdConsent: preset?.recordedLgpdConsent ?? Boolean(c.consentLgpd),
        createdAt: c.firstOrderDate || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      changed = true;
    }
  }

  if (changed) {
    saveLocalCrmProfiles(profiles);
  }
  return { customers, profiles };
}

function computeLocalCustomerCrmItems(tenantId: string): CustomerCrmItem[] {
  const ctx = buildLocalSecContext(tenantId);
  const { customers, profiles } = ensureLocalTenantCrmProfiles(tenantId);
  const orders = dataStore.getOrders(ctx, tenantId);

  const items: CustomerCrmItem[] = [];
  for (const customer of customers) {
    const key = `${tenantId}:${customer.id}`;
    const profile = profiles.get(key);
    if (profile?.hiddenAt) continue;

    const normCustPhone = normalizeCustomerPhone(customer.phone);
    const matchingOrders = orders.filter(
      (o) =>
        o.customerId === customer.id ||
        (!o.customerId && normCustPhone && normalizeCustomerPhone(o.customerPhone) === normCustPhone)
    );

    const hasLoadedHistory = matchingOrders.length > 0;
    const matchingValidOrders = matchingOrders.filter((o) =>
      isCrmOrderFinanciallyValid({
        status: o.status,
        paymentStatus: o.paymentStatus,
      })
    );

    let validCount: number;
    let validSpent: number;
    let latestOrderDate: string | undefined;

    if (hasLoadedHistory) {
      validCount = matchingValidOrders.length;
      validSpent =
        matchingValidOrders.length > 0
          ? Math.round(
              (matchingValidOrders.reduce((s, o) => s + Number(o.totalAmount || 0), 0) +
                Number.EPSILON) *
                100
            ) / 100
          : 0;
      latestOrderDate = matchingValidOrders
        .map((o) => o.createdAt)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    } else {
      validCount = Number(customer.totalOrders || 0);
      validSpent = Number(customer.ltvAmount || 0);
      latestOrderDate = customer.lastOrderDate || undefined;
    }

    const isManual = Boolean(profile?.isManual);

    items.push({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: isManual ? customer.email || undefined : undefined,
      origin: customer.origin || 'direct',
      totalOrders: validCount,
      totalSpent: validSpent,
      lastOrderAt: latestOrderDate,
      contactConsent: Boolean(profile?.contactConsent),
      hasLgpdConsent: Boolean(profile?.recordedLgpdConsent || customer.consentLgpd),
      isManual,
      notes: profile?.privateNotes || '',
      tags: Array.isArray(profile?.tags) ? profile!.tags : [],
    });
  }

  return items;
}

function mapRowToCustomer(row: any): Customer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id || undefined,
    name: row.name,
    phone: row.phone,
    email: row.email || undefined,
    origin: row.origin || 'direto',
    totalOrders: Number(row.total_orders ?? 0),
    ltvAmount: Number(row.ltv_amount ?? 0),
    firstOrderDate: row.first_order_date || new Date().toISOString().split('T')[0],
    lastOrderDate: row.last_order_date || new Date().toISOString().split('T')[0],
    consentLgpd: false,
    isDemo: false,
  };
}

export const customerRepository = {
  async getCrmCustomers(
    tenantId: string,
    params: { search?: string; origin?: string; limit?: number; offset?: number }
  ): Promise<CustomerCrmListResponse> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      const { data, error } = await supabase.rpc('crm_list_customers', {
        p_tenant_id: tenantId,
        p_search: params.search || null,
        p_origin: params.origin && params.origin !== 'ALL' ? params.origin : null,
        p_limit: params.limit ?? 50,
        p_offset: params.offset ?? 0,
      });
      if (error) throw new Error(`Falha ao carregar clientes: ${error.message}`);
      return {
        totalCount: Number(data?.totalCount ?? 0),
        limit: Number(data?.limit ?? params.limit ?? 50),
        offset: Number(data?.offset ?? params.offset ?? 0),
        customers: (data?.customers ?? []).map((row: any) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
          email: row.email || undefined,
          origin: row.origin || 'direct',
          totalOrders: Number(row.totalOrders ?? 0),
          totalSpent: Number(row.totalSpent ?? 0),
          lastOrderAt: row.lastOrderAt || undefined,
          contactConsent: Boolean(row.contactConsent),
          hasLgpdConsent: Boolean(row.hasLgpdConsent),
          isManual: Boolean(row.isManual),
          notes: row.notes || '',
          tags: Array.isArray(row.tags) ? row.tags : [],
        })),
      };
    }

    if (!canUseLocalDemoCrm(tenantId)) {
      throw new Error('O CRM exige uma conexão autenticada com a loja.');
    }

    const allItems = computeLocalCustomerCrmItems(tenantId);
    const searchRaw = String(params.search || '').trim().toLowerCase();
    const searchDigits = searchRaw.replace(/\D/g, '');
    const originFilter = params.origin && params.origin !== 'ALL' ? params.origin : 'ALL';

    const filtered = allItems.filter((c) => {
      if (searchRaw) {
        const byName = c.name.toLowerCase().includes(searchRaw);
        const byPhone = c.phone.toLowerCase().includes(searchRaw);
        const byDigits =
          searchDigits.length >= 2 && c.phone.replace(/\D/g, '').includes(searchDigits);
        const byEmail = Boolean(c.email && c.email.toLowerCase().includes(searchRaw));
        const byTag = (c.tags || []).some((t) => t.toLowerCase().includes(searchRaw));
        if (!byName && !byPhone && !byDigits && !byEmail && !byTag) return false;
      }
      if (!matchesOriginFilter(c.origin, originFilter)) {
        return false;
      }
      return true;
    });

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    return {
      totalCount: filtered.length,
      limit,
      offset,
      customers: filtered.slice(offset, offset + limit),
    };
  },

  async getCrmCustomerOrderHistory(
    tenantId: string,
    customerId: string
  ): Promise<CustomerCrmOrderHistoryItem[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(customerId)) {
      const { data, error } = await supabase.rpc('crm_get_customer_orders', {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
      });
      if (error) throw new Error(`Falha ao carregar histórico: ${error.message}`);
      return (data ?? []).map((row: any) => ({
        id: row.id,
        orderNumber: Number(row.orderNumber ?? 0),
        createdAt: row.createdAt,
        status: row.status,
        paymentStatus: row.paymentStatus || row.payment_status || undefined,
        totalAmount: Number(row.totalAmount ?? 0),
        ...(row.subtotal !== undefined ? { subtotal: Number(row.subtotal) } : {}),
        ...(row.discount !== undefined ? { discount: Number(row.discount) } : {}),
        ...(row.deliveryFee !== undefined ? { deliveryFee: Number(row.deliveryFee) } : {}),
        ...(row.paymentMethod ? { paymentMethod: String(row.paymentMethod) } : {}),
        ...(row.fulfillmentType ? { fulfillmentType: String(row.fulfillmentType) } : {}),
        ...(row.origin ? { origin: String(row.origin) } : {}),
        ...(Array.isArray(row.items) ? { items: row.items } : {}),
      }));
    }

    if (!canUseLocalDemoCrm(tenantId)) {
      throw new Error('Histórico indisponível sem uma conexão válida com a loja.');
    }

    const ctx = buildLocalSecContext(tenantId);
    const { customers, profiles } = ensureLocalTenantCrmProfiles(tenantId);
    const customer = customers.find((c) => c.id === customerId && c.tenantId === tenantId);
    const profile = profiles.get(`${tenantId}:${customerId}`);
    if (!customer || profile?.hiddenAt) {
      throw new Error('Cliente não encontrado nesta loja.');
    }

    const normCustPhone = normalizeCustomerPhone(customer.phone);
    const orders = dataStore
      .getOrders(ctx, tenantId)
      .filter(
        (o) =>
          o.customerId === customerId ||
          (!o.customerId && normCustPhone && normalizeCustomerPhone(o.customerPhone) === normCustPhone)
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      status: o.status,
      paymentStatus: o.paymentStatus,
      totalAmount: o.totalAmount,
      subtotal: o.subtotal,
      discount: o.discount,
      deliveryFee: o.deliveryFee,
      paymentMethod: o.paymentMethod,
      fulfillmentType: o.fulfillmentType,
      origin: o.origin,
      notes: o.notes,
      items: o.items?.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        unit: item.unit,
      })),
    }));
  },

  async createCrmManualCustomer(tenantId: string, input: CreateCustomerInput): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      const { data, error } = await supabase.rpc('crm_create_manual_customer', {
        p_tenant_id: tenantId,
        p_name: input.name,
        p_phone: input.phone,
        p_email: input.email || null,
        p_origin: input.origin,
        p_lgpd_consent: input.consentLgpd,
        p_contact_consent: input.contactConsent,
      });
      if (error) throw new Error(error.message);

      const createdId = data && typeof data === 'object' && 'id' in data ? String((data as any).id) : '';
      const cleanNotes = String(input.notes || '').trim();
      const cleanTags = sanitizeCustomerTags(input.tags || []);
      if (createdId && isValidUuid(createdId) && (cleanNotes || cleanTags.length > 0)) {
        await supabase.rpc('crm_save_customer_private_data', {
          p_tenant_id: tenantId,
          p_customer_id: createdId,
          p_notes: cleanNotes,
          p_tags: cleanTags,
        });
      }
      return;
    }

    if (!canUseLocalDemoCrm(tenantId)) {
      throw new Error('Cadastro manual exige uma conexão válida com a loja.');
    }

    if (!input.consentLgpd) {
      throw new Error('O consentimento LGPD registrado é obrigatório.');
    }

    const cleanName = String(input.name || '').trim();
    const cleanPhoneDigits = String(input.phone || '').replace(/\D/g, '');
    if (cleanName.length < 2 || cleanName.length > 255) {
      throw new Error('Informe um nome válido.');
    }
    if (cleanPhoneDigits.length < 10 || cleanPhoneDigits.length > 13) {
      throw new Error('Informe um telefone válido com DDD.');
    }

    const { customers, profiles } = ensureLocalTenantCrmProfiles(tenantId);
    const normNewPhone = normalizeCustomerPhone(cleanPhoneDigits);
    const duplicate = customers.find(
      (c) => c.tenantId === tenantId && normalizeCustomerPhone(c.phone) === normNewPhone
    );
    if (duplicate) {
      if (duplicate.userId) {
        throw new Error('Já existe uma conta digital do aplicativo com este telefone. O cadastro manual não pode sobrepor contas digitais.');
      }
      const existingProfile = profiles.get(`${tenantId}:${duplicate.id}`);
      if (existingProfile?.hiddenAt) {
        // Re-exibe e atualiza se estava oculto na lista da loja
        existingProfile.hiddenAt = null;
        existingProfile.isManual = true;
        existingProfile.contactConsent = Boolean(input.contactConsent);
        existingProfile.recordedLgpdConsent = true;
        if (input.notes) existingProfile.privateNotes = input.notes.trim().slice(0, 5000);
        if (input.tags) existingProfile.tags = sanitizeCustomerTags(input.tags);
        existingProfile.updatedAt = new Date().toISOString();
        duplicate.name = cleanName;
        duplicate.phone = input.phone.trim();
        duplicate.email = input.email?.trim() || undefined;
        saveLocalCrmProfiles(profiles);
        return;
      }
      throw new Error('Já existe um cliente cadastrado com este telefone.');
    }

    const newCustomerId = `cust-manual-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];
    const newCustomer: Customer = {
      id: newCustomerId,
      tenantId,
      name: cleanName,
      phone: input.phone.trim(),
      email: input.email?.trim() || undefined,
      origin: input.origin || 'whatsapp',
      totalOrders: 0,
      ltvAmount: 0,
      firstOrderDate: today,
      lastOrderDate: '',
      consentLgpd: true,
      isDemo: false,
    };

    inMemoryManualCustomers.set(`${tenantId}:${newCustomerId}`, newCustomer);
    profiles.set(`${tenantId}:${newCustomerId}`, {
      tenantId,
      customerId: newCustomerId,
      isManual: true,
      privateNotes: String(input.notes || '').trim().slice(0, 5000),
      tags: sanitizeCustomerTags(input.tags || []),
      hiddenAt: null,
      contactConsent: Boolean(input.contactConsent),
      recordedLgpdConsent: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    saveLocalCrmProfiles(profiles);
  },

  async updateCrmManualCustomer(
    tenantId: string,
    customerId: string,
    input: Pick<CreateCustomerInput, 'name' | 'phone' | 'email'> & {
      origin?: CustomerOrigin;
      contactConsent?: boolean;
      notes?: string;
      tags?: string[];
    }
  ): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      const { error } = await supabase.rpc('crm_update_manual_customer', {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
        p_name: input.name,
        p_phone: input.phone,
        p_email: input.email || null,
      });
      if (error) throw new Error(error.message);
      return;
    }

    if (!canUseLocalDemoCrm(tenantId)) {
      throw new Error('Edição manual exige uma conexão válida com a loja.');
    }

    const { customers, profiles } = ensureLocalTenantCrmProfiles(tenantId);
    const customer = customers.find((c) => c.id === customerId && c.tenantId === tenantId);
    const profile = profiles.get(`${tenantId}:${customerId}`);
    if (!customer || !profile || !profile.isManual || customer.userId) {
      throw new Error('Somente registros manuais desta loja podem ser editados.');
    }

    const cleanName = String(input.name || '').trim();
    const cleanPhoneDigits = String(input.phone || '').replace(/\D/g, '');
    if (cleanName.length < 2 || cleanName.length > 255 || cleanPhoneDigits.length < 10 || cleanPhoneDigits.length > 13) {
      throw new Error('Nome ou telefone inválido.');
    }

    const normPhone = normalizeCustomerPhone(cleanPhoneDigits);
    const duplicate = customers.find(
      (c) =>
        c.tenantId === tenantId &&
        c.id !== customerId &&
        normalizeCustomerPhone(c.phone) === normPhone
    );
    if (duplicate) {
      throw new Error('Já existe um cliente cadastrado com este telefone.');
    }

    customer.name = cleanName;
    customer.phone = input.phone.trim();
    customer.email = input.email?.trim() || undefined;
    if (input.origin) {
      customer.origin = input.origin;
    }
    if (input.contactConsent !== undefined) {
      profile.contactConsent = Boolean(input.contactConsent);
    }
    if (input.notes !== undefined) {
      profile.privateNotes = String(input.notes).slice(0, 5000);
    }
    if (input.tags !== undefined) {
      profile.tags = sanitizeCustomerTags(input.tags);
    }
    profile.updatedAt = new Date().toISOString();
    saveLocalCrmProfiles(profiles);
  },

  async saveCrmCustomerPrivateData(
    tenantId: string,
    customerId: string,
    notes: string,
    tags: string[]
  ): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      const { error } = await supabase.rpc('crm_save_customer_private_data', {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
        p_notes: notes,
        p_tags: tags,
      });
      if (error) throw new Error(error.message);
      return;
    }

    if (!canUseLocalDemoCrm(tenantId)) {
      throw new Error('Acesso negado para atualizar observações.');
    }

    if (notes.length > 5000) {
      throw new Error('Observação deve ter até 5.000 caracteres.');
    }
    const cleanTags = sanitizeCustomerTags(tags);
    const { profiles } = ensureLocalTenantCrmProfiles(tenantId);
    const profile = profiles.get(`${tenantId}:${customerId}`);
    if (!profile || profile.hiddenAt) {
      throw new Error('Cliente não encontrado nesta loja.');
    }
    profile.privateNotes = notes;
    profile.tags = cleanTags;
    profile.updatedAt = new Date().toISOString();
    saveLocalCrmProfiles(profiles);
  },

  async hideCrmCustomer(tenantId: string, customerId: string): Promise<void> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      const { error } = await supabase.rpc('crm_hide_customer', {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
      });
      if (error) throw new Error(error.message);
      return;
    }

    if (!canUseLocalDemoCrm(tenantId)) {
      throw new Error('Acesso negado para remover cliente da lista.');
    }

    const { profiles } = ensureLocalTenantCrmProfiles(tenantId);
    const profile = profiles.get(`${tenantId}:${customerId}`);
    if (!profile || profile.hiddenAt) {
      throw new Error('Cliente não encontrado nesta loja.');
    }
    profile.hiddenAt = new Date().toISOString();
    profile.updatedAt = new Date().toISOString();
    saveLocalCrmProfiles(profiles);
  },

  async getCrmCustomerContactTarget(tenantId: string, customerId: string): Promise<string> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      const { data, error } = await supabase.rpc('crm_get_customer_contact_target', {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
      });
      if (error) throw new Error(error.message);
      if (typeof data !== 'string') throw new Error('Contato autorizado não disponível.');
      return data;
    }

    if (!canUseLocalDemoCrm(tenantId)) {
      throw new Error('Acesso negado ao contato deste cliente.');
    }

    const { customers, profiles } = ensureLocalTenantCrmProfiles(tenantId);
    const customer = customers.find((c) => c.id === customerId && c.tenantId === tenantId);
    const profile = profiles.get(`${tenantId}:${customerId}`);
    if (!customer || !profile || profile.hiddenAt || !profile.contactConsent) {
      throw new Error('O cliente não autorizou contato ou não está disponível.');
    }
    return customer.phone;
  },

  async exportCrmCustomers(
    tenantId: string,
    search?: string,
    origin?: string
  ): Promise<CustomerCrmExportRow[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      const { data, error } = await supabase.rpc('crm_export_customers', {
        p_tenant_id: tenantId,
        p_search: search || null,
        p_origin: origin && origin !== 'ALL' ? origin : null,
      });
      if (error) throw new Error(`Falha ao exportar clientes: ${error.message}`);
      return (data ?? []).map((row: any) => ({
        name: row.name,
        phone: row.phone,
        origin: row.origin || 'direct',
        totalOrders: Number(row.totalOrders ?? 0),
        totalSpent: Number(row.totalSpent ?? 0),
        lastOrderAt: row.lastOrderAt || undefined,
        contactConsent: Boolean(row.contactConsent),
      }));
    }

    if (!canUseLocalDemoCrm(tenantId)) {
      throw new Error('Somente o proprietário pode exportar clientes.');
    }

    const list = await this.getCrmCustomers(tenantId, {
      search,
      origin,
      limit: 1000,
      offset: 0,
    });
    return list.customers.map((c) => ({
      name: c.name,
      phone: c.phone,
      origin: c.origin,
      totalOrders: c.totalOrders,
      totalSpent: c.totalSpent,
      lastOrderAt: c.lastOrderAt,
      contactConsent: c.contactConsent,
      isManual: c.isManual,
      tags: c.tags,
    }));
  },

  /**
   * Métricas globais consolidadas da base inteira da loja (não apenas da página atual).
   */
  async getCrmOverviewMetrics(tenantId: string): Promise<CustomerCrmOverviewMetrics> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase.rpc('crm_get_overview_metrics', {
          p_tenant_id: tenantId,
        });
        if (!error && data) {
          return {
            totalCustomers: Number(data.totalCustomers || 0),
            customersWithOrders: Number(data.customersWithOrders || 0),
            recurringCustomers: Number(data.recurringCustomers || 0),
            vipCustomers: Number(data.vipCustomers || 0),
            newCustomers: Number(data.newCustomers || 0),
            inactiveCustomers: Number(data.inactiveCustomers || 0),
            withoutOrdersCustomers: Number(data.withoutOrdersCustomers || 0),
            manualCustomers: Number(data.manualCustomers || 0),
            appCustomers: Number(data.appCustomers || 0),
            contactConsentCount: Number(data.contactConsentCount || 0),
            lgpdConsentCount: Number(data.lgpdConsentCount || 0),
            totalRevenue: Number(data.totalRevenue || 0),
            totalOrdersCount: Number(data.totalOrdersCount || 0),
            averageTicket: Number(data.averageTicket || 0),
            averageLtvPerBuyer: Number(data.averageLtvPerBuyer || 0),
          };
        }
      } catch (err) {
        console.warn('[customerRepository] RPC crm_get_overview_metrics não disponível, usando agregação alternativa:', err);
      }
    }

    if (!canUseLocalDemoCrm(tenantId)) {
      throw new Error('Acesso negado às métricas do CRM.');
    }

    const allItems = computeLocalCustomerCrmItems(tenantId);
    return computeCrmOverviewMetrics(allItems, allItems.length);
  },

  /**
   * Obtém os dados do cliente associado ao auth.uid() autenticado no tenant
   */
  async getCustomerByUserId(tenantId: string, userId: string): Promise<Customer | null> {
    if (!isSupabaseConfigured || !isValidUuid(tenantId) || !isValidUuid(userId)) return null;
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, tenant_id, user_id, name, phone, email, origin, total_orders, ltv_amount, first_order_date, last_order_date')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data) {
        return mapRowToCustomer(data);
      }
    } catch (err) {
      console.warn('[customerRepository] Erro ao buscar cliente por user_id:', err);
    }
    return null;
  },

  /**
   * Lista simples de clientes para compatibilidade com Dashboard e telas legadas
   */
  async getCustomers(context: SecurityContext, tenantId: string): Promise<Customer[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('customers')
          .select('id, tenant_id, user_id, name, phone, email, origin, total_orders, ltv_amount, first_order_date, last_order_date')
          .eq('tenant_id', tenantId)
          .order('name');

        if (error) {
          console.warn('[customerRepository] Erro ao listar clientes do Supabase:', error.message);
          return localOnly('clientes', () => dataStore.getCustomers(context, tenantId));
        }

        return (data || []).map(mapRowToCustomer);
      } catch (err) {
        console.warn('[customerRepository] Falha ao consultar clientes no Supabase:', err);
        return localOnly('clientes', () => dataStore.getCustomers(context, tenantId));
      }
    }
    return localOnly('clientes', () => dataStore.getCustomers(context, tenantId));
  },

  /**
   * Lista avançada e segura para o CRM com métricas oficiais baseadas em pedidos válidos
   */
  async getCustomersSummary(
    context: SecurityContext,
    tenantId: string,
    params: {
      searchTerm?: string;
      origin?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<CustomersListResponse> {
    const { searchTerm, origin, limit = 20, offset = 0 } = params;

    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase.rpc('get_tenant_customers_summary', {
          p_tenant_id: tenantId,
          p_search_term: searchTerm || null,
          p_origin: origin === 'ALL' ? null : (origin || null),
          p_limit: limit,
          p_offset: offset,
        });

        if (!error && data) {
          return {
            totalCount: Number(data.totalCount || 0),
            customers: (data.customers || []).map((c: any) => ({
              id: c.id,
              tenantId: c.tenantId,
              userId: c.userId || undefined,
              name: c.name,
              phone: c.phone,
              email: c.email || undefined,
              origin: c.origin || 'direto',
              totalOrders: Number(c.totalOrders || 0),
              ltvAmount: Number(c.ltvAmount || 0),
              averageTicket: Number(c.averageTicket || 0),
              firstOrderDate: c.firstOrderDate || undefined,
              lastOrderDate: c.lastOrderDate || undefined,
              hasLgpdConsent: Boolean(c.hasLgpdConsent),
              status: c.status as CustomerLifecycleStatus,
              createdAt: c.createdAt,
            })),
            limit: Number(data.limit || limit),
            offset: Number(data.offset || offset),
          };
        }
      } catch (rpcErr) {
        console.warn('[customerRepository] RPC get_tenant_customers_summary falhou:', rpcErr);
      }
    }

    requireBackendOrLocalDemo('clientes');
    const rawCustomers = dataStore.getCustomers(context, tenantId);
    let filtered = rawCustomers;
    if (searchTerm && searchTerm.trim()) {
      const st = searchTerm.toLowerCase().trim();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(st) ||
          c.phone.toLowerCase().includes(st) ||
          (c.email && c.email.toLowerCase().includes(st))
      );
    }
    if (origin && origin !== 'ALL') {
      filtered = filtered.filter((c) => c.origin === origin);
    }

    const paged = filtered.slice(offset, offset + limit);
    return {
      totalCount: filtered.length,
      customers: paged.map((c) => ({
        id: c.id,
        tenantId: c.tenantId,
        userId: c.userId,
        name: c.name,
        phone: c.phone,
        email: c.email,
        origin: c.origin,
        totalOrders: c.totalOrders,
        ltvAmount: c.ltvAmount,
        averageTicket:
          c.totalOrders > 0 ? Number((c.ltvAmount / c.totalOrders).toFixed(2)) : 0,
        firstOrderDate: c.firstOrderDate,
        lastOrderDate: c.lastOrderDate,
        hasLgpdConsent: c.consentLgpd,
        status: (c.totalOrders > 3 ? 'RECORRENTE' : 'NOVO') as CustomerLifecycleStatus,
        createdAt: c.firstOrderDate,
      })),
      limit,
      offset,
    };
  },

  /**
   * Consulta o histórico de compras de um cliente específico no tenant
   */
  async getCustomerOrderHistory(
    context: SecurityContext,
    tenantId: string,
    customerId: string
  ): Promise<CustomerOrderHistoryItem[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId) && isValidUuid(customerId)) {
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_customer_orders_history', {
          p_tenant_id: tenantId,
          p_customer_id: customerId,
        });

        if (!rpcError && rpcData) {
          return (rpcData as any[]).map((row) => ({
            id: row.id,
            orderNumber: Number(row.orderNumber),
            createdAt: row.createdAt,
            status: row.status,
            subtotal: Number(row.subtotal || 0),
            discount: Number(row.discount || 0),
            deliveryFee: Number(row.deliveryFee || 0),
            totalAmount: Number(row.totalAmount || 0),
            paymentMethod: row.paymentMethod,
            fulfillmentType: row.fulfillmentType,
          }));
        }

        const { data, error } = await supabase
          .from('orders')
          .select('id, order_number, created_at, status, subtotal, discount, delivery_fee, total_amount, payment_method, fulfillment_type')
          .eq('tenant_id', tenantId)
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map((row) => ({
            id: row.id,
            orderNumber: Number(row.order_number),
            createdAt: row.created_at,
            status: row.status,
            subtotal: Number(row.subtotal || 0),
            discount: Number(row.discount || 0),
            deliveryFee: Number(row.delivery_fee || 0),
            totalAmount: Number(row.total_amount || 0),
            paymentMethod: row.payment_method,
            fulfillmentType: row.fulfillment_type,
          }));
        }
      } catch (err) {
        console.warn('[customerRepository] Falha ao consultar histórico de pedidos:', err);
      }
    }

    requireBackendOrLocalDemo('histórico do cliente');
    const localOrders = dataStore.getOrders(context, tenantId).filter((o) => o.customerId === customerId);
    return localOrders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      status: o.status,
      subtotal: o.subtotal,
      discount: o.discount,
      deliveryFee: o.deliveryFee,
      totalAmount: o.totalAmount,
      paymentMethod: o.paymentMethod,
      fulfillmentType: o.fulfillmentType,
    }));
  },

  /**
   * Cadastro manual de um novo cliente pelo lojista
   */
  async createCustomerManual(
    _context: SecurityContext,
    tenantId: string,
    input: CreateCustomerInput
  ): Promise<void> {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase não configurado.');
    }

    const { error: rpcError } = await supabase.rpc('create_tenant_customer_manual', {
      p_tenant_id: tenantId,
      p_name: input.name,
      p_phone: input.phone,
      p_email: input.email || null,
      p_origin: input.origin,
      p_consent_lgpd: input.consentLgpd,
    });

    if (rpcError) {
      if (
        rpcError.message.includes('Já existe um cliente cadastrado com este telefone') ||
        rpcError.message.includes('unique')
      ) {
        throw new Error('Já existe um cliente com este telefone cadastrado neste estabelecimento.');
      }
      throw new Error(`Falha ao cadastrar cliente: ${rpcError.message}`);
    }
  },

  /**
   * Inscrição em tempo real para alterações de clientes ou pedidos
   */
  subscribeToCustomers(tenantId: string, callback: () => void): () => void {
    if (!isSupabaseConfigured || !isValidUuid(tenantId)) {
      if (canUseLocalDemoCrm(tenantId)) {
        return dataStore.subscribe(callback);
      }
      return localOnly('clientes', () => dataStore.subscribe(callback));
    }

    const channelName = `crm_customers_realtime_${tenantId}_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customers', filter: `tenant_id=eq.${tenantId}` },
        () => callback()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
        () => callback()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};
