import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileDown,
  History,
  MessageCircle,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Tag,
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
import { orderStatusLabel } from '../../lib/orders/labels';
import { customerWhatsAppLink } from '../../lib/customer/crm';

const PAGE_SIZE = 15;
const EMPTY_FORM: CreateCustomerInput = {
  name: '',
  phone: '',
  email: '',
  origin: 'whatsapp',
  consentLgpd: false,
  contactConsent: false,
};

const ORIGINS: Record<string, { label: string; variant: 'brand' | 'success' | 'warning' | 'info' | 'neutral' }> = {
  marketplace: { label: 'Marketplace', variant: 'warning' },
  qr_code: { label: 'Link / QR Code', variant: 'brand' },
  whatsapp: { label: 'WhatsApp', variant: 'success' },
  instagram: { label: 'Instagram', variant: 'info' },
  google: { label: 'Google', variant: 'neutral' },
  indicacao: { label: 'Indicação', variant: 'success' },
  direto: { label: 'Acesso direto', variant: 'neutral' },
  direct: { label: 'Acesso direto', variant: 'neutral' },
  promotional_checkout: { label: 'Checkout', variant: 'brand' },
  storefront: { label: 'Loja online', variant: 'brand' },
  storefront_promo: { label: 'Loja online', variant: 'brand' },
  pos: { label: 'Balcão / PDV', variant: 'neutral' },
  outros: { label: 'Outros', variant: 'neutral' },
};

