import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { productRepository } from '../../repositories/productRepository';
import { categoryRepository } from '../../repositories/categoryRepository';
import { tenantRepository } from '../../repositories/tenantRepository';
import { ImageUploader } from '../../components/common/ImageUploader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Product, Category } from '../../types';
import { 
  Plus, 
  Search, 
  Filter, 
  Edit3, 
  Trash2, 
  Copy, 
  Star, 
  Boxes, 
  Check, 
  X, 
  ArrowUpDown, 
  Tag, 
  Package, 
  AlertCircle,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export const ProductsPage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  const { showToast } = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE' | 'FEATURED'>('ALL');
  const [sortBy, setSortBy] = useState<'NAME' | 'PRICE_ASC' | 'PRICE_DESC' | 'STOCK' | 'RECENT'>('RECENT');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isRemoveDemoModalOpen, setIsRemoveDemoModalOpen] = useState(false);
  const [isRemovingDemo, setIsRemovingDemo] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    categoryId: '',
    price: '',
    promotionalPrice: '',
    cost: '',
    sku: '',
    unit: 'un',
    imageUrl: '',
    stockQuantity: '50',
    minStock: '10',
    isActive: true,
    isAvailable: true,
    isFeatured: false,
  });

  const loadData = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const [fetchedProds, fetchedCats] = await Promise.all([
        productRepository.getProducts(securityContext, activeTenant.id),
        categoryRepository.getCategories(securityContext, activeTenant.id),
      ]);
      setProducts(fetchedProds);
      setCategories(fetchedCats);
    } catch (err: any) {
      console.error('[ProductsPage] Erro ao carregar dados:', err);
      setError(err.message || 'Falha ao carregar produtos do banco de dados.');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, securityContext]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!activeTenant) return null;

  // Open Create Modal
  const handleOpenCreate = () => {
    setEditingProduct(null);
    setFormData({
      name: '',
      description: '',
      categoryId: categories[0]?.id || '',
      price: '',
      promotionalPrice: '',
      cost: '',
      sku: '',
      unit: 'un',
      imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&auto=format&fit=crop&q=80',
      stockQuantity: '50',
      minStock: '10',
      isActive: true,
      isAvailable: true,
      isFeatured: false,
    });
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (p: Product) => {
    setEditingProduct(p);
    setFormData({
      name: p.name,
      description: p.description,
      categoryId: p.categoryId,
      price: p.price.toString(),
      promotionalPrice: p.promotionalPrice ? p.promotionalPrice.toString() : '',
      cost: p.cost ? p.cost.toString() : '',
      sku: p.sku || '',
      unit: p.unit || 'un',
      imageUrl: p.imageUrl,
      stockQuantity: p.stockQuantity.toString(),
      minStock: p.minStock ? p.minStock.toString() : '10',
      isActive: p.isActive !== false,
      isAvailable: p.isAvailable !== false,
      isFeatured: !!p.isFeatured,
    });
    setIsModalOpen(true);
  };

  // Save Product (Create or Update)
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.price) {
      showToast({
        type: 'error',
        title: 'Dados Incompletos',
        message: 'Preencha ao menos Nome e Preço do produto.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const stockQty = parseInt(formData.stockQuantity, 10) || 0;
      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        categoryId: formData.categoryId || '',
        price: parseFloat(formData.price) || 0,
        promotionalPrice: formData.promotionalPrice ? parseFloat(formData.promotionalPrice) : undefined,
        cost: formData.cost ? parseFloat(formData.cost) : undefined,
        sku: formData.sku ? formData.sku.trim() : undefined,
        unit: formData.unit,
        imageUrl: formData.imageUrl || 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&auto=format&fit=crop&q=80',
        stockQuantity: stockQty,
        minStock: parseInt(formData.minStock, 10) || 10,
        isActive: formData.isActive,
        isFeatured: formData.isFeatured,
        isAvailable: formData.isActive && stockQty > 0,
      };

      if (editingProduct) {
        const updated = await productRepository.update(securityContext, activeTenant.id, editingProduct.id, payload);
        setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
        showToast({
          type: 'success',
          title: 'Produto Atualizado',
          message: `"${payload.name}" atualizado no banco de dados com sucesso.`,
        });
      } else {
        const created = await productRepository.create(securityContext, activeTenant.id, payload);
        setProducts(prev => [created, ...prev]);
        showToast({
          type: 'success',
          title: 'Produto Criado',
          message: `"${payload.name}" cadastrado no banco e disponível na vitrine.`,
        });
      }

      setIsModalOpen(false);
    } catch (err: any) {
      console.error('[ProductsPage] Erro ao salvar produto:', err);
      showToast({
        type: 'error',
        title: 'Erro ao Salvar no Banco',
        message: err.message || 'Falha ao persistir produto no Supabase.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Duplicate Product
  const handleDuplicate = async (p: Product) => {
    try {
      const duplicated = await productRepository.duplicate(securityContext, activeTenant.id, p.id);
      setProducts(prev => [duplicated, ...prev]);
      showToast({
        type: 'success',
        title: 'Produto Duplicado',
        message: `Cópia de "${p.name}" gravada no banco com sucesso.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro na Duplicação',
        message: err.message,
      });
    }
  };

  // Toggle Active Status
  const handleToggleStatus = async (p: Product) => {
    try {
      const newStatus = await productRepository.toggleStatus(securityContext, activeTenant.id, p.id);
      setProducts(prev => prev.map(item => item.id === p.id ? { ...item, isActive: newStatus } : item));
      showToast({
        type: 'info',
        title: newStatus ? 'Produto Ativado' : 'Produto Desativado',
        message: `"${p.name}" agora está ${newStatus ? 'visível' : 'oculto'} no aplicativo.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro na Operação',
        message: err.message,
      });
    }
  };

  // Delete Product
  const handleDelete = async (p: Product) => {
    if (!window.confirm(`Tem certeza que deseja excluir "${p.name}"? Esta ação removerá o produto do cardápio.`)) {
      return;
    }
    try {
      await productRepository.delete(securityContext, activeTenant.id, p.id);
      setProducts(prev => prev.filter(item => item.id !== p.id));
      showToast({
        type: 'warning',
        title: 'Produto Excluído',
        message: `"${p.name}" foi removido do banco de dados.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Excluir',
        message: err.message,
      });
    }
  };

  // Filtering & Sorting
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          p.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (p.sku && p.sku.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'ALL' || p.categoryId === selectedCategory;
    let matchesStatus = true;
    if (statusFilter === 'ACTIVE') matchesStatus = p.isActive !== false;
    if (statusFilter === 'INACTIVE') matchesStatus = p.isActive === false;
    if (statusFilter === 'FEATURED') matchesStatus = !!p.isFeatured;

    return matchesSearch && matchesCategory && matchesStatus;
  }).sort((a, b) => {
    if (sortBy === 'NAME') return a.name.localeCompare(b.name);
    if (sortBy === 'PRICE_ASC') return (a.promotionalPrice || a.price) - (b.promotionalPrice || b.price);
    if (sortBy === 'PRICE_DESC') return (b.promotionalPrice || b.price) - (a.promotionalPrice || a.price);
    if (sortBy === 'STOCK') return a.stockQuantity - b.stockQuantity;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  const handleRemoveDemo = async () => {
    if (!activeTenant?.id) return;
    setIsRemovingDemo(true);
    try {
      const res = await tenantRepository.removeDemoCatalog(activeTenant.id);
      showToast({
        type: 'success',
        title: 'Catálogo de Demonstração Removido',
        message: `${res.deletedProducts} produtos, ${res.deletedCategories} categorias e ${res.deletedOffers} ofertas de demonstração foram excluídos com sucesso.`,
      });
      setIsRemoveDemoModalOpen(false);
      await loadData();
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Remover Demo',
        message: err.message || 'Falha ao excluir itens de demonstração.',
      });
    } finally {
      setIsRemovingDemo(false);
    }
  };

  const hasDemoItems = products.some(p => p.isDemo);

  return (
    <div className="space-y-6">
      {hasDemoItems && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 border border-amber-300 shrink-0">
              DEMONSTRAÇÃO
            </span>
            <span className="text-xs text-amber-900 font-medium">
              Este estabelecimento contém itens de exemplo para ajudar na visualização inicial do catálogo.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsRemoveDemoModalOpen(true)}
            className="text-xs border-amber-300 text-amber-900 hover:bg-amber-100 shrink-0 cursor-pointer"
          >
            Remover conteúdo de demonstração
          </Button>
        </div>
      )}
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Cardápio & Gestão de Produtos</h2>
          <p className="text-xs text-gray-500">
            CRUD completo com persistência real no Supabase, estoque, SKU e precificação
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            title="Recarregar produtos do banco"
          >
            Sincronizar
          </Button>

          <Button
            variant="primary"
            onClick={handleOpenCreate}
            leftIcon={<Plus className="w-4 h-4" />}
            className="shadow-xs text-xs"
          >
            + Novo Produto
          </Button>
        </div>
      </div>

      {error && (
        <Card className="p-4 bg-red-50/70 border border-red-200 text-red-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <span className="text-xs font-medium">{error}</span>
          </div>
          <Button size="sm" variant="outline" onClick={loadData} className="text-xs">
            Tentar Novamente
          </Button>
        </Card>
      )}

      {/* Filter and Search Bar */}
      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por nome, descrição ou SKU..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
            />
          </div>

          {/* Category Filter */}
          <div className="relative">
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white text-gray-700"
            >
              <option value="ALL">Todas as Categorias</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="relative">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white text-gray-700"
            >
              <option value="ALL">Todos os Status</option>
              <option value="ACTIVE">Somente Ativos</option>
              <option value="INACTIVE">Somente Desativados</option>
              <option value="FEATURED">Somente Destaques</option>
            </select>
          </div>

          {/* Sort By */}
          <div className="relative">
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white text-gray-700"
            >
              <option value="RECENT">Mais Recentes</option>
              <option value="NAME">Nome (A-Z)</option>
              <option value="PRICE_ASC">Preço: Menor para Maior</option>
              <option value="PRICE_DESC">Preço: Maior para Menor</option>
              <option value="STOCK">Menor Estoque</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Products Table */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
              <tr>
                <th className="p-3.5">Produto</th>
                <th className="p-3.5">Categoria</th>
                <th className="p-3.5">Preço Venda</th>
                <th className="p-3.5">Custo / Margem</th>
                <th className="p-3.5">Estoque</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-emerald-700 mb-2" />
                    <span>Carregando produtos do banco de dados...</span>
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-400">
                    Nenhum produto encontrado. Clique em "+ Novo Produto" para cadastrar.
                  </td>
                </tr>
              ) : (
                filteredProducts.map(p => {
                  const cat = categories.find(c => c.id === p.categoryId);
                  const isLowStock = p.minStock !== undefined && p.stockQuantity <= p.minStock;
                  const margin = p.cost && p.price ? Math.round(((p.price - p.cost) / p.price) * 100) : null;

                  return (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-3.5">
                        <div className="flex items-center gap-3">
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            className="w-10 h-10 rounded-xl object-cover border border-gray-200 shrink-0"
                          />
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-gray-900">{p.name}</span>
                              {p.isFeatured && (
                                <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                              )}
                              {p.isDemo && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                  EXEMPLO
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-gray-400">
                              {p.sku && <span>SKU: {p.sku}</span>}
                              <span>•</span>
                              <span>{p.unit}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="p-3.5 text-gray-600 font-medium">
                        {cat?.name || 'Sem categoria'}
                      </td>

                      <td className="p-3.5 font-mono">
                        {p.promotionalPrice ? (
                          <div>
                            <span className="font-bold text-emerald-800">
                              R$ {p.promotionalPrice.toFixed(2)}
                            </span>
                            <span className="text-[10px] text-gray-400 line-through ml-1.5">
                              R$ {p.price.toFixed(2)}
                            </span>
                          </div>
                        ) : (
                          <span className="font-bold text-gray-900">
                            R$ {p.price.toFixed(2)}
                          </span>
                        )}
                      </td>

                      <td className="p-3.5 text-gray-500 font-mono text-[11px]">
                        {p.cost ? (
                          <div>
                            <div>R$ {p.cost.toFixed(2)}</div>
                            <span className="text-[10px] text-emerald-700 font-bold">
                              {margin}% margem
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>

                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-mono font-bold ${isLowStock ? 'text-rose-600' : 'text-gray-900'}`}>
                            {p.stockQuantity}
                          </span>
                          {isLowStock && (
                            <span title="Estoque abaixo do mínimo">
                              <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="p-3.5">
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(p)}
                          className="cursor-pointer"
                        >
                          <Badge variant={p.isActive !== false ? 'success' : 'neutral'} size="sm">
                            {p.isActive !== false ? 'ATIVO' : 'DESATIVADO'}
                          </Badge>
                        </button>
                      </td>

                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(p)}
                            title="Editar Produto"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 cursor-pointer transition-colors"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDuplicate(p)}
                            title="Duplicar Produto"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-emerald-700 hover:bg-emerald-50 cursor-pointer transition-colors"
                          >
                            <Copy className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDelete(p)}
                            title="Excluir Produto"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
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
      </Card>

      {/* Modal de Criação / Edição de Produto */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSaving && setIsModalOpen(false)}
        title={editingProduct ? 'Editar Produto' : 'Novo Produto'}
        size="lg"
      >
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Input
                label="Nome do Produto *"
                placeholder="Ex: Cerveja IPA 500ml, Picanha Especial..."
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                required
                autoFocus
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Descrição Detalhada
              </label>
              <textarea
                className="w-full text-xs p-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                rows={2}
                placeholder="Ingredientes, volume, teor alcoólico, harmonização..."
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Categoria do Cardápio
              </label>
              <select
                value={formData.categoryId}
                onChange={e => setFormData({ ...formData, categoryId: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white text-gray-700"
              >
                <option value="">Sem categoria (Geral)</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <Input
                label="SKU / Código Interno"
                placeholder="Ex: CERV-IPA-01"
                value={formData.sku}
                onChange={e => setFormData({ ...formData, sku: e.target.value })}
              />
            </div>

            <div>
              <Input
                label="Preço de Venda (R$) *"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formData.price}
                onChange={e => setFormData({ ...formData, price: e.target.value })}
                required
              />
            </div>

            <div>
              <Input
                label="Preço Promocional (R$)"
                type="number"
                step="0.01"
                placeholder="0.00 (opcional)"
                value={formData.promotionalPrice}
                onChange={e => setFormData({ ...formData, promotionalPrice: e.target.value })}
              />
            </div>

            <div>
              <Input
                label="Custo do Produto (R$)"
                type="number"
                step="0.01"
                placeholder="Para cálculo de margem"
                value={formData.cost}
                onChange={e => setFormData({ ...formData, cost: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Unidade de Medida
              </label>
              <select
                value={formData.unit}
                onChange={e => setFormData({ ...formData, unit: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white text-gray-700"
              >
                <option value="un">Unidade (un)</option>
                <option value="kg">Quilograma (kg)</option>
                <option value="g">Grama (g)</option>
                <option value="l">Litro (l)</option>
                <option value="ml">Mililitro (ml)</option>
                <option value="pack">Fardo / Pack</option>
              </select>
            </div>

            <div>
              <Input
                label="Quantidade em Estoque"
                type="number"
                placeholder="0"
                value={formData.stockQuantity}
                onChange={e => setFormData({ ...formData, stockQuantity: e.target.value })}
              />
            </div>

            <div>
              <Input
                label="Alerta de Estoque Mínimo"
                type="number"
                placeholder="10"
                value={formData.minStock}
                onChange={e => setFormData({ ...formData, minStock: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <ImageUploader
                label="Imagem do Produto"
                description="Envie uma foto real do produto ou informe uma URL externa"
                value={formData.imageUrl}
                onChange={url => setFormData({ ...formData, imageUrl: url })}
                tenantId={activeTenant.id}
                entityType="products"
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-gray-100">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 cursor-pointer"
              />
              <div>
                <span className="text-xs text-gray-800 font-semibold block">Produto Ativo</span>
                <span className="text-[11px] text-gray-400 block">Exibe o item no cardápio</span>
              </div>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.isFeatured}
                onChange={e => setFormData({ ...formData, isFeatured: e.target.checked })}
                className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 cursor-pointer"
              />
              <div>
                <span className="text-xs text-gray-800 font-semibold block">Destacar no Topo</span>
                <span className="text-[11px] text-gray-400 block">Exibe estrela de destaque</span>
              </div>
            </label>
          </div>

          <div className="p-2.5 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${formData.isActive && (parseInt(formData.stockQuantity, 10) || 0) > 0 ? 'bg-emerald-500' : 'bg-gray-400'}`} />
              <span className="text-gray-600 font-medium">Disponibilidade na Vitrine:</span>
            </div>
            <span className={`font-bold ${formData.isActive && (parseInt(formData.stockQuantity, 10) || 0) > 0 ? 'text-emerald-700' : 'text-gray-500'}`}>
              {formData.isActive && (parseInt(formData.stockQuantity, 10) || 0) > 0 ? 'Disponível p/ Venda' : 'Indisponível (Sem estoque ou inativo)'}
            </span>
          </div>

          <div className="flex justify-end gap-2.5 pt-4 border-t border-gray-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsModalOpen(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSaving}
              leftIcon={isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
            >
              {isSaving ? 'Salvando no Banco...' : (editingProduct ? 'Salvar Alterações' : 'Cadastrar Produto')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Confirmação para Remover Conteúdo Demo */}
      <Modal
        isOpen={isRemoveDemoModalOpen}
        onClose={() => !isRemovingDemo && setIsRemoveDemoModalOpen(false)}
        title="Remover Conteúdo de Demonstração"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-600 leading-relaxed">
            Isso removerá somente os produtos, categorias e ofertas de demonstração deste estabelecimento. Seus cadastros reais não serão afetados.
          </p>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-gray-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsRemoveDemoModalOpen(false)}
              disabled={isRemovingDemo}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleRemoveDemo}
              disabled={isRemovingDemo}
              leftIcon={isRemovingDemo ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
            >
              {isRemovingDemo ? 'Removendo...' : 'Remover demonstração'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
