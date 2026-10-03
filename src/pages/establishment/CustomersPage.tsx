import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { 
  customerRepository, 
  CustomerSummaryItem, 
  CustomerOrderHistoryItem,
  CreateCustomerInput 
} from '../../repositories/customerRepository';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../context/ToastContext';
import { CustomerOrigin } from '../../types';
import { 
  Users, 
  Search, 
  Phone, 
  ShieldCheck, 
  ShieldAlert,
  ShoppingBag, 
  RefreshCw, 
  Plus, 
  X, 
  ChevronRight, 
  ChevronLeft,
  Calendar,
  DollarSign,
  AlertTriangle,
  History,
  Mail,
  UserCheck
} from 'lucide-react';

const PAGE_SIZE = 15;

export const CustomersPage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  const { showToast } = useToast();

  // Estados de listagem e paginação
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [originFilter, setOriginFilter] = useState<string>('ALL');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [customers, setCustomers] = useState<CustomerSummaryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estados do Modal de Cadastro Manual
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState<CreateCustomerInput>({
    name: '',
    phone: '',
    email: '',
    origin: 'whatsapp',
    consentLgpd: false,
  });

  // Estados do Drawer de Detalhes / Histórico do Cliente
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummaryItem | null>(null);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrderHistoryItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Debounce da busca textual
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(0); // Reseta para a primeira página ao alterar o termo
    }, 350);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Consulta de clientes oficial do Supabase
  const fetchCustomers = useCallback(async () => {
    if (!activeTenant?.id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await customerRepository.getCustomersSummary(
        securityContext,
        activeTenant.id,
        {
          searchTerm: debouncedSearch,
          origin: originFilter,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }
      );
      setCustomers(response.customers);
      setTotalCount(response.totalCount);
    } catch (err: any) {
      console.error('[CustomersPage] Erro ao carregar clientes do Supabase:', err);
      setError(err.message || 'Falha ao buscar clientes do servidor.');
    } finally {
      setLoading(false);
    }
  }, [activeTenant?.id, securityContext, debouncedSearch, originFilter, page]);

  // Carregamento inicial e Supabase Realtime oficial
  useEffect(() => {
    fetchCustomers();
    if (!activeTenant?.id) return;

    // Escuta inserções e atualizações em customers e orders
    const unsubscribe = customerRepository.subscribeToCustomers(activeTenant.id, () => {
      fetchCustomers();
    });
    return unsubscribe;
  }, [fetchCustomers, activeTenant?.id]);

  // Carrega histórico quando um cliente é selecionado
  const handleSelectCustomer = async (c: CustomerSummaryItem) => {
    setSelectedCustomer(c);
    if (!activeTenant?.id) return;
    setLoadingOrders(true);
    try {
      const orders = await customerRepository.getCustomerOrderHistory(
        securityContext,
        activeTenant.id,
        c.id
      );
      setCustomerOrders(orders);
    } catch (err: any) {
      console.error('[CustomersPage] Erro ao carregar histórico:', err);
      showToast({
        type: 'error',
        title: 'Histórico Indisponível',
        message: 'Não foi possível carregar os pedidos deste cliente.',
      });
    } finally {
      setLoadingOrders(false);
    }
  };

  // Submissão do cadastro manual de cliente
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTenant?.id) return;
    if (!newCustomer.name.trim() || !newCustomer.phone.trim()) {
      showToast({
        type: 'error',
        title: 'Campos Obrigatórios',
        message: 'Por favor, informe ao menos o nome e o WhatsApp do cliente.',
      });
      return;
    }

    setSavingCustomer(true);
    try {
      await customerRepository.createCustomerManual(securityContext, activeTenant.id, newCustomer);
      showToast({
        type: 'success',
        title: 'Cliente Cadastrado',
        message: `${newCustomer.name} foi adicionado à sua base com sucesso.`,
      });
      setIsAddModalOpen(false);
      setNewCustomer({
        name: '',
        phone: '',
        email: '',
        origin: 'whatsapp',
        consentLgpd: false,
      });
      fetchCustomers();
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Cadastrar',
        message: err.message || 'Falha ao salvar cliente.',
      });
    } finally {
      setSavingCustomer(false);
    }
  };

  if (!activeTenant) return null;

  const originLabels: Record<CustomerOrigin, { label: string; variant: 'brand' | 'success' | 'warning' | 'info' | 'neutral' }> = {
    marketplace: { label: 'Marketplace', variant: 'warning' },
    qr_code: { label: 'QR Code Embalagem', variant: 'brand' },
    whatsapp: { label: 'WhatsApp', variant: 'success' },
    instagram: { label: 'Instagram', variant: 'info' },
    google: { label: 'Google', variant: 'neutral' },
    indicacao: { label: 'Indicação', variant: 'success' },
    direto: { label: 'Acesso Direto', variant: 'neutral' },
    outros: { label: 'Outros Canais', variant: 'neutral' },
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. CABEÇALHO COM CONTROLES E BOTÃO ADICIONAR CLIENTE                     */}
      {/* ========================================================================= */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">Base de Clientes & CRM Próprio</h2>
            <Badge variant="brand" size="sm">SUPABASE OFICIAL</Badge>
          </div>
          <p className="text-xs text-gray-500">
            Contatos, histórico de recompra e valor vitalício real gerado pelo seu catálogo
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
            leftIcon={<Plus className="w-4 h-4" />}
            className="text-xs cursor-pointer w-full sm:w-auto"
          >
            Adicionar Cliente
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. FILTROS E BUSCA SERVER-SIDE                                            */}
      {/* ========================================================================= */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-gray-100 shadow-xs">
        <div className="relative flex-1">
          <Input
            placeholder="Buscar por nome, telefone ou e-mail..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            leftIcon={<Search className="w-4 h-4 text-gray-400" />}
          />
        </div>

        {/* Seletor de Origem */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 whitespace-nowrap">Canal:</span>
          <select
            value={originFilter}
            onChange={(e) => {
              setOriginFilter(e.target.value);
              setPage(0);
            }}
            className="text-xs font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            <option value="ALL">Todos os Canais</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="qr_code">QR Code Embalagem</option>
            <option value="instagram">Instagram</option>
            <option value="google">Google</option>
            <option value="direto">Acesso Direto</option>
            <option value="marketplace">Marketplace</option>
            <option value="indicacao">Indicação</option>
            <option value="outros">Outros</option>
          </select>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchCustomers()}
            disabled={loading}
            className="text-xs p-2 text-gray-500 hover:text-gray-900 cursor-pointer"
            title="Atualizar lista"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. ESTADO DE ERRO DEDICADO OU TABELA DE CLIENTES                         */}
      {/* ========================================================================= */}
      {error ? (
        <Card className="p-8 text-center space-y-4 border-gray-100 shadow-xs bg-white">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto shadow-inner">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-gray-900">Não foi possível carregar os clientes</h3>
            <p className="text-xs text-gray-500 max-w-md mx-auto">
              Ocorreu uma falha de comunicação com o servidor ao consultar sua base de clientes.
              Verifique sua conexão ou tente novamente.
            </p>
            {error && error !== 'Falha ao buscar clientes do servidor.' && (
              <p className="text-[11px] text-gray-400 font-mono mt-1 max-w-sm mx-auto truncate">
                Detalhe: {error}
              </p>
            )}
          </div>
          <div>
            <Button 
              size="sm" 
              variant="primary" 
              onClick={() => fetchCustomers()} 
              disabled={loading}
              className="text-xs cursor-pointer px-4 py-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Tentando novamente...' : 'Tentar Novamente'}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden shadow-xs border-gray-100">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                <tr>
                  <th className="p-3">Cliente</th>
                  <th className="p-3">Telefone</th>
                  <th className="p-3">Canal</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-center">Pedidos Válidos</th>
                  <th className="p-3 text-right">LTV Real</th>
                  <th className="p-3 text-right">Ticket Médio</th>
                  <th className="p-3 text-center">LGPD</th>
                  <th className="p-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && customers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-gray-400">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-600" />
                      Carregando base de clientes do Supabase...
                    </td>
                  </tr>
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-gray-400">
                      <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                      <p className="font-semibold text-gray-700">
                        {searchTerm || originFilter !== 'ALL' 
                          ? 'Nenhum cliente encontrado com os filtros selecionados.' 
                          : 'Você ainda não possui clientes cadastrados.'}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        Cadastre um cliente manualmente no botão acima ou aguarde os pedidos dos clientes.
                      </p>
                    </td>
                  </tr>
                ) : (
                  customers.map((c) => {
                    const badge = originLabels[c.origin] || { label: c.origin, variant: 'neutral' as const };
                    return (
                      <tr 
                        key={c.id} 
                        onClick={() => handleSelectCustomer(c)}
                        className="hover:bg-emerald-50/40 transition-colors cursor-pointer"
                      >
                        <td className="p-3">
                          <div className="font-bold text-gray-900">{c.name}</div>
                          {c.email && <div className="text-[10px] text-gray-400">{c.email}</div>}
                        </td>
                        <td className="p-3 font-mono text-gray-700">{c.phone}</td>
                        <td className="p-3">
                          <Badge variant={badge.variant} size="sm">
                            {badge.label}
                          </Badge>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            c.status === 'RECORRENTE' 
                              ? 'bg-emerald-100 text-emerald-800' 
                              : c.status === 'INATIVO' 
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-gray-900">
                          {c.totalOrders} {c.totalOrders === 1 ? 'ped' : 'peds'}
                        </td>
                        <td className="p-3 text-right font-mono font-black text-emerald-800">
                          R$ {c.ltvAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-right font-mono text-gray-600">
                          R$ {c.averageTicket.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-center">
                          {c.hasLgpdConsent ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold" title="Consentimento LGPD Ativo no Banco">
                              <ShieldCheck className="w-3.5 h-3.5" /> Consentido
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 font-normal" title="Sem registro formal de consentimento">
                              <ShieldAlert className="w-3.5 h-3.5 text-gray-300" /> Não registrado
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <ChevronRight className="w-4 h-4 text-gray-400 inline-block" />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between p-3.5 bg-gray-50 border-t border-gray-100 text-xs">
              <span className="text-gray-500">
                Mostrando <strong className="text-gray-900">{page * PAGE_SIZE + 1}</strong> a{' '}
                <strong className="text-gray-900">{Math.min((page + 1) * PAGE_SIZE, totalCount)}</strong> de{' '}
                <strong className="text-gray-900">{totalCount}</strong> clientes
              </span>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                  leftIcon={<ChevronLeft className="w-3.5 h-3.5" />}
                  className="text-xs px-2.5 py-1"
                >
                  Anterior
                </Button>
                <span className="px-2 font-mono text-gray-600">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1 || loading}
                  rightIcon={<ChevronRight className="w-3.5 h-3.5" />}
                  className="text-xs px-2.5 py-1"
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ========================================================================= */}
      {/* 4. MODAL: ADICIONAR CLIENTE MANUALMENTE                                  */}
      {/* ========================================================================= */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-gray-100">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-emerald-700" />
                Cadastrar Novo Cliente
              </h3>
              <button 
                type="button" 
                onClick={() => setIsAddModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Nome Completo *
                </label>
                <Input
                  required
                  placeholder="Ex: Carlos Silva"
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  WhatsApp com DDD *
                </label>
                <Input
                  required
                  placeholder="Ex: 11999998888"
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                />
                <span className="text-[10px] text-gray-400 mt-0.5 block">
                  Apenas números ou com máscara. O telefone é chave única no seu estabelecimento.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  E-mail (opcional)
                </label>
                <Input
                  type="email"
                  placeholder="cliente@email.com"
                  value={newCustomer.email || ''}
                  onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Canal de Aquisição / Origem
                </label>
                <select
                  value={newCustomer.origin}
                  onChange={(e) => setNewCustomer({ ...newCustomer, origin: e.target.value as CustomerOrigin })}
                  className="w-full text-xs font-medium bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="whatsapp">WhatsApp / Telefone</option>
                  <option value="direto">Balcão / Acesso Direto</option>
                  <option value="indicacao">Indicação de Amigo</option>
                  <option value="qr_code">QR Code Embalagem</option>
                  <option value="instagram">Instagram</option>
                  <option value="outros">Outros</option>
                </select>
              </div>

              <div className="pt-1">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newCustomer.consentLgpd}
                    onChange={(e) => setNewCustomer({ ...newCustomer, consentLgpd: e.target.checked })}
                    className="mt-0.5 rounded-sm border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-xs text-gray-600">
                    O cliente consentiu verbalmente ou por escrito com o armazenamento de seus dados para contato (LGPD).
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={savingCustomer}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={savingCustomer}
                  leftIcon={savingCustomer ? <RefreshCw className="w-4 h-4 animate-spin" /> : undefined}
                >
                  {savingCustomer ? 'Salvando...' : 'Cadastrar Cliente'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. DRAWER / MODAL: DETALHES E HISTÓRICO DE COMPRAS DO CLIENTE            */}
      {/* ========================================================================= */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-end p-0 sm:p-4">
          <div className="bg-white h-full sm:h-auto sm:max-h-[90vh] sm:rounded-2xl max-w-lg w-full flex flex-col shadow-2xl overflow-hidden border border-gray-100 animate-in slide-in-from-right duration-200">
            {/* Header do Drawer */}
            <div className="p-4 bg-gray-50/80 border-b border-gray-100 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-gray-900">{selectedCustomer.name}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    selectedCustomer.status === 'RECORRENTE' 
                      ? 'bg-emerald-100 text-emerald-800' 
                      : selectedCustomer.status === 'INATIVO' 
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {selectedCustomer.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                  <span className="flex items-center gap-1 font-mono">
                    <Phone className="w-3.5 h-3.5 text-gray-400" />
                    {selectedCustomer.phone}
                  </span>
                  {selectedCustomer.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="w-3.5 h-3.5 text-gray-400" />
                      {selectedCustomer.email}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo scrollável */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Cards de Métricas Reais */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100 text-center">
                  <span className="text-[10px] uppercase font-bold text-gray-400">Pedidos Válidos</span>
                  <div className="text-lg font-black text-gray-900 font-mono mt-0.5">
                    {selectedCustomer.totalOrders}
                  </div>
                </div>

                <div className="p-2.5 bg-emerald-50/50 rounded-xl border border-emerald-100 text-center">
                  <span className="text-[10px] uppercase font-bold text-emerald-700">LTV Real</span>
                  <div className="text-lg font-black text-emerald-800 font-mono mt-0.5">
                    R$ {selectedCustomer.ltvAmount.toFixed(0)}
                  </div>
                </div>

                <div className="p-2.5 bg-blue-50/50 rounded-xl border border-blue-100 text-center">
                  <span className="text-[10px] uppercase font-bold text-blue-700">Ticket Médio</span>
                  <div className="text-lg font-black text-blue-900 font-mono mt-0.5">
                    R$ {selectedCustomer.averageTicket.toFixed(0)}
                  </div>
                </div>
              </div>

              {/* Informações de Cadastro */}
              <div className="text-xs bg-gray-50 p-3 rounded-xl space-y-1.5 border border-gray-100">
                <div className="flex justify-between">
                  <span className="text-gray-500">Canal de Aquisição:</span>
                  <span className="font-semibold text-gray-900">{selectedCustomer.origin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Primeira Compra:</span>
                  <span className="font-mono text-gray-900">
                    {selectedCustomer.firstOrderDate 
                      ? new Date(selectedCustomer.firstOrderDate).toLocaleDateString('pt-BR') 
                      : 'Nenhuma compra'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Última Compra:</span>
                  <span className="font-mono text-gray-900">
                    {selectedCustomer.lastOrderDate 
                      ? new Date(selectedCustomer.lastOrderDate).toLocaleDateString('pt-BR') 
                      : 'Nenhuma compra'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Consentimento LGPD:</span>
                  <span className={`font-semibold ${selectedCustomer.hasLgpdConsent ? 'text-emerald-700' : 'text-gray-400'}`}>
                    {selectedCustomer.hasLgpdConsent ? 'Ativo no banco' : 'Não registrado'}
                  </span>
                </div>
              </div>

              {/* Histórico de Pedidos */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-900 uppercase flex items-center gap-1.5">
                  <History className="w-4 h-4 text-emerald-700" />
                  Histórico de Pedidos Realizados
                </h4>

                {loadingOrders ? (
                  <div className="p-6 text-center text-gray-400 text-xs">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1 text-emerald-600" />
                    Carregando pedidos do cliente...
                  </div>
                ) : customerOrders.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4 bg-gray-50 rounded-xl">
                    Nenhum pedido registrado para este cliente até o momento.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {customerOrders.map(ord => (
                      <div 
                        key={ord.id} 
                        className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                          ord.status === 'CANCELLED' 
                            ? 'bg-rose-50/50 border-rose-100 text-rose-900' 
                            : 'bg-white border-gray-100'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-gray-900">#{ord.orderNumber}</span>
                            <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-bold ${
                              ord.status === 'CANCELLED' 
                                ? 'bg-rose-200 text-rose-800' 
                                : 'bg-gray-100 text-gray-700'
                            }`}>
                              {ord.status}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-400 font-mono block mt-0.5">
                            {new Date(ord.createdAt).toLocaleString('pt-BR')} • {ord.paymentMethod} • {ord.fulfillmentType}
                          </span>
                        </div>

                        <div className="text-right font-mono">
                          <div className="font-bold text-gray-900">
                            R$ {ord.totalAmount.toFixed(2)}
                          </div>
                          {ord.status === 'CANCELLED' && (
                            <span className="text-[10px] text-rose-600 block">Não faturado</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer do Drawer */}
            <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCustomer(null)}
                className="text-xs"
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