function formatDate(value?: string, withTime = false): string {
  if (!value) return 'Ainda sem pedidos';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'medium' });
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
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerCrmItem | null>(null);
  const [orders, setOrders] = useState<CustomerCrmOrderHistoryItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [notes, setNotes] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [savingPrivateData, setSavingPrivateData] = useState(false);
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerCrmItem | null>(null);
  const [customerForm, setCustomerForm] = useState<CreateCustomerInput>(EMPTY_FORM);
  const [savingCustomer, setSavingCustomer] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(search.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadCustomers = useCallback(async () => {
    if (!activeTenant?.id) return;
    setLoading(true);
    setError('');
    try {
      const response = await customerRepository.getCrmCustomers(activeTenant.id, {
        search: searchQuery,
        origin,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setCustomers(response.customers);
      setTotalCount(response.totalCount);
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

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentOrigin = useMemo(() => (value: string) => ORIGINS[value] || {
    label: value,
    variant: 'neutral' as const,
  }, []);

  const openCustomer = async (customer: CustomerCrmItem) => {
    setSelectedCustomer(customer);
    setNotes(customer.notes);
    setTagsText(customer.tags.join(', '));
    setOrders([]);
    if (!activeTenant?.id) return;
    setLoadingOrders(true);
    try {
      setOrders(await customerRepository.getCrmCustomerOrderHistory(activeTenant.id, customer.id));
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

  const savePrivateData = async () => {
    if (!activeTenant?.id || !selectedCustomer) return;
    setSavingPrivateData(true);
    try {
      const tags = [...new Set(tagsText.split(',').map((tag) => tag.trim()).filter(Boolean))];
      await customerRepository.saveCrmCustomerPrivateData(activeTenant.id, selectedCustomer.id, notes, tags);
      showToast({ type: 'success', title: 'Salvo', message: 'Observações e etiquetas foram atualizadas.' });
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

  const hideCustomer = async (customer: CustomerCrmItem) => {
    if (!activeTenant?.id) return;
    if (!window.confirm(`Remover ${customer.name} da lista desta loja? A conta do cliente não será excluída.`)) return;
    try {
      await customerRepository.hideCrmCustomer(activeTenant.id, customer.id);
      if (selectedCustomer?.id === customer.id) closeCustomer();
      showToast({ type: 'success', title: 'Cliente removido da lista', message: 'A conta e o histórico foram preservados.' });
      await loadCustomers();
    } catch (cause) {
      showToast({
        type: 'error',
        title: 'Não foi possível remover',
        message: cause instanceof Error ? cause.message : 'Falha ao ocultar cliente.',
      });
    }
  };

  const contactCustomer = async (customer: CustomerCrmItem) => {
    if (!activeTenant?.id) return;
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      showToast({ type: 'error', title: 'Ação bloqueada', message: 'Permita a abertura de uma nova aba para usar o WhatsApp.' });
      return;
    }
    try {
      const phone = await customerRepository.getCrmCustomerContactTarget(activeTenant.id, customer.id);
      const link = customerWhatsAppLink(phone, true);
      if (!link) throw new Error('O telefone autorizado não é válido para abrir o WhatsApp.');
      popup.opener = null;
      popup.location.href = link;
    } catch (cause) {
      popup.close();
      showToast({
        type: 'error',
        title: 'Contato não autorizado',
        message: cause instanceof Error ? cause.message : 'A permissão de contato não está ativa.',
      });
      await loadCustomers();
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
    });
    setCustomerFormOpen(true);
  };

  const saveCustomer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeTenant?.id) return;
    if (!editingCustomer && !customerForm.consentLgpd) {
      showToast({
        type: 'error',
        title: 'Consentimento necessário',
        message: 'Registre o consentimento LGPD antes de adicionar um cliente manual.',
      });
      return;
    }
    setSavingCustomer(true);
    try {
      if (editingCustomer) {
        await customerRepository.updateCrmManualCustomer(activeTenant.id, editingCustomer.id, customerForm);
      } else {
        await customerRepository.createCrmManualCustomer(activeTenant.id, customerForm);
      }
      setCustomerFormOpen(false);
      setEditingCustomer(null);
      showToast({
        type: 'success',
        title: editingCustomer ? 'Cadastro atualizado' : 'Cliente adicionado',
        message: editingCustomer ? 'O registro manual foi atualizado.' : 'O cliente foi adicionado à lista desta loja.',
      });
      await loadCustomers();
      if (editingCustomer) {
        const updated = { ...editingCustomer, ...customerForm };
        setSelectedCustomer((current) => current?.id === updated.id ? { ...current, ...updated } : current);
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
      const rows = await customerRepository.exportCrmCustomers(activeTenant.id, searchQuery, origin);
      const header = ['Nome', 'Telefone', 'Canal', 'Pedidos', 'Total gasto', 'Último pedido', 'Contato permitido'];
      const csv = [
        header.map(csvCell).join(';'),
        ...rows.map((row) => [
          row.name,
          row.phone,
          currentOrigin(row.origin).label,
          row.totalOrders,
          row.totalSpent.toFixed(2),
          row.lastOrderAt ? formatDate(row.lastOrderAt) : '',
          row.contactConsent ? 'Sim' : 'Não',
        ].map(csvCell).join(';')),
      ].join('\n');
      const objectUrl = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `clientes-${activeTenant.slug}.csv`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      showToast({ type: 'success', title: 'Exportação concluída', message: `${rows.length} clientes exportados.` });
    } catch (cause) {
      showToast({
        type: 'error',
        title: 'Exportação indisponível',
        message: cause instanceof Error ? cause.message : 'Não foi possível exportar clientes.',
      });
    }
  };

  if (!activeTenant) return null;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">Clientes</h1>
            <Badge variant="brand" size="sm">CRM da loja</Badge>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Clientes que chegaram pelo link/QR ou fizeram um pedido. Dados e anotações são privados desta loja.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeRole === 'OWNER' && (
            <Button variant="outline" size="sm" onClick={() => void exportCustomers()} leftIcon={<FileDown className="h-4 w-4" />}>
              Exportar
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={startCreateCustomer} leftIcon={<Plus className="h-4 w-4" />}>
            Adicionar cliente
          </Button>
        </div>
      </header>

      <Card className="p-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou telefone"
              leftIcon={<Search className="h-4 w-4 text-gray-400" />}
              aria-label="Buscar clientes"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="customer-origin" className="text-xs font-semibold text-gray-500">Canal</label>
            <select
              id="customer-origin"
              value={origin}
              onChange={(event) => { setOrigin(event.target.value); setPage(0); }}
              className="min-h-9 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
            >
              <option value="ALL">Todos</option>
              <option value="qr_code">Link / QR Code</option>
              <option value="storefront">Loja online</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="direct">Acesso direto</option>
              <option value="direto">Acesso direto</option>
              <option value="pos">Balcão / PDV</option>
              <option value="marketplace">Marketplace</option>
              <option value="instagram">Instagram</option>
              <option value="google">Google</option>
              <option value="indicacao">Indicação</option>
              <option value="outros">Outros</option>
            </select>
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
      </Card>

      {error ? (
        <Card className="p-8 text-center">
          <p className="font-semibold text-gray-900">Não foi possível carregar o CRM</p>
          <p className="mt-1 text-sm text-gray-500">{error}</p>
          <Button className="mt-4" variant="outline" size="sm" onClick={() => void loadCustomers()}>Tentar novamente</Button>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Canal</th>
                  <th className="px-4 py-3 text-center">Pedidos</th>
                  <th className="px-4 py-3">Último pedido</th>
                  <th className="px-4 py-3 text-right">Total gasto</th>
                  <th className="px-4 py-3">Consentimento</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && customers.length === 0 ? (
                  <tr><td colSpan={7} className="p-10 text-center text-gray-500"><RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />Carregando clientes…</td></tr>
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center">
                      <Users className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                      <p className="font-semibold text-gray-800">Nenhum cliente nesta busca</p>
                      <p className="mt-1 text-xs text-gray-500">Clientes da loja aparecem após cadastro ou primeiro pedido.</p>
                    </td>
                  </tr>
                ) : customers.map((customer) => {
                  const channel = currentOrigin(customer.origin);
                  const chatLink = customerWhatsAppLink(customer.phone, customer.contactConsent);
                  return (
                    <tr key={customer.id} className="hover:bg-emerald-50/30">
                      <td className="px-4 py-3">
                        <button className="text-left" onClick={() => void openCustomer(customer)}>
                          <span className="block font-semibold text-gray-900 hover:text-emerald-800">{customer.name}</span>
                          <span className="text-xs text-gray-500">{customer.phone}</span>
                          {customer.isManual && <span className="ml-2 text-[10px] font-medium text-gray-400">Manual</span>}
                        </button>
                      </td>
                      <td className="px-4 py-3"><Badge variant={channel.variant} size="sm">{channel.label}</Badge></td>
                      <td className="px-4 py-3 text-center font-medium text-gray-800">{customer.totalOrders}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{formatDate(customer.lastOrderAt)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatBRL(customer.totalSpent)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 text-xs">
                          <span className={`inline-flex items-center gap-1 ${customer.hasLgpdConsent ? 'text-emerald-700' : 'text-gray-500'}`}>
                            {customer.hasLgpdConsent ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                            Dados {customer.hasLgpdConsent ? 'registrados' : 'sem registro'}
                          </span>
                          <span className={customer.contactConsent ? 'text-emerald-700' : 'text-gray-400'}>
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
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-50"
                            >
                              <MessageCircle className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => void openCustomer(customer)}
                            aria-label={`Ver histórico de ${customer.name}`}
                            title="Histórico e detalhes"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
                          >
                            <History className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => void hideCustomer(customer)}
                            aria-label={`Remover ${customer.name} desta lista`}
                            title="Remover desta loja"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-rose-50 hover:text-rose-700"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
            <span>{totalCount} clientes</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                <ChevronLeft className="h-4 w-4" /> Anterior
              </Button>
              <span>{page + 1} / {pageCount}</span>
              <Button variant="outline" size="sm" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}>
                Próxima <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {customerFormOpen && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-gray-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="customer-form-title">
          <form onSubmit={(event) => void saveCustomer(event)} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 id="customer-form-title" className="font-bold text-gray-900">{editingCustomer ? 'Editar cliente manual' : 'Adicionar cliente'}</h2>
                <p className="mt-1 text-xs text-gray-500">Para clientes atendidos presencialmente ou por telefone.</p>
              </div>
              <button type="button" onClick={() => setCustomerFormOpen(false)} aria-label="Fechar" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <label className="block text-xs font-semibold text-gray-700">
              Nome
              <Input required minLength={2} maxLength={255} value={customerForm.name} onChange={(event) => setCustomerForm({ ...customerForm, name: event.target.value })} className="mt-1" />
            </label>
            <label className="block text-xs font-semibold text-gray-700">
              Telefone com DDD
              <Input required value={customerForm.phone} onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })} placeholder="(11) 99999-8888" className="mt-1" />
            </label>
            <label className="block text-xs font-semibold text-gray-700">
              E-mail (opcional)
              <Input type="email" value={customerForm.email || ''} onChange={(event) => setCustomerForm({ ...customerForm, email: event.target.value })} className="mt-1" />
            </label>
            {!editingCustomer && (
              <>
                <label className="block text-xs font-semibold text-gray-700">
                  Canal
                  <select value={customerForm.origin} onChange={(event) => setCustomerForm({ ...customerForm, origin: event.target.value as CustomerOrigin })} className="mt-1 min-h-9 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
                    <option value="whatsapp">WhatsApp / telefone</option>
                    <option value="direct">Balcão / acesso direto</option>
                    <option value="indicacao">Indicação</option>
                    <option value="outros">Outros</option>
                  </select>
                </label>
                <label className="flex items-start gap-2 text-xs text-gray-600">
                  <input type="checkbox" required checked={customerForm.consentLgpd} onChange={(event) => setCustomerForm({ ...customerForm, consentLgpd: event.target.checked })} className="mt-0.5 rounded border-gray-300 text-emerald-700 focus:ring-emerald-600" />
                  <span>Consentimento LGPD para registrar os dados deste cliente foi obtido e registrado.</span>
                </label>
                <label className="flex items-start gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={customerForm.contactConsent} onChange={(event) => setCustomerForm({ ...customerForm, contactConsent: event.target.checked })} className="mt-0.5 rounded border-gray-300 text-emerald-700 focus:ring-emerald-600" />
                  <span>O cliente autorizou mensagens comerciais e ofertas pelo WhatsApp. Sem esta autorização, o botão de contato não será exibido.</span>
                </label>
              </>
            )}
            <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomerFormOpen(false)} disabled={savingCustomer}>Cancelar</Button>
              <Button type="submit" size="sm" isLoading={savingCustomer}>{editingCustomer ? 'Salvar alterações' : 'Cadastrar cliente'}</Button>
            </div>
          </form>
        </div>
      )}

      {selectedCustomer && (
        <div className="fixed inset-0 z-[1100] flex justify-end bg-gray-900/40" role="dialog" aria-modal="true" aria-labelledby="customer-detail-title">
          <aside className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-100 p-5">
              <div>
                <h2 id="customer-detail-title" className="text-lg font-bold text-gray-900">{selectedCustomer.name}</h2>
                <p className="mt-1 text-sm text-gray-500">{selectedCustomer.phone}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant={currentOrigin(selectedCustomer.origin).variant} size="sm">{currentOrigin(selectedCustomer.origin).label}</Badge>
                  {selectedCustomer.isManual && <Badge variant="neutral" size="sm">Cadastro manual</Badge>}
                </div>
              </div>
              <div className="flex gap-1">
                {selectedCustomer.isManual && (
                  <Button variant="outline" size="sm" onClick={() => startEditCustomer(selectedCustomer)} leftIcon={<Pencil className="h-4 w-4" />}>
                    Editar
                  </Button>
                )}
                <button onClick={closeCustomer} aria-label="Fechar detalhes" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-center">
                  <ShoppingBag className="mx-auto h-4 w-4 text-gray-500" />
                  <p className="mt-1 text-lg font-bold text-gray-900">{selectedCustomer.totalOrders}</p>
                  <p className="text-[10px] text-gray-500">Pedidos</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-center">
                  <CalendarDays className="mx-auto h-4 w-4 text-gray-500" />
                  <p className="mt-1 truncate text-xs font-semibold text-gray-900">{formatDate(selectedCustomer.lastOrderAt)}</p>
                  <p className="text-[10px] text-gray-500">Último pedido</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-center">
                  <Clock3 className="mx-auto h-4 w-4 text-emerald-700" />
                  <p className="mt-1 text-sm font-bold text-emerald-800">{formatBRL(selectedCustomer.totalSpent)}</p>
                  <p className="text-[10px] text-gray-500">Total gasto</p>
                </div>
              </div>

              <section className="rounded-xl border border-gray-100 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <NotebookPen className="h-4 w-4 text-emerald-700" />
                  <h3 className="text-sm font-semibold text-gray-900">Anotações privadas da loja</h3>
                </div>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} rows={4} placeholder="Escreva uma observação visível somente para esta loja…" className="w-full resize-y rounded-xl border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/30" />
                <div className="mb-3 mt-3 flex items-center gap-2">
                  <Tag className="h-4 w-4 text-gray-500" />
                  <label htmlFor="customer-tags" className="text-xs font-semibold text-gray-700">Etiquetas</label>
                </div>
                <Input id="customer-tags" value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="VIP, prefere retirada (separadas por vírgula)" />
                <p className="mt-1 text-[10px] text-gray-400">Até 10 etiquetas. Somente usuários autorizados desta loja podem ver.</p>
                <div className="mt-3 flex justify-end">
                  <Button size="sm" isLoading={savingPrivateData} onClick={() => void savePrivateData()}>Salvar notas e etiquetas</Button>
                </div>
              </section>

              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900"><History className="h-4 w-4 text-emerald-700" />Histórico de pedidos</h3>
                {loadingOrders ? (
                  <div className="p-6 text-center text-sm text-gray-500"><RefreshCw className="mx-auto mb-2 h-4 w-4 animate-spin" />Carregando histórico…</div>
                ) : orders.length === 0 ? (
                  <p className="rounded-xl bg-gray-50 p-4 text-center text-xs text-gray-500">Nenhum pedido encontrado nesta loja.</p>
                ) : (
                  <div className="space-y-2">
                    {orders.map((order) => (
                      <div key={order.id} className="flex items-center justify-between rounded-xl border border-gray-100 p-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">Pedido #{order.orderNumber} · {orderStatusLabel(order.status)}</p>
                          <p className="mt-1 text-xs text-gray-500">{formatDate(order.createdAt, true)}</p>
                        </div>
                        <p className="text-sm font-semibold text-gray-900">{formatBRL(order.totalAmount)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
                <p>Consentimento LGPD para cadastro: <strong>{selectedCustomer.hasLgpdConsent ? 'registrado' : 'não registrado'}</strong></p>
                <p className="mt-1">Permissão de contato: <strong>{selectedCustomer.contactConsent ? 'autorizado' : 'não autorizado'}</strong></p>
                <p className="mt-2 text-[10px] text-gray-400">CPF e demais dados de conta não são exibidos nem editáveis nesta tela.</p>
              </div>
              <Button variant="danger" size="sm" onClick={() => void hideCustomer(selectedCustomer)} className="w-full">Remover somente desta loja</Button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};
