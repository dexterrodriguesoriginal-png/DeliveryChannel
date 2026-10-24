import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  FileDown,
  Filter,
  History,
  Lock,
  MessageCircle,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Store,
  Tag,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import {
  CustomerCrmItem,
  CustomerCrmOrderHistoryItem,
  CreateCustomerInput,
  customerRepository,
} from '../../repositories/customerRepository';
import { CustomerOrigin } from '../../types';
import { formatBRL } from '../../lib/pricing/money';
import { orderStatusLabel, paymentMethodLabel, fulfillmentLabel } from '../../lib/orders/labels';
import {
  CUSTOMER_SEGMENT_META,
  CustomerCrmOverviewMetrics,
  CustomerCrmSegment,
  CustomerCrmSortBy,
  CustomerRegistrationKind,
  SUGGESTED_CRM_TAGS,
  classifyCustomerSegment,
  computeCrmOverviewMetrics,
  computeCustomerAverageTicket,
  computeCustomerOrderInsights,
  computeDaysSinceLastOrder,
  customerWhatsAppLink,
  filterAndSortCrmCustomers,
  formatCustomerPhone,
  resolveCustomerOriginMeta,
   sanitizeCustomerTags,
  validateManualCustomerInput,
} from '../../lib/customer/crm';

const PAGE_SIZE = 15;

interface ManualCustomerFormState extends CreateCustomerInput {
  initialTagsText: string;
  initialNotes: string;
}

const EMPTY_FORM: ManualCustomerFormState = {
  name: '',
  phone: '',
  email: '',
  origin: 'whatsapp',
  consentLgpd: false,
  contactConsent: false,
  initialTagsText: '',
  initialNotes: '',
};

const SEGMENT_TONE_CLASSES: Record<
  CustomerCrmSegment,
  { text: string; dot: string; activeBg: string }
> = {
  VIP: {
    text: 'text-emerald-800',
    dot: 'bg-emerald-600',
    activeBg: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  },
  RECORRENTE: {
    text: 'text-sky-800',
    dot: 'bg-sky-600',
    activeBg: 'bg-sky-50 text-sky-900 border-sky-200',
  },
  NOVO: {
    text: 'text-amber-800',
    dot: 'bg-amber-500',
    activeBg: 'bg-amber-50 text-amber-900 border-amber-200',
  },
  INATIVO: {
    text: 'text-rose-800',
    dot: 'bg-rose-600',
    activeBg: 'bg-rose-50 text-rose-900 border-rose-200',
  },
  SEM_PEDIDOS: {
    text: 'text-slate-600',
    dot: 'bg-slate-400',
    activeBg: 'bg-slate-100 text-slate-800 border-slate-200',
  },
};

function formatDate(value?: string, withTime = false): string {
  if (!value) return 'Ainda sem pedidos';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(
    'pt-BR',
    withTime
      ? { dateStyle: 'short', timeStyle: 'short' }
      : { dateStyle: 'medium' }
  );
}

function formatRelativeRecency(lastOrderAt?: string): string {
  const days = computeDaysSinceLastOrder(lastOrderAt);
  if (days === null) return 'Sem compras concluídas';
  if (days === 0) return 'Comprou hoje';
  if (days === 1) return 'Há 1 dia';
  return `Há ${days} dias`;
}

