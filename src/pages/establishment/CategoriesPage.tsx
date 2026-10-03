import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { categoryRepository } from '../../repositories/categoryRepository';
import { productRepository } from '../../repositories/productRepository';
import { tenantRepository } from '../../repositories/tenantRepository';
import { ImageUploader } from '../../components/common/ImageUploader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Category, Product } from '../../types';
import { Plus, Edit3, Trash2, ArrowUp, ArrowDown, FolderPlus, Layers, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export const CategoriesPage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  const { showToast } = useToast();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isRemoveDemoModalOpen, setIsRemoveDemoModalOpen] = useState(false);
  const [isRemovingDemo, setIsRemovingDemo] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    imageUrl: '',
    isActive: true,
  });

  const loadData = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const [fetchedCats, fetchedProds] = await Promise.all([
        categoryRepository.getCategories(securityContext, activeTenant.id),
        productRepository.getProducts(securityContext, activeTenant.id).catch(() => []),
      ]);
      setCategories(fetchedCats);
      setProducts(fetchedProds);
    } catch (err: any) {
      console.error('[CategoriesPage] Erro ao carregar dados:', err);
      setError(err.message || 'Falha ao carregar categorias do banco de dados.');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, securityContext]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!activeTenant) return null;

  const handleOpenCreate = () => {
    setEditingCategory(null);
    setFormData({
      name: '',
      description: '',
      imageUrl: '',
      isActive: true,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (c: Category) => {
    setEditingCategory(c);
    setFormData({
      name: c.name,
      description: c.description || '',
      imageUrl: c.imageUrl || '',
      isActive: c.isActive,
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showToast({
        type: 'error',
        title: 'Nome Obrigatório',
        message: 'Informe o nome da categoria.',
      });
      return;
    }

    setIsSaving(true);
    try {
      if (editingCategory) {
        const updated = await categoryRepository.update(securityContext, activeTenant.id, editingCategory.id, {
          name: formData.name,
          description: formData.description || undefined,
          imageUrl: formData.imageUrl || undefined,
          isActive: formData.isActive,
        });
        setCategories(prev => prev.map(c => c.id === updated.id ? updated : c));
        showToast({
          type: 'success',
          title: 'Categoria Atualizada',
          message: `"${formData.name}" foi atualizada no banco de dados com sucesso.`,
        });
      } else {
        const created = await categoryRepository.create(securityContext, activeTenant.id, {
          name: formData.name,
          description: formData.description || undefined,
          imageUrl: formData.imageUrl || undefined,
          isActive: formData.isActive,
          order: categories.length + 1,
        });
        setCategories(prev => [...prev, created]);
        showToast({
          type: 'success',
          title: 'Categoria Criada',
          message: `Nova categoria "${formData.name}" adicionada ao banco e visível no cardápio.`,
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      console.error('[CategoriesPage] Erro ao salvar categoria:', err);
      showToast({
        type: 'error',
        title: 'Erro ao Salvar no Banco',
        message: err.message || 'Falha ao salvar categoria no Supabase.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (c: Category) => {
    try {
      const active = await categoryRepository.toggleStatus(securityContext, activeTenant.id, c.id);
      setCategories(prev => prev.map(item => item.id === c.id ? { ...item, isActive: active } : item));
      showToast({
        type: 'info',
        title: active ? 'Categoria Ativada' : 'Categoria Desativada',
        message: `"${c.name}" agora está ${active ? 'visível' : 'oculta'} no cardápio.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro na Operação',
        message: err.message,
      });
    }
  };

  const handleDelete = async (c: Category) => {
    const attachedProducts = products.filter(p => p.categoryId === c.id);
    if (attachedProducts.length > 0) {
      if (!window.confirm(`Atenção: Existem ${attachedProducts.length} produtos cadastrados nesta categoria. Deseja realmente excluí-la?`)) {
        return;
      }
    } else {
      if (!window.confirm(`Deseja excluir a categoria "${c.name}"?`)) return;
    }

    try {
      await categoryRepository.delete(securityContext, activeTenant.id, c.id);
      setCategories(prev => prev.filter(item => item.id !== c.id));
      showToast({
        type: 'warning',
        title: 'Categoria Excluída',
        message: `"${c.name}" foi removida do banco de dados.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Excluir',
        message: err.message,
      });
    }
  };

  const handleMoveOrder = async (index: number, direction: 'UP' | 'DOWN') => {
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= categories.length) return;

    const list = [...categories];
    const temp = list[index];
    list[index] = list[targetIndex];
    list[targetIndex] = temp;

    // Atualização otimista
    setCategories(list);

    try {
      await categoryRepository.reorder(securityContext, activeTenant.id, list.map(c => c.id));
      showToast({
        type: 'info',
        title: 'Ordem Atualizada',
        message: 'A nova disposição das categorias foi gravada no banco com sucesso.',
      });
    } catch (err: any) {
      // Reverter se falhar
      loadData();
      showToast({
        type: 'error',
        title: 'Erro ao Reordenar',
        message: err.message,
      });
    }
  };

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

  const hasDemoItems = categories.some(c => c.isDemo);

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

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Categorias do Cardápio</h2>
          <p className="text-xs text-gray-500">
            Estruture e ordene os departamentos de produtos visíveis no aplicativo
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleOpenCreate}
          leftIcon={<Plus className="w-4 h-4" />}
          className="shadow-xs text-xs"
        >
          + Nova Categoria
        </Button>
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

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
              <tr>
                <th className="p-3.5 w-16">Ordem</th>
                <th className="p-3.5">Nome & Descrição</th>
                <th className="p-3.5">Total de Produtos</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-emerald-700 mb-2" />
                    <span>Carregando categorias do banco de dados...</span>
                  </td>
                </tr>
              ) : categories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-400">
                    Nenhuma categoria cadastrada ainda. Clique em "+ Nova Categoria" para começar.
                  </td>
                </tr>
              ) : (
                categories.map((c, index) => {
                  const count = products.filter(p => p.categoryId === c.id).length;
                  return (
                    <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-3.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleMoveOrder(index, 'UP')}
                            disabled={index === 0}
                            className="p-1 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            title="Mover para cima"
                          >
                            <ArrowUp className="w-3.5 h-3.5 text-gray-600" />
                          </button>
                          <button
                            onClick={() => handleMoveOrder(index, 'DOWN')}
                            disabled={index === categories.length - 1}
                            className="p-1 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            title="Mover para baixo"
                          >
                            <ArrowDown className="w-3.5 h-3.5 text-gray-600" />
                          </button>
                          <span className="font-mono text-gray-400 ml-1">#{index + 1}</span>
                        </div>
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-2.5">
                          {c.imageUrl ? (
                            <img src={c.imageUrl} alt={c.name} className="w-9 h-9 rounded-lg object-cover border border-gray-200 shrink-0" />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center shrink-0">
                              <Layers className="w-4 h-4" />
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-gray-900 block">{c.name}</span>
                              {c.isDemo && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                  EXEMPLO
                                </span>
                              )}
                            </div>
                            {c.description ? (
                              <span className="text-[11px] text-gray-500 line-clamp-1">{c.description}</span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="p-3.5">
                        <Badge variant="brand" size="sm">
                          {count} {count === 1 ? 'produto' : 'produtos'}
                        </Badge>
                      </td>
                      <td className="p-3.5">
                        <button
                          onClick={() => handleToggleStatus(c)}
                          className="cursor-pointer"
                          title="Clique para alternar status"
                        >
                          <Badge variant={c.isActive ? 'success' : 'neutral'} size="sm">
                            {c.isActive ? 'Ativa' : 'Oculta'}
                          </Badge>
                        </button>
                      </td>
                      <td className="p-3.5 text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(c)}
                          className="text-gray-600 hover:text-gray-900 p-1.5"
                          title="Editar Categoria"
                        >
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(c)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5"
                          title="Excluir Categoria"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal de Criação / Edição */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSaving && setIsModalOpen(false)}
        title={editingCategory ? 'Editar Categoria' : 'Nova Categoria'}
        size="md"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Nome da Categoria *"
            placeholder="Ex: Cervejas Especiais, Destilados, Porções"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            required
            autoFocus
          />

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Descrição (Opcional)
            </label>
            <textarea
              className="w-full text-xs p-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              rows={2}
              placeholder="Breve descrição que orienta o cliente"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <ImageUploader
            label="Imagem da Categoria (Opcional)"
            description="Envie um arquivo JPG, PNG ou informe uma URL externa para a categoria"
            value={formData.imageUrl}
            onChange={url => setFormData({ ...formData, imageUrl: url })}
            tenantId={activeTenant.id}
            entityType="categories"
            disabled={isSaving}
          />

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
              className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 cursor-pointer"
            />
            <label htmlFor="isActive" className="text-xs text-gray-700 font-medium cursor-pointer">
              Categoria Ativa (visível imediatamente na vitrine pública)
            </label>
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
              {isSaving ? 'Salvando no Banco...' : (editingCategory ? 'Salvar Alterações' : 'Criar Categoria')}
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
