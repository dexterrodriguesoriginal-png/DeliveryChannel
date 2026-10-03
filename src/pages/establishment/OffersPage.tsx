import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { offerRepository } from '../../repositories/offerRepository';
import { productRepository } from '../../repositories/productRepository';
import { tenantRepository } from '../../repositories/tenantRepository';
import { ImageUploader } from '../../components/common/ImageUploader';
import { OfferCarousel } from '../../components/common/OfferCarousel';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Offer, Product } from '../../types';
import { getPublicStorePath, isValidStoreSlug } from '../../utils/publicStoreUrl';
import { 
  Plus, 
  Sparkles, 
  Edit3, 
  Trash2, 
  Tag, 
  Calendar, 
  ExternalLink, 
  ArrowRight,
  Eye,
  CheckCircle2,
  Percent,
  Loader2,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export const OffersPage: React.FC = () => {
  const { activeTenant, securityContext } = useAuth();
  const { showToast } = useToast();

  const [offers, setOffers] = useState<Offer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const [isRemoveDemoModalOpen, setIsRemoveDemoModalOpen] = useState(false);
  const [isRemovingDemo, setIsRemovingDemo] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    title: '',
    subtitle: '',
    description: '',
    badge: 'OFERTA ESPECIAL',
    discountPercentage: '',
    originalPrice: '',
    promotionalPrice: '',
    imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&auto=format&fit=crop&q=80',
    productId: '',
    startDate: '',
    endDate: '',
    backgroundColor: '#15803d',
    accentColor: '#4ade80',
    isActive: true,
    order: 1,
  });

  const loadData = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const [fetchedOffers, fetchedProds] = await Promise.all([
        offerRepository.getOffers(securityContext, activeTenant.id),
        productRepository.getProducts(securityContext, activeTenant.id).catch(() => []),
      ]);
      setOffers(fetchedOffers);
      setProducts(fetchedProds);
    } catch (err: any) {
      console.error('[OffersPage] Erro ao carregar ofertas:', err);
      setError(err.message || 'Falha ao carregar ofertas promocionais do banco.');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, securityContext]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!activeTenant) return null;

  const handleOpenCreate = () => {
    setEditingOffer(null);
    setFormData({
      title: '',
      subtitle: '',
      description: '',
      badge: 'DESTAQUE DA SEMANA',
      discountPercentage: '20',
      originalPrice: '',
      promotionalPrice: '',
      imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&auto=format&fit=crop&q=80',
      productId: products[0]?.id || '',
      startDate: new Date().toISOString().split('T')[0],
      endDate: '',
      backgroundColor: activeTenant.theme.primaryColor || '#15803d',
      accentColor: '#4ade80',
      isActive: true,
      order: offers.length + 1,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (off: Offer) => {
    setEditingOffer(off);
    setFormData({
      title: off.title,
      subtitle: off.subtitle || '',
      description: off.description || '',
      badge: off.badge || '',
      discountPercentage: off.discountPercentage ? off.discountPercentage.toString() : '',
      originalPrice: off.originalPrice ? off.originalPrice.toString() : '',
      promotionalPrice: off.promotionalPrice ? off.promotionalPrice.toString() : '',
      imageUrl: off.imageUrl || off.mediaUrl || '',
      productId: off.productId || '',
      startDate: off.startDate || '',
      endDate: off.endDate || '',
      backgroundColor: off.backgroundColor || '#15803d',
      accentColor: off.accentColor || '#ffffff',
      isActive: off.isActive,
      order: off.order,
    });
    setIsModalOpen(true);
  };

  const handleSelectProduct = (prodId: string) => {
    const prod = products.find(p => p.id === prodId);
    if (prod) {
      setFormData(prev => ({
        ...prev,
        productId: prodId,
        title: prev.title || prod.name,
        originalPrice: prod.price.toString(),
        promotionalPrice: prod.promotionalPrice ? prod.promotionalPrice.toString() : (prod.price * 0.8).toFixed(2),
        imageUrl: prod.imageUrl || prev.imageUrl,
      }));
    } else {
      setFormData(prev => ({ ...prev, productId: '' }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.subtitle.trim()) {
      showToast({
        type: 'error',
        title: 'Campos Obrigatórios',
        message: 'Preencha o título e o subtítulo da oferta.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        title: formData.title.trim(),
        subtitle: formData.subtitle.trim(),
        description: formData.description ? formData.description.trim() : undefined,
        badge: formData.badge ? formData.badge.trim() : 'PROMOÇÃO',
        discountPercentage: formData.discountPercentage ? parseInt(formData.discountPercentage, 10) : undefined,
        originalPrice: formData.originalPrice ? parseFloat(formData.originalPrice) : undefined,
        promotionalPrice: formData.promotionalPrice ? parseFloat(formData.promotionalPrice) : undefined,
        imageUrl: formData.imageUrl,
        productId: formData.productId || undefined,
        internalLink: formData.productId && isValidStoreSlug(activeTenant.slug)
          ? `${getPublicStorePath(activeTenant.slug)}?product=${formData.productId}`
          : undefined,
        startDate: formData.startDate || undefined,
        endDate: formData.endDate || undefined,
        backgroundColor: formData.backgroundColor,
        accentColor: formData.accentColor,
        isActive: formData.isActive,
        order: formData.order || 1,
      };

      if (editingOffer) {
        const updated = await offerRepository.update(securityContext, activeTenant.id, editingOffer.id, payload);
        setOffers(prev => prev.map(o => o.id === updated.id ? updated : o));
        showToast({
          type: 'success',
          title: 'Oferta Atualizada',
          message: `Oferta "${payload.title}" salva no banco com sucesso.`,
        });
      } else {
        const created = await offerRepository.create(securityContext, activeTenant.id, payload);
        setOffers(prev => [...prev, created]);
        showToast({
          type: 'success',
          title: 'Nova Oferta Publicada',
          message: `"${payload.title}" gravada no banco e disponível no carrossel da vitrine.`,
        });
      }

      setIsModalOpen(false);
    } catch (err: any) {
      console.error('[OffersPage] Erro ao salvar oferta:', err);
      showToast({
        type: 'error',
        title: 'Erro ao Salvar Oferta no Banco',
        message: err.message || 'Falha ao persistir oferta no Supabase.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (off: Offer) => {
    try {
      const active = await offerRepository.toggleStatus(securityContext, activeTenant.id, off.id);
      setOffers(prev => prev.map(item => item.id === off.id ? { ...item, isActive: active } : item));
      showToast({
        type: 'info',
        title: active ? 'Oferta Ativada' : 'Oferta Pausada',
        message: `"${off.title}" agora está ${active ? 'visível no carrossel' : 'pausada'}.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro na Operação',
        message: err.message,
      });
    }
  };

  const handleDelete = async (off: Offer) => {
    if (!window.confirm(`Deseja realmente remover a oferta "${off.title}" do carrossel?`)) return;

    try {
      await offerRepository.delete(securityContext, activeTenant.id, off.id);
      setOffers(prev => prev.filter(item => item.id !== off.id));
      showToast({
        type: 'warning',
        title: 'Oferta Excluída',
        message: `"${off.title}" foi removida do banco de dados.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Excluir',
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

  const hasDemoItems = offers.some(o => o.isDemo);

  return (
    <div className="space-y-6">
      {hasDemoItems && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 border border-amber-300 shrink-0">
              DEMONSTRAÇÃO
            </span>
            <span className="text-xs text-amber-900 font-medium">
              Este estabelecimento contém ofertas de exemplo para demonstrar os banners na vitrine.
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Banners & Ofertas em Destaque</h2>
          <p className="text-xs text-gray-500">
            Crie banners visuais chamativos no topo do seu aplicativo para acelerar conversões
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Sincronizar
          </Button>

          <Button
            variant="primary"
            onClick={handleOpenCreate}
            leftIcon={<Plus className="w-4 h-4" />}
            className="shadow-xs text-xs"
          >
            + Nova Oferta
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

      {/* Preview do Carrossel em Tempo Real */}
      {offers.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-gray-600 uppercase tracking-wider">
            <Eye className="w-3.5 h-3.5 text-emerald-700" />
            <span>Pré-visualização do Carrossel no App</span>
          </div>
          <div className="max-w-2xl bg-gray-100 p-4 rounded-3xl border border-gray-200 shadow-inner">
            <OfferCarousel offers={offers} onOfferClick={() => {}} />
          </div>
        </div>
      )}

      {/* Cards de Ofertas */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-gray-800">Ofertas Cadastradas ({offers.length})</h3>

        {isLoading ? (
          <Card className="p-10 text-center text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-emerald-700 mb-2" />
            <span>Carregando ofertas do banco de dados...</span>
          </Card>
        ) : offers.length === 0 ? (
          <Card className="p-12 text-center text-gray-400 space-y-2">
            <Tag className="w-10 h-10 text-gray-300 mx-auto" />
            <h4 className="font-bold text-gray-700">Nenhum banner ou oferta ativa</h4>
            <p className="text-xs max-w-sm mx-auto">
              Crie campanhas como "Happy Hour 20% OFF" ou "Combo do Fim de Semana" para aumentar o ticket médio.
            </p>
            <div className="pt-2">
              <Button size="sm" variant="primary" onClick={handleOpenCreate}>
                Criar Primeira Oferta
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {offers.map(off => (
              <Card key={off.id} className="p-4 flex flex-col justify-between space-y-4">
                <div className="flex items-start gap-3">
                  <img
                    src={off.imageUrl}
                    alt={off.title}
                    className="w-20 h-20 rounded-2xl object-cover border border-gray-200 shrink-0"
                  />
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-extrabold text-sm text-gray-900 truncate">{off.title}</span>
                      {off.isDemo && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                          EXEMPLO
                        </span>
                      )}
                      {off.badge && (
                        <Badge variant="brand" size="sm">
                          {off.badge}
                        </Badge>
                      )}
                    </div>

                    <p className="text-xs text-gray-600 font-medium">{off.subtitle}</p>

                    {off.description && (
                      <p className="text-[11px] text-gray-400 line-clamp-1">{off.description}</p>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      {off.promotionalPrice ? (
                        <span className="font-bold text-emerald-800 text-xs font-mono">
                          R$ {off.promotionalPrice.toFixed(2)}
                        </span>
                      ) : null}
                      {off.discountPercentage ? (
                        <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                          {off.discountPercentage}% OFF
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                  <button
                    onClick={() => handleToggleStatus(off)}
                    className="cursor-pointer"
                  >
                    <Badge variant={off.isActive ? 'success' : 'neutral'} size="sm">
                      {off.isActive ? 'Em Exibição' : 'Pausada'}
                    </Badge>
                  </button>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(off)}
                      className="text-gray-600 hover:text-gray-900 p-1.5"
                      title="Editar Oferta"
                    >
                      <Edit3 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(off)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5"
                      title="Remover Oferta"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Modal de Criação / Edição */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSaving && setIsModalOpen(false)}
        title={editingOffer ? 'Editar Oferta' : 'Criar Nova Oferta'}
        size="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Vincular a Produto Cadastrado (Opcional)
              </label>
              <select
                value={formData.productId}
                onChange={e => handleSelectProduct(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white text-gray-700"
              >
                <option value="">Nenhum (Banner Institucional / Geral)</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} — R$ {p.price.toFixed(2)}</option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <Input
                label="Título Principal da Oferta *"
                placeholder="Ex: Combo Sextou de Vinho & Queijo"
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                required
                autoFocus
              />
            </div>

            <div className="sm:col-span-2">
              <Input
                label="Subtítulo / Chamada para Ação *"
                placeholder="Ex: Leve 2 e ganhe 15% de desconto"
                value={formData.subtitle}
                onChange={e => setFormData({ ...formData, subtitle: e.target.value })}
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Descrição Curta
              </label>
              <textarea
                className="w-full text-xs p-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                rows={2}
                placeholder="Regras da promoção ou detalhes adicionais..."
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div>
              <Input
                label="Texto do Selo / Badge"
                placeholder="Ex: 20% OFF, IMPERDÍVEL"
                value={formData.badge}
                onChange={e => setFormData({ ...formData, badge: e.target.value })}
              />
            </div>

            <div>
              <Input
                label="Desconto (%)"
                type="number"
                placeholder="Ex: 15"
                value={formData.discountPercentage}
                onChange={e => setFormData({ ...formData, discountPercentage: e.target.value })}
              />
            </div>

            <div>
              <Input
                label="Preço De (R$)"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formData.originalPrice}
                onChange={e => setFormData({ ...formData, originalPrice: e.target.value })}
              />
            </div>

            <div>
              <Input
                label="Preço Por (R$)"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formData.promotionalPrice}
                onChange={e => setFormData({ ...formData, promotionalPrice: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <ImageUploader
                label="Imagem / Banner da Oferta *"
                description="Carregue uma imagem ou informe a URL externa para o banner da oferta"
                value={formData.imageUrl}
                onChange={url => setFormData({ ...formData, imageUrl: url })}
                tenantId={activeTenant.id}
                entityType="offers"
                disabled={isSaving}
              />
            </div>

            <div>
              <Input
                label="Data Inicial"
                type="date"
                value={formData.startDate}
                onChange={e => setFormData({ ...formData, startDate: e.target.value })}
              />
            </div>

            <div>
              <Input
                label="Data Final (Expiração)"
                type="date"
                value={formData.endDate}
                onChange={e => setFormData({ ...formData, endDate: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Cor de Fundo do Banner
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formData.backgroundColor}
                  onChange={e => setFormData({ ...formData, backgroundColor: e.target.value })}
                  className="w-9 h-9 rounded-lg border border-gray-300 p-0.5 cursor-pointer"
                />
                <input
                  type="text"
                  value={formData.backgroundColor}
                  onChange={e => setFormData({ ...formData, backgroundColor: e.target.value })}
                  className="w-full text-xs p-2 border border-gray-300 rounded-xl font-mono uppercase"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Cor de Destaque / Botão
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formData.accentColor}
                  onChange={e => setFormData({ ...formData, accentColor: e.target.value })}
                  className="w-9 h-9 rounded-lg border border-gray-300 p-0.5 cursor-pointer"
                />
                <input
                  type="text"
                  value={formData.accentColor}
                  onChange={e => setFormData({ ...formData, accentColor: e.target.value })}
                  className="w-full text-xs p-2 border border-gray-300 rounded-xl font-mono uppercase"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
            <input
              type="checkbox"
              id="isOfferActive"
              checked={formData.isActive}
              onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
              className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 cursor-pointer"
            />
            <label htmlFor="isOfferActive" className="text-xs text-gray-700 font-medium cursor-pointer">
              Ativar e exibir oferta imediatamente no carrossel do Web App
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
              {isSaving ? 'Salvando no Banco...' : (editingOffer ? 'Salvar Alterações' : 'Publicar Oferta')}
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