function csvCell(value: string | number | boolean): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export const CustomersPage: React.FC = () => {
  const { activeTenant, activeRole } = useAuth();
  const { showToast } = useToast();

  const [customers, setCustomers] = useState<CustomerCrmItem[]>([]);
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [origin, setOrigin] = useState('ALL');
  const [registrationKind, setRegistrationKind] = useState<'ALL' | CustomerRegistrationKind>('ALL');
  const [segmentFilter, setSegmentFilter] = useState<'ALL' | CustomerCrmSegment>('ALL');
  const [consentFilter, setConsentFilter] = useState<
    'ALL' | 'WHATSAPP_ALLOWED' | 'NO_WHATSAPP' | 'LGPD_PENDING'
  >('ALL');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<CustomerCrmSortBy>('RECENT_CREATED');

  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [globalMetrics, setGlobalMetrics] = useState<CustomerCrmOverviewMetrics | null>(null);

  // Drawer details state
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerCrmItem | null>(null);
  const [drawerTab, setDrawerTab] = useState<'overview' | 'orders' | 'privacy'>('overview');
  const [orders, setOrders] = useState<CustomerCrmOrderHistoryItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [notes, setNotes] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [savingPrivateData, setSavingPrivateData] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Create / Edit manual customer modal state
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerCrmItem | null>(null);
  const [customerForm, setCustomerForm] = useState<ManualCustomerFormState>(EMPTY_FORM);
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Confirm hide modal state
  const [customerToHide, setCustomerToHide] = useState<CustomerCrmItem | null>(null);
  const [hidingCustomer, setHidingCustomer] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(search.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadCustomers = useCallback(async () => {
    if (!activeTenant?.id) return;
    setLoading(true);
    setError('');
    try {
      const [response, metrics] = await Promise.all([
        customerRepository.getCrmCustomers(activeTenant.id, {
          search: searchQuery,
          origin,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
        customerRepository.getCrmOverviewMetrics(activeTenant.id).catch((err) => {
          console.warn('[CustomersPage] Não foi possível carregar métricas globais consolidadas:', err);
          return null;
        }),
      ]);
      setCustomers(response.customers);
      setTotalCount(response.totalCount);
      if (metrics) {
        setGlobalMetrics(metrics);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Falha ao carregar clientes.';
      setError(message);
      console.error('[CustomersPage] Não foi possível carregar o CRM:', cause);
    } finally {
      setLoading(false);
    }
  }, [activeTenant?.id, origin, page, searchQuery]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const currentOrigin = useMemo(
    () => (value: string) => resolveCustomerOriginMeta(value),
    []
  );

  // Client-side refinement (segmentation, registration type, consent, tags, sorting)
  const visibleCustomers = useMemo(() => {
    return filterAndSortCrmCustomers(customers, {
      search: searchQuery,
      origin,
      registrationKind,
      segment: segmentFilter,
      consent: consentFilter,
      tag: selectedTagFilter,
      sortBy,
    });
  }, [
    customers,
    searchQuery,
    origin,
    registrationKind,
    segmentFilter,
    consentFilter,
    selectedTagFilter,
    sortBy,
  ]);

  const fallbackMetrics = useMemo(
    () => computeCrmOverviewMetrics(customers, totalCount),
    [customers, totalCount]
  );
  const overviewMetrics = globalMetrics || fallbackMetrics;

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of customers) {
      for (const t of c.tags || []) {
        const clean = t.trim();
        if (!clean) continue;
        counts.set(clean, (counts.get(clean) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }));
  }, [customers]);

  const orderInsights = useMemo(
    () => computeCustomerOrderInsights(orders),
    [orders]
  );

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const hasActiveFilters =
    Boolean(search.trim()) ||
    origin !== 'ALL' ||
    registrationKind !== 'ALL' ||
    segmentFilter !== 'ALL' ||
    consentFilter !== 'ALL' ||
    Boolean(selectedTagFilter) ||
    sortBy !== 'RECENT_CREATED';

  const clearAllFilters = () => {
    setSearch('');
    setSearchQuery('');
    setOrigin('ALL');
    setRegistrationKind('ALL');
    setSegmentFilter('ALL');
    setConsentFilter('ALL');
    setSelectedTagFilter('');
    setSortBy('RECENT_CREATED');
    setPage(0);
  };

  const openCustomer = async (
    customer: CustomerCrmItem,
    initialTab: 'overview' | 'orders' | 'privacy' = 'overview'
  ) => {
    setSelectedCustomer(customer);
    setDrawerTab(initialTab);
    setNotes(customer.notes);
    setTagsText(customer.tags.join(', '));
    setOrders([]);
    if (!activeTenant?.id) return;
    setLoadingOrders(true);
    try {
      const history = await customerRepository.getCrmCustomerOrderHistory(
        activeTenant.id,
        customer.id
      );
      setOrders(history);
    } catch (cause) {
      showToast({
        type: 'error',
        title: 'Histórico indisponível',
        message: cause instanceof Error ? cause.message : 'Não foi possível carregar os pedidos.',
      });
    } finally {
      setLoadingOrders(false);
    }
  };

  const closeCustomer = () => {
    setSelectedCustomer(null);
    setOrders([]);
  };

  const toggleSuggestedTag = (tagToToggle: string) => {
    const current = sanitizeCustomerTags(tagsText);
    const exists = current.some((t) => t.toLowerCase() === tagToToggle.toLowerCase());
    const next = exists
      ? current.filter((t) => t.toLowerCase() !== tagToToggle.toLowerCase())
      : [...current, tagToToggle].slice(0, 10);
    setTagsText(next.join(', '));
  };

  const savePrivateData = async () => {
    if (!activeTenant?.id || !selectedCustomer) return;
    setSavingPrivateData(true);
    try {
      const tags = sanitizeCustomerTags(tagsText);
      await customerRepository.saveCrmCustomerPrivateData(
        activeTenant.id,
        selectedCustomer.id,
        notes,
        tags
      );
      setSelectedCustomer((curr) =>
        curr && curr.id === selectedCustomer.id ? { ...curr, notes, tags } : curr
      );
      showToast({
        type: 'success',
        title: 'Dados privados salvos',
        message: 'Observações e etiquetas da loja foram atualizadas.',
      });
      await loadCustomers();
    } catch (cause) {
      showToast({
        type: 'error',
        title: 'Não foi possível salvar',
        message: cause instanceof Error ? cause.message : 'Falha ao salvar os dados privados.',
      });
    } finally {
      setSavingPrivateData(false);
    }
  };

  const requestHideCustomer = (customer: CustomerCrmItem) => {
    setCustomerToHide(customer);
  };

  const confirmHideCustomer = async () => {
    if (!activeTenant?.id || !customerToHide) return;
    setHidingCustomer(true);
    try {
      await customerRepository.hideCrmCustomer(activeTenant.id, customerToHide.id);
      if (selectedCustomer?.id === customerToHide.id) closeCustomer();
      setCustomerToHide(null);
      showToast({
        type: 'success',
        title: 'Cliente removido da lista',
        message: 'A conta e o histórico comercial foram preservados.',
      });
      await loadCustomers();
    } catch (cause) {
      showToast({
        type: 'error',
        title: 'Não foi possível remover',
        message: cause instanceof Error ? cause.message : 'Falha ao ocultar cliente.',
      });
    } finally {
      setHidingCustomer(false);
    }
  };

  const contactCustomer = async (customer: CustomerCrmItem, customText?: string) => {
    if (!activeTenant?.id) return;
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      showToast({
        type: 'error',
        title: 'Ação bloqueada',
        message: 'Permita a abertura de uma nova aba para usar o WhatsApp.',
      });
      return;
    }
    try {
      const phone = await customerRepository.getCrmCustomerContactTarget(
        activeTenant.id,
        customer.id
      );
      const link = customerWhatsAppLink(phone, true, customText);
      if (!link) throw new Error('O telefone autorizado não é válido para abrir o WhatsApp.');
      popup.opener = null;
      popup.location.href = link;
    } catch (cause) {
      popup.close();
      showToast({
        type: 'error',
        title: 'Contato não autorizado',
        message:
          cause instanceof Error ? cause.message : 'A permissão de contato não está ativa.',
      });
      await loadCustomers();
    }
  };

  const copyPhoneToClipboard = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(formatCustomerPhone(phone));
      setCopiedPhone(true);
      window.setTimeout(() => setCopiedPhone(false), 1800);
    } catch {
      // clipboard unavailable
    }
  };

  const startCreateCustomer = () => {
    setEditingCustomer(null);
    setCustomerForm(EMPTY_FORM);
    setCustomerFormOpen(true);
  };

  const startEditCustomer = (customer: CustomerCrmItem) => {
    setEditingCustomer(customer);
    setCustomerForm({
      name: customer.name,
      phone: customer.phone,
      email: customer.email || '',
      origin: customer.origin,
      consentLgpd: true,
      contactConsent: customer.contactConsent,
      initialTagsText: (customer.tags || []).join(', '),
      initialNotes: customer.notes || '',
    });
    setCustomerFormOpen(true);
  };

  const saveCustomer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeTenant?.id) return;

    const validation = validateManualCustomerInput(customerForm, Boolean(editingCustomer));
    if (!validation.valid) {
      showToast({
        type: 'error',
        title: editingCustomer ? 'Dados inválidos' : 'Consentimento ou dados pendentes',
        message: validation.error || 'Verifique os campos informados.',
      });
      return;
    }

    setSavingCustomer(true);
    try {
      const parsedTags = sanitizeCustomerTags(customerForm.initialTagsText);
      const cleanNotes = customerForm.initialNotes.trim().slice(0, 5000);

      if (editingCustomer) {
        await customerRepository.updateCrmManualCustomer(activeTenant.id, editingCustomer.id, {
          name: customerForm.name.trim(),
          phone: customerForm.phone.trim(),
          email: customerForm.email?.trim() || undefined,
          origin: customerForm.origin,
          contactConsent: customerForm.contactConsent,
          notes: cleanNotes,
          tags: parsedTags,
        });
        if (
          cleanNotes !== (editingCustomer.notes || '') ||
          parsedTags.join(',') !== (editingCustomer.tags || []).join(',')
        ) {
          try {
            await customerRepository.saveCrmCustomerPrivateData(
              activeTenant.id,
              editingCustomer.id,
              cleanNotes,
              parsedTags
            );
          } catch {
            // private data update is best-effort after manual update
          }
        }
      } else {
        await customerRepository.createCrmManualCustomer(activeTenant.id, {
          name: customerForm.name.trim(),
          phone: customerForm.phone.trim(),
          email: customerForm.email?.trim() || undefined,
          origin: customerForm.origin,
          consentLgpd: customerForm.consentLgpd,
          contactConsent: customerForm.contactConsent,
          notes: cleanNotes || undefined,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
        });
      }

      setCustomerFormOpen(false);
      const wasEditing = editingCustomer;
      setEditingCustomer(null);
      showToast({
        type: 'success',
        title: wasEditing ? 'Cadastro atualizado' : 'Cliente adicionado',
        message: wasEditing
          ? 'O registro manual desta loja foi atualizado.'
          : 'O cliente foi adicionado à base comercial desta loja.',
      });
      await loadCustomers();

      if (wasEditing) {
        setSelectedCustomer((current) =>
          current?.id === wasEditing.id
            ? {
                ...current,
                name: customerForm.name.trim(),
                phone: customerForm.phone.trim(),
                email: customerForm.email?.trim() || undefined,
                origin: customerForm.origin,
                contactConsent: customerForm.contactConsent,
                notes: cleanNotes,
                tags: parsedTags,
              }
            : current
        );
        setNotes(cleanNotes);
        setTagsText(parsedTags.join(', '));
      }
    } catch (cause) {
      showToast({
        type: 'error',
        title: 'Não foi possível salvar',
        message: cause instanceof Error ? cause.message : 'Falha ao salvar o cliente.',
      });
    } finally {
      setSavingCustomer(false);
    }
  };

  const exportCustomers = async () => {
    if (!activeTenant?.id) return;
    try {
      const rows = await customerRepository.exportCrmCustomers(
        activeTenant.id,
        searchQuery,
        origin
      );
      const header = [
        'Nome',
        'Telefone',
        'Canal',
        'Pedidos',
        'Ticket medio',
        'Total gasto',
        'Ultimo pedido',
        'Contato permitido',
      ];
      const csv = [
        header.map(csvCell).join(';'),
        ...rows.map((row) => {
          const avgTicket =
            row.totalOrders > 0 ? (row.totalSpent / row.totalOrders).toFixed(2) : '0.00';
          return [
            row.name,
            row.phone,
            currentOrigin(row.origin).label,
            row.totalOrders,
            avgTicket,
            row.totalSpent.toFixed(2),
            row.lastOrderAt ? formatDate(row.lastOrderAt) : '',
            row.contactConsent ? 'Sim' : 'Não',
          ]
            .map(csvCell)
            .join(';');
        }),
      ].join('\n');
      const objectUrl = URL.createObjectURL(
        new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
      );
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `clientes-${activeTenant.slug}.csv`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      showToast({
        type: 'success',
        title: 'Exportação concluída',
        message: `${rows.length} clientes exportados em CSV.`,
      });
    } catch (cause) {
      showToast({
        type: 'error',
        title: 'Exportação indisponível',
        message: cause instanceof Error ? cause.message : 'Não foi possível exportar clientes.',
      });
    }
  };

  if (!activeTenant) return null;

  const selectedSegment = selectedCustomer
    ? classifyCustomerSegment(selectedCustomer)
    : 'SEM_PEDIDOS';
  const selectedSegmentMeta = CUSTOMER_SEGMENT_META[selectedSegment];
  const selectedAvgTicket = selectedCustomer
    ? computeCustomerAverageTicket(selectedCustomer)
    : 0;

  return (
    <div className="space-y-5">
      {/* Cabeçalho Principal */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Clientes</h1>
            <span className="text-xs font-medium text-slate-500">
              · CRM Comercial &amp; Relacionamento
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Base unificada de clientes da loja digital (App, Link / QR Code) e cadastros presenciais.
            Histórico e anotações são exclusivos de <strong className="font-medium text-slate-700">{activeTenant.name}</strong>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {activeRole === 'OWNER' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportCustomers()}
              leftIcon={<FileDown className="h-4 w-4" />}
            >
              Exportar
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={startCreateCustomer}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Adicionar cliente
          </Button>
        </div>
      </header>

      {/* Visão Geral / Indicadores Executivos */}
      <section aria-label="Indicadores da base de clientes" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total na Base da Loja</span>
            <Users className="h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {overviewMetrics.totalCustomers}
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
            <span>{overviewMetrics.appCustomers} conta digital</span>
            <span aria-hidden="true">·</span>
            <span>{overviewMetrics.manualCustomers} manual</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Clientes com Compras</span>
            <UserCheck className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="font-mono text-2xl font-bold tabular-nums text-slate-900">
              {overviewMetrics.customersWithOrders}
            </p>
            <span className="text-xs text-emerald-700 font-medium tabular-nums">
              {overviewMetrics.recurringCustomers} recorrentes
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
            <span>{overviewMetrics.vipCustomers} VIP</span>
            <span aria-hidden="true">·</span>
            <span>{overviewMetrics.withoutOrdersCustomers} sem pedidos</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Receita Acumulada &amp; Ticket</span>
            <TrendingUp className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {formatBRL(overviewMetrics.totalRevenue)}
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
            <span>Ticket médio: {formatBRL(overviewMetrics.averageTicket)}</span>
            <span aria-hidden="true">·</span>
            <span>{overviewMetrics.totalOrdersCount} pedidos</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Permissão de Contato &amp; Retenção</span>
            <MessageCircle className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="font-mono text-2xl font-bold tabular-nums text-slate-900">
              {overviewMetrics.contactConsentCount}
            </p>
            <span className="text-xs text-slate-500">WhatsApp autorizado</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
            <span>{overviewMetrics.lgpdConsentCount} com LGPD</span>
            <span aria-hidden="true">·</span>
            <span className={overviewMetrics.inactiveCustomers > 0 ? 'text-amber-700 font-medium' : ''}>
              {overviewMetrics.inactiveCustomers} inativos (+45d)
            </span>
          </div>
        </div>
      </section>

      {/* Barra de Segmentação Rápida, Busca e Filtros */}
      <Card className="p-4 space-y-3">
        {/* Abas de Segmento Comercial */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-lg" role="group" aria-label="Filtrar por segmento comercial">
            {(
              [
                { id: 'ALL', label: 'Todos', count: overviewMetrics.totalCustomers },
                { id: 'VIP', label: 'VIP', count: overviewMetrics.vipCustomers },
                { id: 'RECORRENTE', label: 'Recorrentes', count: overviewMetrics.recurringCustomers },
                { id: 'NOVO', label: '1ª Compra', count: overviewMetrics.newCustomers },
                { id: 'INATIVO', label: 'Inativos (+45d)', count: overviewMetrics.inactiveCustomers },
                { id: 'SEM_PEDIDOS', label: 'Sem compras', count: overviewMetrics.withoutOrdersCustomers },
              ] as const
            ).map((tab) => {
              const active = segmentFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSegmentFilter(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}{' '}
                  <span className="ml-1 font-mono text-[11px] text-slate-400 tabular-nums">
                    ({tab.count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Filtro rápido por Tipo de Vínculo (Conta App vs Manual) */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg" role="group" aria-label="Filtrar por tipo de vínculo">
            {(
              [
                { id: 'ALL', label: 'Toda a base' },
                { id: 'APP', label: 'Loja Digital / App' },
                { id: 'MANUAL', label: 'Cadastro Manual' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setRegistrationKind(item.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  registrationKind === item.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Linha de Busca + Canal + Consentimento + Ordenação */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1 relative">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, telefone, e-mail ou etiqueta"
              leftIcon={<Search className="h-4 w-4 text-slate-400" />}
              aria-label="Buscar clientes"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Limpar busca"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor="customer-origin" className="text-xs font-semibold text-slate-500 whitespace-nowrap">
                Canal
              </label>
              <select
                id="customer-origin"
                value={origin}
                onChange={(event) => {
                  setOrigin(event.target.value);
                  setPage(0);
                }}
                className="min-h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
              >
                <option value="ALL">Todos</option>
                <option value="qr_code">Link / QR Code</option>
                <option value="storefront">Loja online</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="direct">Acesso direto</option>
                <option value="direto">Balcão / Direto</option>
                <option value="pos">Balcão / PDV</option>
                <option value="marketplace">Marketplace</option>
                <option value="instagram">Instagram</option>
                <option value="google">Google</option>
                <option value="indicacao">Indicação</option>
                <option value="outros">Outros</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="customer-consent-filter" className="text-xs font-semibold text-slate-500 whitespace-nowrap">
                Contato
              </label>
              <select
                id="customer-consent-filter"
                value={consentFilter}
                onChange={(event) =>
                  setConsentFilter(
                    event.target.value as 'ALL' | 'WHATSAPP_ALLOWED' | 'NO_WHATSAPP' | 'LGPD_PENDING'
                  )
                }
                className="min-h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
              >
                <option value="ALL">Todos os status</option>
                <option value="WHATSAPP_ALLOWED">WhatsApp autorizado</option>
                <option value="NO_WHATSAPP">Sem autorização WhatsApp</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="customer-sort" className="text-xs font-semibold text-slate-500 whitespace-nowrap">
                Ordenar
              </label>
              <select
                id="customer-sort"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as CustomerCrmSortBy)}
                className="min-h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
              >
                <option value="RECENT_CREATED">Cadastro mais recente</option>
                <option value="LAST_ORDER_DESC">Último pedido mais recente</option>
                <option value="TOTAL_SPENT_DESC">Maior total gasto (LTV)</option>
                <option value="TOTAL_ORDERS_DESC">Maior nº de pedidos</option>
                <option value="TICKET_AVG_DESC">Maior ticket médio</option>
                <option value="NAME_ASC">Nome (A–Z)</option>
              </select>
            </div>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                Limpar filtros
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadCustomers()}
              disabled={loading}
              aria-label="Atualizar lista"
              title="Atualizar lista"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Filtro Rápido por Etiquetas da Loja (quando existirem etiquetas) */}
        {availableTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
            <span className="inline-flex items-center gap-1 text-slate-500 font-medium mr-1">
              <Tag className="h-3.5 w-3.5 text-slate-400" />
              Etiquetas da loja:
            </span>
            {availableTags.map(({ tag, count }) => {
              const isSelected = selectedTagFilter.toLowerCase() === tag.toLowerCase();
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTagFilter(isSelected ? '' : tag)}
                  className={`px-2 py-0.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 border ${
                    isSelected
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tag} ({count})
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Estado de Erro ou Tabela Principal */}
      {error ? (
        <Card className="p-8 text-center">
          <p className="font-semibold text-slate-900">Não foi possível carregar o CRM</p>
          <p className="mt-1 text-sm text-slate-500">{error}</p>
          <Button className="mt-4" variant="outline" size="sm" onClick={() => void loadCustomers()}>
            Tentar novamente
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-3">Cliente &amp; Vínculo</th>
                  <th className="px-4 py-3">Segmento</th>
                  <th className="px-4 py-3">Canal</th>
                  <th className="px-4 py-3 text-center">Pedidos</th>
                  <th className="px-4 py-3">Último pedido</th>
                  <th className="px-4 py-3 text-right">Total gasto / Ticket</th>
                  <th className="px-4 py-3">Consentimento</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && customers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-slate-500">
                      <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      Carregando clientes…
                    </td>
                  </tr>
                ) : visibleCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center">
                      <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                      <p className="font-semibold text-slate-800">Nenhum cliente nesta busca</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {hasActiveFilters
                          ? 'Tente ajustar os filtros de segmento, canal ou termo pesquisado.'
                          : 'Clientes da loja aparecem após cadastro manual ou primeiro pedido na loja digital.'}
                      </p>
                      <div className="mt-4 flex items-center justify-center gap-2">
                        {hasActiveFilters && (
                          <Button variant="outline" size="sm" onClick={clearAllFilters}>
                            Limpar filtros
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={startCreateCustomer}
                          leftIcon={<Plus className="h-4 w-4" />}
                        >
                          Adicionar cliente manual
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  visibleCustomers.map((customer) => {
                    const channel = currentOrigin(customer.origin);
                    const chatLink = customerWhatsAppLink(customer.phone, customer.contactConsent);
                    const segment = classifyCustomerSegment(customer);
                    const segmentMeta = CUSTOMER_SEGMENT_META[segment];
                    const segmentTone = SEGMENT_TONE_CLASSES[segment];
                    const avgTicket = computeCustomerAverageTicket(customer);

                    return (
                      <tr key={customer.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="text-left group"
                            onClick={() => void openCustomer(customer, 'overview')}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900 group-hover:text-emerald-800 transition-colors">
                                {customer.name}
                              </span>
                              <span className="text-[11px] font-medium text-slate-400">
                                {customer.isManual ? 'Manual' : 'Conta App'}
                              </span>
                              {customer.notes && (
                                <span
                                  title="Possui anotação privada da loja"
                                  className="inline-flex items-center text-amber-600"
                                >
                                  <NotebookPen className="h-3.5 w-3.5" />
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 font-mono tabular-nums">
                              <span>{formatCustomerPhone(customer.phone)}</span>
                              {customer.isManual && customer.email && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-sans truncate max-w-[180px]">
                                    {customer.email}
                                  </span>
                                </>
                              )}
                            </div>
                            {customer.tags && customer.tags.length > 0 && (
                              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                                {customer.tags.slice(0, 3).map((tag, idx) => (
                                  <React.Fragment key={tag}>
                                    {idx > 0 && <span aria-hidden="true">·</span>}
                                    <span className="text-slate-600 font-medium">{tag}</span>
                                  </React.Fragment>
                                ))}
                                {customer.tags.length > 3 && (
                                  <span className="text-slate-400">+{customer.tags.length - 3}</span>
                                )}
                              </div>
                            )}
                          </button>
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className={`text-xs font-semibold ${segmentTone.text}`}>
                              {segmentMeta.label}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {formatRelativeRecency(customer.lastOrderAt)}
                            </span>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <Badge variant={channel.variant} size="sm">
                            {channel.label}
                          </Badge>
                        </td>

                        <td className="px-4 py-3 text-center font-mono font-semibold tabular-nums text-slate-800">
                          {customer.totalOrders}
                        </td>

                        <td className="px-4 py-3 text-xs text-slate-600 tabular-nums">
                          {formatDate(customer.lastOrderAt)}
                        </td>

                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          <span className="block font-semibold text-slate-900">
                            {formatBRL(customer.totalSpent)}
                          </span>
                          {customer.totalOrders > 0 && (
                            <span className="block text-[11px] text-slate-400">
                              Ticket: {formatBRL(avgTicket)}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1 text-xs">
                            <span
                              className={`inline-flex items-center gap-1 ${
                                customer.hasLgpdConsent ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              {customer.hasLgpdConsent ? (
                                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                              ) : (
                                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                              )}
                              Dados {customer.hasLgpdConsent ? 'registrados' : 'sem registro'}
                            </span>
                            <span
                              className={
                                customer.contactConsent ? 'text-emerald-700 font-medium' : 'text-slate-400'
                              }
                            >
                              Contato {customer.contactConsent ? 'permitido' : 'não autorizado'}
                            </span>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            {chatLink && (
                              <button
                                type="button"
                                onClick={() => void contactCustomer(customer)}
                                aria-label={`Abrir WhatsApp de ${customer.name}`}
                                title="WhatsApp autorizado"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-50 transition-colors"
                              >
                                <MessageCircle className="h-4 w-4" />
                              </button>
                            )}
                            {customer.isManual && (
                              <button
                                type="button"
                                onClick={() => startEditCustomer(customer)}
                                aria-label={`Editar cadastro de ${customer.name}`}
                                title="Editar cadastro manual"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void openCustomer(customer, 'overview')}
                              aria-label={`Ver histórico de ${customer.name}`}
                              title="Ficha comercial e histórico"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                              <History className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestHideCustomer(customer)}
                              aria-label={`Remover ${customer.name} desta lista`}
                              title="Remover desta loja"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700 transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Rodapé de Paginação */}
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <span className="font-mono tabular-nums">
              {visibleCustomers.length === totalCount
                ? `${totalCount} clientes`
                : `Exibindo ${visibleCustomers.length} de ${totalCount} clientes`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0 || loading}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                <ChevronLeft className="h-4 w-4" /> Anterior
              </Button>
              <span className="font-mono tabular-nums">
                {page + 1} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pageCount || loading}
                onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              >
                Próxima <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Modal de Cadastro / Edição de Cliente Manual */}
      {customerFormOpen && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="customer-form-title"
        >
          <form
            onSubmit={(event) => void saveCustomer(event)}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-2xl border border-slate-200 my-8"
          >
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 id="customer-form-title" className="text-base font-bold text-slate-900">
                  {editingCustomer ? 'Editar cliente manual' : 'Adicionar cliente'}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Para clientes atendidos presencialmente no balcão, por telefone ou WhatsApp da loja.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustomerFormOpen(false)}
                aria-label="Fechar"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">
                Nome completo
                <Input
                  required
                  minLength={2}
                  maxLength={255}
                  value={customerForm.name}
                  onChange={(event) =>
                    setCustomerForm({ ...customerForm, name: event.target.value })
                  }
                  placeholder="Ex.: Maria Fernanda Costa"
                  className="mt-1"
                />
              </label>

              <label className="block text-xs font-semibold text-slate-700">
                Telefone com DDD
                <Input
                  required
                  value={customerForm.phone}
                  onChange={(event) =>
                    setCustomerForm({ ...customerForm, phone: event.target.value })
                  }
                  placeholder="(11) 99999-8888"
                  className="mt-1"
                />
              </label>

              <label className="block text-xs font-semibold text-slate-700">
                Canal de origem
                <select
                  value={customerForm.origin}
                  onChange={(event) =>
                    setCustomerForm({
                      ...customerForm,
                      origin: event.target.value as CustomerOrigin,
                    })
                  }
                  className="mt-1 min-h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
                >
                  <option value="whatsapp">WhatsApp / telefone</option>
                  <option value="direct">Balcão / acesso direto</option>
                  <option value="indicacao">Indicação</option>
                  <option value="outros">Outros</option>
                </select>
              </label>

              <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">
                E-mail (opcional)
                <Input
                  type="email"
                  value={customerForm.email || ''}
                  onChange={(event) =>
                    setCustomerForm({ ...customerForm, email: event.target.value })
                  }
                  placeholder="cliente@exemplo.com.br"
                  className="mt-1"
                />
              </label>

              <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">
                Etiquetas comerciais da loja (opcional)
                <Input
                  value={customerForm.initialTagsText}
                  onChange={(event) =>
                    setCustomerForm({ ...customerForm, initialTagsText: event.target.value })
                  }
                  placeholder="VIP, Prefere retirada, Cliente semanal (separadas por vírgula)"
                  className="mt-1"
                />
              </label>

              <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">
                Observação privada da loja (opcional)
                <textarea
                  rows={2}
                  maxLength={5000}
                  value={customerForm.initialNotes}
                  onChange={(event) =>
                    setCustomerForm({ ...customerForm, initialNotes: event.target.value })
                  }
                  placeholder="Ex.: Cliente recorrente do bairro, costuma pedir às sextas-feiras."
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                />
              </label>
            </div>

            <div className="space-y-2.5 rounded-xl bg-slate-50 p-3 border border-slate-100">
              {!editingCustomer && (
                <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    required
                    checked={customerForm.consentLgpd}
                    onChange={(event) =>
                      setCustomerForm({ ...customerForm, consentLgpd: event.target.checked })
                    }
                    className="mt-0.5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>
                    Consentimento LGPD para registrar os dados deste cliente nesta loja foi obtido e
                    confirmado.
                  </span>
                </label>
              )}

              <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={customerForm.contactConsent}
                  onChange={(event) =>
                    setCustomerForm({ ...customerForm, contactConsent: event.target.checked })
                  }
                  className="mt-0.5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                />
                <span>
                  O cliente autorizou mensagens comerciais e ofertas pelo WhatsApp. Sem esta
                  autorização, o botão de contato direto não será exibido.
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCustomerFormOpen(false)}
                disabled={savingCustomer}
              >
                Cancelar
              </Button>
              <Button type="submit" size="sm" isLoading={savingCustomer}>
                {editingCustomer ? 'Salvar alterações' : 'Cadastrar cliente'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Confirmação para Ocultar Cliente da Lista da Loja */}
      {customerToHide && (
        <div
          className="fixed inset-0 z-[1250] flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hide-customer-title"
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-2xl border border-slate-200">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-rose-50 p-2 text-rose-600 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 id="hide-customer-title" className="text-base font-bold text-slate-900">
                  Remover {customerToHide.name} da lista desta loja?
                </h2>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  O cliente deixará de aparecer na listagem ativa de{' '}
                  <strong>{activeTenant.name}</strong>. A conta do cliente no aplicativo e o
                  histórico fiscal/comercial de pedidos permanecem íntegros.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCustomerToHide(null)}
                disabled={hidingCustomer}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                isLoading={hidingCustomer}
                onClick={() => void confirmHideCustomer()}
              >
                Confirmar remoção da lista
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Ficha Completa do Cliente (Drawer Lateral de CRM) */}
      {selectedCustomer && (
        <div
          className="fixed inset-0 z-[1100] flex justify-end bg-slate-900/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="customer-detail-title"
        >
          <aside className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
            {/* Cabeçalho da Ficha do Cliente */}
            <div className="flex items-start justify-between border-b border-slate-200 p-5">
              <div className="min-w-0 flex-1 pr-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="customer-detail-title" className="text-lg font-bold text-slate-900 truncate">
                    {selectedCustomer.name}
                  </h2>
                  <Badge variant={currentOrigin(selectedCustomer.origin).variant} size="sm">
                    {currentOrigin(selectedCustomer.origin).label}
                  </Badge>
                  {selectedCustomer.isManual ? (
                    <Badge variant="neutral" size="sm">
                      Cadastro manual
                    </Badge>
                  ) : (
                    <Badge variant="info" size="sm">
                      Conta App / Digital
                    </Badge>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-600 font-mono tabular-nums">
                  <span>{formatCustomerPhone(selectedCustomer.phone)}</span>
                  <button
                    type="button"
                    onClick={() => void copyPhoneToClipboard(selectedCustomer.phone)}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    title="Copiar telefone"
                  >
                    {copiedPhone ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-600" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copiar
                      </>
                    )}
                  </button>
                  {selectedCustomer.isManual && selectedCustomer.email && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-sans text-slate-500">{selectedCustomer.email}</span>
                    </>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`font-semibold ${SEGMENT_TONE_CLASSES[selectedSegment].text}`}>
                    Segmento: {selectedSegmentMeta.label}
                  </span>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="text-slate-500">
                    {formatRelativeRecency(selectedCustomer.lastOrderAt)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {selectedCustomer.contactConsent && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void contactCustomer(selectedCustomer)}
                    leftIcon={<MessageCircle className="h-4 w-4 text-emerald-700" />}
                  >
                    WhatsApp
                  </Button>
                )}
                {selectedCustomer.isManual && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => startEditCustomer(selectedCustomer)}
                    leftIcon={<Pencil className="h-4 w-4" />}
                  >
                    Editar
                  </Button>
                )}
                <button
                  type="button"
                  onClick={closeCustomer}
                  aria-label="Fechar detalhes"
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Navegação interna da Ficha */}
            <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-5 py-2">
              {(
                [
                  { id: 'overview', label: 'Visão Geral & Notas' },
                  { id: 'orders', label: `Histórico de Pedidos (${orders.length || selectedCustomer.totalOrders})` },
                  { id: 'privacy', label: 'Privacidade & Relacionamento' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDrawerTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    drawerTab === tab.id
                      ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Conteúdo do Drawer */}
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {/* Resumo de Indicadores do Cliente (sempre visível no topo do drawer) */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                    <span>Pedidos</span>
                    <ShoppingBag className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <p className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-900">
                    {selectedCustomer.totalOrders}
                  </p>
                  <p className="text-[10px] text-slate-500">Compras válidas</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                    <span>Total gasto</span>
                    <Clock3 className="h-3.5 w-3.5 text-emerald-700" />
                  </div>
                  <p className="mt-1 font-mono text-base font-bold tabular-nums text-emerald-800">
                    {formatBRL(selectedCustomer.totalSpent)}
                  </p>
                  <p className="text-[10px] text-slate-500">LTV acumulado</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                    <span>Ticket médio</span>
                    <Award className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <p className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900">
                    {formatBRL(selectedAvgTicket)}
                  </p>
                  <p className="text-[10px] text-slate-500">Por pedido válido</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                    <span>Último pedido</span>
                    <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <p className="mt-1 truncate text-xs font-semibold text-slate-900 tabular-nums">
                    {formatDate(selectedCustomer.lastOrderAt)}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {formatRelativeRecency(selectedCustomer.lastOrderAt)}
                  </p>
                </div>
              </div>

              {drawerTab === 'overview' && (
                <>
                  {/* Diagnóstico Comercial e Hábitos de Compra */}
                  <section className="rounded-xl border border-slate-200 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Inteligência Comercial &amp; Hábitos na Loja
                        </h3>
                        <p className="mt-1 text-sm font-medium text-slate-900">
                          {selectedSegmentMeta.description}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          {selectedSegmentMeta.recommendation}
                        </p>
                      </div>
                    </div>

                    {(orderInsights.preferredFulfillment ||
                      orderInsights.preferredPaymentMethod ||
                      orderInsights.topItems.length > 0) && (
                      <div className="border-t border-slate-100 pt-3 space-y-2.5">
                        <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                          {orderInsights.preferredFulfillment && (
                            <div>
                              <span className="text-slate-400">Modalidade mais usada: </span>
                              <strong className="font-semibold text-slate-800">
                                {fulfillmentLabel(orderInsights.preferredFulfillment)}
                              </strong>
                            </div>
                          )}
                          {orderInsights.preferredPaymentMethod && (
                            <div>
                              <span className="text-slate-400">Pagamento preferido: </span>
                              <strong className="font-semibold text-slate-800">
                                {paymentMethodLabel(orderInsights.preferredPaymentMethod)}
                              </strong>
                            </div>
                          )}
                        </div>

                        {orderInsights.topItems.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold text-slate-500 mb-1.5">
                              Produtos mais comprados nesta loja:
                            </p>
                            <div className="space-y-1">
                              {orderInsights.topItems.map((item) => (
                                <div
                                  key={item.name}
                                  className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-2.5 py-1.5"
                                >
                                  <span className="font-medium text-slate-800 truncate pr-2">
                                    {item.name}
                                  </span>
                                  <span className="font-mono text-slate-600 tabular-nums shrink-0">
                                    {item.quantity}x · {formatBRL(item.totalSpent)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>

                  {/* Anotações Privadas e Etiquetas da Loja */}
                  <section className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <NotebookPen className="h-4 w-4 text-emerald-700" />
                        <h3 className="text-sm font-semibold text-slate-900">
                          Anotações privadas da loja
                        </h3>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {notes.length}/5000
                      </span>
                    </div>
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      maxLength={5000}
                      rows={4}
                      placeholder="Escreva preferências de entrega, restrições alimentares, referências de endereço ou observações de atendimento visíveis somente para esta loja…"
                      className="w-full resize-y rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                    />

                    <div className="mb-2 mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-slate-500" />
                        <label htmlFor="customer-tags" className="text-xs font-semibold text-slate-700">
                          Etiquetas
                        </label>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Até 10 etiquetas (separadas por vírgula)
                      </span>
                    </div>
                    <Input
                      id="customer-tags"
                      value={tagsText}
                      onChange={(event) => setTagsText(event.target.value)}
                      placeholder="VIP, prefere retirada (separadas por vírgula)"
                    />

                    {/* Sugestões rápidas de etiquetas */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 mr-1">Sugestões rápidas:</span>
                      {SUGGESTED_CRM_TAGS.map((suggested) => {
                        const activeTags = sanitizeCustomerTags(tagsText);
                        const isAdded = activeTags.some(
                          (t) => t.toLowerCase() === suggested.toLowerCase()
                        );
                        return (
                          <button
                            key={suggested}
                            type="button"
                            onClick={() => toggleSuggestedTag(suggested)}
                            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors border ${
                              isAdded
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {isAdded ? `✓ ${suggested}` : `+ ${suggested}`}
                          </button>
                        );
                      })}
                    </div>

                    <p className="mt-2 text-[11px] text-slate-400">
                      Somente proprietários e gerentes autorizados de {activeTenant.name} podem ver
                      estas anotações e etiquetas.
                    </p>
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        isLoading={savingPrivateData}
                        onClick={() => void savePrivateData()}
                      >
                        Salvar notas e etiquetas
                      </Button>
                    </div>
                  </section>

                  {/* Resumo Rápido dos Últimos Pedidos */}
                  <section className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <History className="h-4 w-4 text-emerald-700" />
                        Histórico de pedidos
                      </h3>
                      {orders.length > 3 && (
                        <button
                          type="button"
                          onClick={() => setDrawerTab('orders')}
                          className="text-xs font-semibold text-emerald-700 hover:underline"
                        >
                          Ver todos ({orders.length})
                        </button>
                      )}
                    </div>
                    {loadingOrders ? (
                      <div className="p-6 text-center text-sm text-slate-500">
                        <RefreshCw className="mx-auto mb-2 h-4 w-4 animate-spin" />
                        Carregando histórico…
                      </div>
                    ) : orders.length === 0 ? (
                      <p className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-500">
                        Nenhum pedido encontrado nesta loja.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {orders.slice(0, 5).map((order) => (
                          <div
                            key={order.id}
                            className="flex items-center justify-between rounded-xl border border-slate-100 p-3 hover:bg-slate-50/60"
                          >
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                Pedido #{order.orderNumber} · {orderStatusLabel(order.status)}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                                <span>{formatDate(order.createdAt, true)}</span>
                                {order.fulfillmentType && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{fulfillmentLabel(order.fulfillmentType)}</span>
                                  </>
                                )}
                                {order.paymentMethod && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{paymentMethodLabel(order.paymentMethod)}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <p
                              className={`font-mono text-sm font-semibold tabular-nums ${
                                order.status === 'CANCELLED'
                                  ? 'text-slate-400 line-through'
                                  : 'text-slate-900'
                              }`}
                            >
                              {formatBRL(order.totalAmount)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}

              {drawerTab === 'orders' && (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 border border-slate-200">
                    <div className="flex items-center gap-3 font-mono tabular-nums">
                      <span>
                        <strong>{orderInsights.validOrdersCount}</strong> compras válidas
                      </span>
                      {orderInsights.cancelledOrdersCount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-rose-700">
                            <strong>{orderInsights.cancelledOrdersCount}</strong> cancelados (não
                            somam no LTV)
                          </span>
                        </>
                      )}
                    </div>
                    {orderInsights.firstOrderAt && (
                      <span className="text-slate-500">
                        1º pedido em {formatDate(orderInsights.firstOrderAt)}
                      </span>
                    )}
                  </div>

                  {loadingOrders ? (
                    <div className="p-8 text-center text-sm text-slate-500">
                      <RefreshCw className="mx-auto mb-2 h-4 w-4 animate-spin" />
                      Carregando histórico…
                    </div>
                  ) : orders.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-500">
                      Nenhum pedido encontrado nesta loja.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {orders.map((order) => (
                        <div
                          key={order.id}
                          className="rounded-xl border border-slate-200 p-3.5 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                Pedido #{order.orderNumber} · {orderStatusLabel(order.status)}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                                <span>{formatDate(order.createdAt, true)}</span>
                                {order.fulfillmentType && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{fulfillmentLabel(order.fulfillmentType)}</span>
                                  </>
                                )}
                                {order.paymentMethod && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{paymentMethodLabel(order.paymentMethod)}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <p
                              className={`font-mono text-sm font-bold tabular-nums ${
                                order.status === 'CANCELLED'
                                  ? 'text-slate-400 line-through'
                                  : 'text-slate-900'
                              }`}
                            >
                              {formatBRL(order.totalAmount)}
                            </p>
                          </div>

                          {order.items && order.items.length > 0 && (
                            <div className="border-t border-slate-100 pt-2 space-y-1">
                              {order.items.map((item, idx) => (
                                <div
                                  key={`${order.id}-item-${idx}`}
                                  className="flex items-center justify-between text-xs text-slate-600"
                                >
                                  <span>
                                    <strong className="font-mono tabular-nums">
                                      {item.quantity}x
                                    </strong>{' '}
                                    {item.productName}
                                  </span>
                                  <span className="font-mono tabular-nums text-slate-500">
                                    {formatBRL(item.totalPrice)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {drawerTab === 'privacy' && (
                <section className="space-y-4">
                  {/* Explicação Clara do Tipo de Vínculo (Conta Digital vs Manual) */}
                  <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      {selectedCustomer.isManual ? (
                        <>
                          <Store className="h-4 w-4 text-emerald-700" />
                          <span>Cadastro Manual do Estabelecimento</span>
                        </>
                      ) : (
                        <>
                          <Smartphone className="h-4 w-4 text-sky-700" />
                          <span>Cliente com Conta na Loja Digital</span>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {selectedCustomer.isManual
                        ? 'Este cliente foi cadastrado manualmente pelo estabelecimento (balcão, telefone ou WhatsApp) sob consentimento LGPD. Os dados de nome, telefone e e-mail podem ser atualizados pela equipe autorizada desta loja.'
                        : 'Este cliente possui vínculo com conta digital do aplicativo ou checkout online. Por segurança e conformidade LGPD, os dados pessoais da conta (nome, telefone, e-mail e CPF) pertencem exclusivamente ao titular e só podem ser alterados pelo próprio cliente.'}
                    </p>
                    {!selectedCustomer.isManual && (
                      <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                        <Lock className="h-3.5 w-3.5 text-slate-400" />
                        CPF e credenciais de conta nunca são exibidos nem editáveis pelo painel da loja.
                      </p>
                    )}
                  </div>

                  {/* Ações Rápidas de Relacionamento via WhatsApp (somente com consentimento ativo) */}
                  {selectedCustomer.contactConsent && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-2.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
                        <MessageCircle className="h-4 w-4 text-emerald-700" />
                        <span>Abordagens Rápidas de Relacionamento (WhatsApp Autorizado)</span>
                      </div>
                      <p className="text-xs text-emerald-800/80">
                        Inicie uma conversa personalizada com {selectedCustomer.name} utilizando um
                        roteiro comercial:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void contactCustomer(
                              selectedCustomer,
                              `Olá, ${selectedCustomer.name}! Tudo bem? Aqui é da ${activeTenant.name}. Passando para agradecer pela preferência e saber como foi sua experiência com seu pedido!`
                            )
                          }
                        >
                          Pós-venda / Feedback
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void contactCustomer(
                              selectedCustomer,
                              `Olá, ${selectedCustomer.name}! Aqui é da ${activeTenant.name}. Separamos novidades especiais para clientes da nossa loja hoje. Posso te enviar o cardápio atualizado?`
                            )
                          }
                        >
                          Novidades &amp; Cardápio
                        </Button>
                        {selectedSegment === 'INATIVO' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void contactCustomer(
                                selectedCustomer,
                                `Olá, ${selectedCustomer.name}! Sentimos sua falta aqui na ${activeTenant.name}. Preparamos condições especiais para o seu retorno esta semana!`
                              )
                            }
                          >
                            Reativação de Cliente
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Resumo Fixo de Consentimento LGPD + Ação de Ocultar da Loja */}
              <div className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-600 border border-slate-200/80">
                <p>
                  Consentimento LGPD para cadastro:{' '}
                  <strong>
                    {selectedCustomer.hasLgpdConsent ? 'registrado' : 'não registrado'}
                  </strong>
                </p>
                <p className="mt-1">
                  Permissão de contato:{' '}
                  <strong>
                    {selectedCustomer.contactConsent ? 'autorizado' : 'não autorizado'}
                  </strong>
                </p>
                <p className="mt-2 text-[11px] text-slate-400">
                  CPF e demais dados de conta não são exibidos nem editáveis nesta tela.
                </p>
              </div>

              <Button
                variant="danger"
                size="sm"
                onClick={() => requestHideCustomer(selectedCustomer)}
                className="w-full"
              >
                Remover somente desta loja
              </Button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};
