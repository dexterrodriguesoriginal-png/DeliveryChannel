import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { promotionRepository } from '../../repositories/promotionRepository';
import { productRepository } from '../../repositories/productRepository';
import { customerRepository } from '../../repositories/customerRepository';
import { PromotionCarousel, PromotionCarouselItem, Coupon, Product, Customer } from '../../types';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { 
  Plus, 
  Flame, 
  Tag, 
  Ticket, 
  Edit3, 
  Trash2, 
  ChevronUp, 
  ChevronDown, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles, 
  Calendar, 
  ShoppingBag, 
  ArrowRight,
  Layers,
  Search,
  Check,
  Percent,
  DollarSign
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

export const PromotionsPage: React.FC = () => {
  const { activeTenant, securityContext, activeRole } = useAuth();
  const { showToast } = useToast();

  const canManage = activeRole === 'OWNER' || activeRole === 'MANAGER' || activeRole === 'SUPER_ADMIN' || activeRole === 'CEO';

  const [activeTab, setActiveTab] = useState<'carousels' | 'coupons'>('carousels');
  const [carousels, setCarousels] = useState<PromotionCarousel[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Carousel Modals
  const [isCarouselModalOpen, setIsCarouselModalOpen] = useState(false);
  const [editingCarousel, setEditingCarousel] = useState<PromotionCarousel | null>(null);
  const [carouselForm, setCarouselForm] = useState({
    name: '',
    description: '',
    imageUrl: '',
    showInStore: true,
  });

  // Carousel Products Manager Modal
  const [selectedCarouselForProducts, setSelectedCarouselForProducts] = useState<PromotionCarousel | null>(null);
  const [isAddProductsModalOpen, setIsAddProductsModalOpen] = useState(false);
  const [selectedProductIdsToAdd, setSelectedProductIdsToAdd] = useState<string[]>([]);
  const [productSearchTerm, setProductSearchTerm] = useState('');

  // Item Promotion Editor Modal
  const [editingItem, setEditingItem] = useState<{ carouselId: string; item: PromotionCarouselItem; product: Product } | null>(null);
  const [itemPromoForm, setItemPromoForm] = useState({
    discountType: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED_AMOUNT' | 'PROMOTIONAL_PRICE',
    discountValue: 10,
    promotionalPrice: 0,
    showDiscountBadge: true,
    showPromotionalPrice: true,
    startDate: '',
    endDate: '',
    isActive: true,
  });
  const [promoError, setPromoError] = useState<string | null>(null);

  // Coupon Modals
  const [isCouponModalOpen, setIsCouponModalOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [couponForm, setCouponForm] = useState({
    code: '',
    discountType: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED_AMOUNT',
    discountValue: 10,
    minOrderValue: 0,
    usageLimit: '',
    usageLimitPerCustomer: '1',
    customerId: '',
    startDate: '',
    endDate: '',
    isActive: true,
  });
  const [couponError, setCouponError] = useState<string | null>(null);

  // Load Data
  const loadData = async () => {
    if (!activeTenant) return;
    setIsLoading(true);
    try {
      const [carouselsData, couponsData, productsData, customersData] = await Promise.all([
        promotionRepository.getCarousels(securityContext, activeTenant.id),
        promotionRepository.getCoupons(securityContext, activeTenant.id),
        productRepository.getProducts(securityContext, activeTenant.id),
        customerRepository.getCustomers(securityContext, activeTenant.id).catch(() => []),
      ]);

      setCarousels(carouselsData);
      setCoupons(couponsData);
      setProducts(productsData);
      setCustomers(customersData);

      // Sincroniza carrossel aberto se estiver em edição
      if (selectedCarouselForProducts) {
        const refreshed = carouselsData.find(c => c.id === selectedCarouselForProducts.id);
        if (refreshed) setSelectedCarouselForProducts(refreshed);
      }
    } catch (err: any) {
      console.warn('[PromotionsPage] Erro ao carregar promoções:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTenant?.id]);

  // --------------------------------------------------------------------------
  // CAROUSEL HANDLERS
  // --------------------------------------------------------------------------
  const handleOpenCarouselModal = (carousel?: PromotionCarousel) => {
    if (carousel) {
      setEditingCarousel(carousel);
      setCarouselForm({
        name: carousel.name,
        description: carousel.description || '',
        imageUrl: carousel.imageUrl || '',
        showInStore: carousel.showInStore,
      });
    } else {
      setEditingCarousel(null);
      setCarouselForm({
        name: '',
        description: '',
        imageUrl: '',
        showInStore: true,
      });
    }
    setIsCarouselModalOpen(true);
  };

  const handleSaveCarousel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTenant || !carouselForm.name.trim()) return;

    try {
      if (editingCarousel) {
        await promotionRepository.updateCarousel(securityContext, activeTenant.id, editingCarousel.id, {
          name: carouselForm.name.trim(),
          description: carouselForm.description.trim() || undefined,
          imageUrl: carouselForm.imageUrl.trim() || undefined,
          showInStore: carouselForm.showInStore,
        });
        showToast({ type: 'success', title: 'Carrossel Atualizado', message: 'Alterações salvas com sucesso.' });
      } else {
        await promotionRepository.createCarousel(securityContext, activeTenant.id, {
          name: carouselForm.name.trim(),
          description: carouselForm.description.trim() || undefined,
          showInStore: carouselForm.showInStore,
        });
        showToast({ type: 'success', title: 'Carrossel Criado', message: 'Novo carrossel promocional adicionado.' });
      }
      setIsCarouselModalOpen(false);
      await loadData();
    } catch (err: any) {
      showToast({ type: 'error', title: 'Erro ao Salvar', message: err.message || 'Falha ao salvar carrossel.' });
    }
  };

  const handleToggleCarouselActive = async (carousel: PromotionCarousel) => {
    if (!activeTenant) return;
    try {
      await promotionRepository.updateCarousel(securityContext, activeTenant.id, carousel.id, {
        isActive: !carousel.isActive,
      });
      showToast({
        type: 'success',
        title: carousel.isActive ? 'Carrossel Desativado' : 'Carrossel Ativado',
        message: `Carrossel "${carousel.name}" atualizado.`,
      });
      await loadData();
    } catch (err: any) {
      showToast({ type: 'error', title: 'Erro', message: err.message });
    }
  };

  const handleToggleCarouselShowInStore = async (carousel: PromotionCarousel) => {
    if (!activeTenant) return;
    try {
      await promotionRepository.updateCarousel(securityContext, activeTenant.id, carousel.id, {
        showInStore: !carousel.showInStore,
      });
      showToast({
        type: 'success',
        title: !carousel.showInStore ? 'Visível na Vitrine' : 'Oculto na Vitrine',
        message: `Carrossel "${carousel.name}" atualizado.`,
      });
      await loadData();
    } catch (err: any) {
      showToast({ type: 'error', title: 'Erro', message: err.message });
    }
  };

  const handleDeleteCarousel = async (carouselId: string) => {
    if (!activeTenant || !window.confirm('Tem certeza que deseja excluir este carrossel promocional?')) return;
    try {
      await promotionRepository.deleteCarousel(securityContext, activeTenant.id, carouselId);
      showToast({ type: 'success', title: 'Carrossel Removido', message: 'O carrossel foi excluído.' });
      if (selectedCarouselForProducts?.id === carouselId) {
        setSelectedCarouselForProducts(null);
      }
      await loadData();
    } catch (err: any) {
      showToast({ type: 'error', title: 'Erro', message: err.message });
    }
  };

  const handleMoveCarousel = async (index: number, direction: 'up' | 'down') => {
    if (!activeTenant) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= carousels.length) return;

    const newCarousels = [...carousels];
    const [moved] = newCarousels.splice(index, 1);
    newCarousels.splice(targetIndex, 0, moved);

    const ids = newCarousels.map(c => c.id);
    setCarousels(newCarousels);
    try {
      await promotionRepository.reorderCarousels(securityContext, activeTenant.id, ids);
    } catch (err) {
      console.warn('Erro ao reordenar carrosséis:', err);
    }
  };

  // --------------------------------------------------------------------------
  // CAROUSEL PRODUCTS HANDLERS
  // --------------------------------------------------------------------------
  const handleOpenAddProductsModal = () => {
    setSelectedProductIdsToAdd([]);
    setProductSearchTerm('');
    setIsAddProductsModalOpen(true);
  };

  const handleAddSelectedProducts = async () => {
    if (!activeTenant || !selectedCarouselForProducts || selectedProductIdsToAdd.length === 0) return;
    try {
      await promotionRepository.addProductsToCarousel(
        securityContext,
        activeTenant.id,
        selectedCarouselForProducts.id,
        selectedProductIdsToAdd
      );
      showToast({
        type: 'success',
        title: 'Produtos Adicionados',
        message: `${selectedProductIdsToAdd.length} produto(s) adicionados ao carrossel.`,
      });
      setIsAddProductsModalOpen(false);
      await loadData();
    } catch (err: any) {
      showToast({ type: 'error', title: 'Erro', message: err.message });
    }
  };

  const handleRemoveProductFromCarousel = async (itemId: string) => {
    if (!activeTenant || !selectedCarouselForProducts) return;
    try {
      await promotionRepository.removeProductFromCarousel(
        securityContext,
        activeTenant.id,
        selectedCarouselForProducts.id,
        itemId
      );
      showToast({ type: 'success', title: 'Produto Removido', message: 'Item retirado do carrossel promocional.' });
      await loadData();
    } catch (err: any) {
      showToast({ type: 'error', title: 'Erro', message: err.message });
    }
  };

  const handleMoveCarouselItem = async (index: number, direction: 'up' | 'down') => {
    if (!activeTenant || !selectedCarouselForProducts) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const items = [...selectedCarouselForProducts.items];
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const [moved] = items.splice(index, 1);
    items.splice(targetIndex, 0, moved);

    const updated = { ...selectedCarouselForProducts, items };
    setSelectedCarouselForProducts(updated);

    try {
      await promotionRepository.reorderCarouselItems(
        securityContext,
        activeTenant.id,
        selectedCarouselForProducts.id,
        items.map(i => i.id)
      );
    } catch (err) {
      console.warn('Erro ao reordenar itens:', err);
    }
  };

  // --------------------------------------------------------------------------
  // ITEM PROMOTION CONFIGURATION & REAL-TIME PREVIEW
  // --------------------------------------------------------------------------
  const handleOpenItemPromotionModal = (item: PromotionCarouselItem) => {
    const product = products.find(p => p.id === item.productId);
    if (!product || !selectedCarouselForProducts) return;

    setEditingItem({
      carouselId: selectedCarouselForProducts.id,
      item,
      product,
    });

    setItemPromoForm({
      discountType: item.discountType || 'PERCENTAGE',
      discountValue: item.discountValue,
      promotionalPrice: item.promotionalPrice,
      showDiscountBadge: item.showDiscountBadge,
      showPromotionalPrice: item.showPromotionalPrice,
      startDate: item.startDate ? item.startDate.slice(0, 16) : '',
      endDate: item.endDate ? item.endDate.slice(0, 16) : '',
      isActive: item.isActive,
    });
    setPromoError(null);
  };

  // Calcula valores matematicamente corretos em tempo real
  const promoPreview = useMemo(() => {
    if (!editingItem) return null;
    const normalPrice = editingItem.product.price;
    let promoPrice = normalPrice;
    let discountPct = 0;
    let economy = 0;

    if (itemPromoForm.discountType === 'PERCENTAGE') {
      const pct = Math.min(99, Math.max(1, Number(itemPromoForm.discountValue) || 1));
      promoPrice = Number((normalPrice * (1 - pct / 100)).toFixed(2));
      discountPct = pct;
      economy = Number((normalPrice - promoPrice).toFixed(2));
    } else if (itemPromoForm.discountType === 'PROMOTIONAL_PRICE') {
      promoPrice = Number(Number(itemPromoForm.promotionalPrice).toFixed(2));
      if (promoPrice > 0 && promoPrice < normalPrice) {
        economy = Number((normalPrice - promoPrice).toFixed(2));
        discountPct = Math.round((economy / normalPrice) * 100);
      }
    } else if (itemPromoForm.discountType === 'FIXED_AMOUNT') {
      const off = Number(itemPromoForm.discountValue) || 0;
      promoPrice = Number((normalPrice - off).toFixed(2));
      economy = off;
      if (normalPrice > 0) {
        discountPct = Math.round((off / normalPrice) * 100);
      }
    }

    const isValid = promoPrice > 0 && promoPrice < normalPrice && discountPct < 100 && discountPct > 0;

    return {
      normalPrice,
      promoPrice,
      discountPct,
      economy,
      isValid,
    };
  }, [editingItem, itemPromoForm]);

  const handleSaveItemPromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTenant || !editingItem || !promoPreview) return;

    if (!promoPreview.isValid) {
      setPromoError('O preço promocional deve ser maior que zero e estritamente menor que o preço normal (R$ ' + editingItem.product.price.toFixed(2) + ').');
      return;
    }

    try {
      await promotionRepository.updateCarouselItemPromotion(
        securityContext,
        activeTenant.id,
        editingItem.carouselId,
        editingItem.item.id,
        {
          discountType: itemPromoForm.discountType,
          discountValue: itemPromoForm.discountType === 'PROMOTIONAL_PRICE' ? promoPreview.promoPrice : Number(itemPromoForm.discountValue),
          promotionalPrice: promoPreview.promoPrice,
          showDiscountBadge: itemPromoForm.showDiscountBadge,
          showPromotionalPrice: itemPromoForm.showPromotionalPrice,
          startDate: itemPromoForm.startDate ? new Date(itemPromoForm.startDate).toISOString() : undefined,
          endDate: itemPromoForm.endDate ? new Date(itemPromoForm.endDate).toISOString() : undefined,
          isActive: itemPromoForm.isActive,
        }
      );

      showToast({
        type: 'success',
        title: 'Promoção Configurada',
        message: `Desconto de ${promoPreview.discountPct}% configurado com sucesso para ${editingItem.product.name}.`,
      });
      setEditingItem(null);
      await loadData();
    } catch (err: any) {
      setPromoError(err.message || 'Falha ao salvar configuração da promoção.');
    }
  };

  // --------------------------------------------------------------------------
  // COUPON HANDLERS
  // --------------------------------------------------------------------------
  const handleOpenCouponModal = (coupon?: Coupon) => {
    if (coupon) {
      setEditingCoupon(coupon);
      setCouponForm({
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minOrderValue: coupon.minOrderValue || 0,
        usageLimit: coupon.usageLimit ? String(coupon.usageLimit) : '',
        usageLimitPerCustomer: String(coupon.usageLimitPerCustomer || 1),
        customerId: coupon.customerId || '',
        startDate: coupon.startDate ? coupon.startDate.slice(0, 16) : '',
        endDate: coupon.endDate ? coupon.endDate.slice(0, 16) : '',
        isActive: coupon.isActive,
      });
    } else {
      setEditingCoupon(null);
      setCouponForm({
        code: '',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        minOrderValue: 0,
        usageLimit: '',
        usageLimitPerCustomer: '1',
        customerId: '',
        startDate: '',
        endDate: '',
        isActive: true,
      });
    }
    setCouponError(null);
    setIsCouponModalOpen(true);
  };

  const handleSaveCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTenant || !couponForm.code.trim()) return;

    const val = Number(couponForm.discountValue);
    if (val <= 0) {
      setCouponError('O valor do desconto deve ser maior que zero.');
      return;
    }
    if (couponForm.discountType === 'PERCENTAGE' && val >= 100) {
      setCouponError('O desconto percentual não pode ser de 100% ou superior.');
      return;
    }

    try {
      const payload: Partial<Coupon> = {
        code: couponForm.code.trim().toUpperCase(),
        discountType: couponForm.discountType,
        discountValue: val,
        minOrderValue: Number(couponForm.minOrderValue) || 0,
        usageLimit: couponForm.usageLimit ? parseInt(couponForm.usageLimit, 10) : undefined,
        usageLimitPerCustomer: parseInt(couponForm.usageLimitPerCustomer, 10) || 1,
        customerId: couponForm.customerId || undefined,
        startDate: couponForm.startDate ? new Date(couponForm.startDate).toISOString() : undefined,
        endDate: couponForm.endDate ? new Date(couponForm.endDate).toISOString() : undefined,
        isActive: couponForm.isActive,
      };

      if (editingCoupon) {
        await promotionRepository.updateCoupon(securityContext, activeTenant.id, editingCoupon.id, payload);
        showToast({ type: 'success', title: 'Cupom Atualizado', message: `Cupom ${payload.code} salvo com sucesso.` });
      } else {
        await promotionRepository.createCoupon(securityContext, activeTenant.id, payload);
        showToast({ type: 'success', title: 'Cupom Criado', message: `Cupom ${payload.code} adicionado.` });
      }
      setIsCouponModalOpen(false);
      await loadData();
    } catch (err: any) {
      setCouponError(err.message || 'Falha ao salvar cupom.');
    }
  };

  const handleDeleteCoupon = async (couponId: string) => {
    if (!activeTenant || !window.confirm('Deseja realmente excluir este cupom?')) return;
    try {
      await promotionRepository.deleteCoupon(securityContext, activeTenant.id, couponId);
      showToast({ type: 'success', title: 'Cupom Removido', message: 'O cupom foi excluído.' });
      await loadData();
    } catch (err: any) {
      showToast({ type: 'error', title: 'Erro', message: err.message });
    }
  };

  // Filtro de produtos disponíveis para adicionar ao carrossel selecionado
  const availableProductsToAdd = useMemo(() => {
    if (!selectedCarouselForProducts) return [];
    const existingIds = new Set(selectedCarouselForProducts.items.map(i => i.productId));
    return products.filter(p => {
      if (existingIds.has(p.id)) return false;
      if (!productSearchTerm.trim()) return true;
      return p.name.toLowerCase().includes(productSearchTerm.toLowerCase());
    });
  }, [products, selectedCarouselForProducts, productSearchTerm]);

  return (
    <div className="space-y-6 max-w-6xl pb-16">
      {/* Header com identidade da loja e abas principais */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Tag className="w-5 h-5 text-emerald-700" />
            Promoções & Cupons
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Crie promoções para sua vitrine, organize carrosséis e distribua cupons aos seus clientes.
          </p>
        </div>

        {/* Botão de ação dinâmico */}
        {canManage && (
          <div>
            {activeTab === 'carousels' ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleOpenCarouselModal()}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                + Novo Carrossel
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleOpenCouponModal()}
                leftIcon={<Plus className="w-4 h-4" />}
              >
                + Novo Cupom
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Navegação Interna por Tabs conforme Requisito 39 */}
      <div className="flex items-center gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('carousels')}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'carousels'
              ? 'border-emerald-700 text-emerald-900 bg-emerald-50/40 rounded-t-lg'
              : 'border-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <Flame className="w-4 h-4 text-amber-500" />
          <span>Carrosséis de Promoção</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-700 font-mono">
            {carousels.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('coupons')}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'coupons'
              ? 'border-emerald-700 text-emerald-900 bg-emerald-50/40 rounded-t-lg'
              : 'border-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <Ticket className="w-4 h-4 text-emerald-600" />
          <span>Cupons</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-700 font-mono">
            {coupons.length}
          </span>
        </button>

        <div className="hidden sm:flex items-center gap-1.5 ml-auto text-[11px] text-gray-400">
          <span>Campanhas WhatsApp & E-mail</span>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            Em breve
          </span>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* ABA 1: CARROSSÉIS DE PROMOÇÃO                                         */}
      {/* ===================================================================== */}
      {activeTab === 'carousels' && (
        <div className="space-y-4">
          <div className="p-3 bg-emerald-50/60 border border-emerald-200/80 rounded-xl flex items-center justify-between text-xs text-emerald-950">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                <strong>Carrosséis de Promoção:</strong> Crie categorias promocionais independentes do catálogo. Os produtos em destaque aparecerão no topo da vitrine com selo de desconto real.
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-xs text-gray-400">Carregando carrosséis promocionais...</div>
          ) : carousels.length === 0 ? (
            <Card className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
                <Flame className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-gray-900">Nenhum carrossel promocional criado</h3>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                Crie seu primeiro carrossel (ex: "Ofertas do Dia" ou "Festival de Cervejas") para destacar promoções irresistíveis na vitrine da sua loja.
              </p>
              {canManage && (
                <div className="pt-2">
                  <Button variant="primary" size="sm" onClick={() => handleOpenCarouselModal()} leftIcon={<Plus className="w-4 h-4" />}>
                    Criar Meu Primeiro Carrossel
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <div className="space-y-3">
              {carousels.map((carousel, index) => {
                const activeItemsCount = (carousel.items || []).filter(i => i.isActive).length;
                return (
                  <Card key={carousel.id} className="p-4 transition-all hover:shadow-xs border border-gray-200">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      {/* Lado Esquerdo: Identificação do Carrossel */}
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200/60">
                          <Flame className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-bold text-gray-900 truncate">{carousel.name}</h4>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700">
                              {carousel.items?.length || 0} produtos ({activeItemsCount} ativos)
                            </span>
                            {carousel.showInStore ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                                <Eye className="w-3 h-3 text-emerald-600" />
                                Visível na Vitrine
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200 flex items-center gap-1">
                                <EyeOff className="w-3 h-3 text-gray-400" />
                                Oculto na Vitrine
                              </span>
                            )}
                            {!carousel.isActive && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                Desativado
                              </span>
                            )}
                          </div>
                          {carousel.description && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{carousel.description}</p>
                          )}
                        </div>
                      </div>

                      {/* Lado Direito: Controles e Ações */}
                      {canManage && (
                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                          {/* Reordenação de Carrosséis */}
                          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => handleMoveCarousel(index, 'up')}
                              className="p-1.5 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-gray-700"
                              title="Subir posição na vitrine"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={index === carousels.length - 1}
                              onClick={() => handleMoveCarousel(index, 'down')}
                              className="p-1.5 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-gray-700 border-l border-gray-200"
                              title="Descer posição na vitrine"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedCarouselForProducts(carousel)}
                            leftIcon={<ShoppingBag className="w-3.5 h-3.5 text-emerald-700" />}
                          >
                            Gerenciar Produtos ({carousel.items?.length || 0})
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenCarouselModal(carousel)}
                            leftIcon={<Edit3 className="w-3.5 h-3.5" />}
                          >
                            Editar
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleCarouselShowInStore(carousel)}
                            title={carousel.showInStore ? 'Ocultar da vitrine' : 'Exibir na vitrine'}
                          >
                            {carousel.showInStore ? <EyeOff className="w-3.5 h-3.5 text-gray-500" /> : <Eye className="w-3.5 h-3.5 text-emerald-600" />}
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteCarousel(carousel.id)}
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                            title="Excluir carrossel"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* ABA 2: CUPONS DE DESCONTO                                             */}
      {/* ===================================================================== */}
      {activeTab === 'coupons' && (
        <div className="space-y-4">
          <div className="p-3 bg-emerald-50/60 border border-emerald-200/80 rounded-xl flex items-center justify-between text-xs text-emerald-950">
            <div className="flex items-center gap-2">
              <Ticket className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                <strong>Cupons de Desconto:</strong> Crie códigos promocionais (gerais ou para clientes específicos) para alavancar vendas na sacola de compras.
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-xs text-gray-400">Carregando cupons...</div>
          ) : coupons.length === 0 ? (
            <Card className="p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
                <Ticket className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-gray-900">Nenhum cupom ativo no momento</h3>
              <p className="text-xs text-gray-500 max-w-md mx-auto">
                Crie cupons promocionais (ex: "PRIMEIRACOMPRA" ou "VOLTA10") com valor percentual ou fixo.
              </p>
              {canManage && (
                <div className="pt-2">
                  <Button variant="primary" size="sm" onClick={() => handleOpenCouponModal()} leftIcon={<Plus className="w-4 h-4" />}>
                    Criar Meu Primeiro Cupom
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {coupons.map((coupon) => (
                <Card key={coupon.id} className="p-4 space-y-3 border border-gray-200 relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-900 font-mono font-black text-sm tracking-wider border border-emerald-300">
                      {coupon.code}
                    </span>
                    <Badge variant={coupon.isActive ? 'success' : 'neutral'} size="sm">
                      {coupon.isActive ? 'Ativo' : 'Pausado'}
                    </Badge>
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Desconto:</span>
                      <strong className="text-emerald-700 font-bold">
                        {coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}% OFF` : `R$ ${coupon.discountValue.toFixed(2)} OFF`}
                      </strong>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Compra Mínima:</span>
                      <span className="text-gray-800">
                        {coupon.minOrderValue ? `R$ ${coupon.minOrderValue.toFixed(2)}` : 'Sem mínimo'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Usos:</span>
                      <span className="text-gray-800">
                        {coupon.timesUsed} {coupon.usageLimit ? `/ ${coupon.usageLimit}` : 'usos'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Destinatário:</span>
                      <span className="text-gray-800 truncate max-w-[140px]">
                        {coupon.customerName ? `Exclusivo: ${coupon.customerName}` : 'Público Geral'}
                      </span>
                    </div>
                  </div>

                  {canManage && (
                    <div className="pt-2 border-t border-gray-100 flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleOpenCouponModal(coupon)}>
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-600 hover:text-rose-700"
                        onClick={() => handleDeleteCoupon(coupon.id)}
                      >
                        Excluir
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: CRIAR / EDITAR CARROSSEL                                     */}
      {/* ===================================================================== */}
      <Modal
        isOpen={isCarouselModalOpen}
        onClose={() => setIsCarouselModalOpen(false)}
        title={editingCarousel ? 'Editar Carrossel Promocional' : 'Novo Carrossel Promocional'}
      >
        <form onSubmit={handleSaveCarousel} className="space-y-4">
          <Input
            label="Nome do Carrossel *"
            placeholder="Ex: Ofertas do Dia, Festival de Carnes, Mais Vendidos"
            value={carouselForm.name}
            onChange={(e) => setCarouselForm({ ...carouselForm, name: e.target.value })}
            required
          />

          <Input
            label="Descrição Opcional"
            placeholder="Ex: Os melhores preços e ofertas selecionadas de hoje"
            value={carouselForm.description}
            onChange={(e) => setCarouselForm({ ...carouselForm, description: e.target.value })}
          />

          <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-gray-800 block">Exibir na Vitrine</span>
              <span className="text-[11px] text-gray-500 block">
                Quando ativado, aparecerá acima do catálogo normal da loja.
              </span>
            </div>
            <input
              type="checkbox"
              checked={carouselForm.showInStore}
              onChange={(e) => setCarouselForm({ ...carouselForm, showInStore: e.target.checked })}
              className="w-4 h-4 text-emerald-600 rounded cursor-pointer"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2 border-t border-gray-100">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsCarouselModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Salvar Carrossel
            </Button>
          </div>
        </form>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 2: GERENCIAR PRODUTOS DO CARROSSEL                              */}
      {/* ===================================================================== */}
      <Modal
        isOpen={!!selectedCarouselForProducts}
        onClose={() => setSelectedCarouselForProducts(null)}
        title={selectedCarouselForProducts ? `Produtos de: ${selectedCarouselForProducts.name}` : 'Gerenciar Produtos'}
        size="xl"
      >
        {selectedCarouselForProducts && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <span className="text-xs text-gray-500">
                Arraste ou suba/desça para definir a ordem na vitrine. Cada produto possui promoção individual.
              </span>
              {canManage && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleOpenAddProductsModal}
                  leftIcon={<Plus className="w-3.5 h-3.5" />}
                >
                  + Adicionar Produtos
                </Button>
              )}
            </div>

            {selectedCarouselForProducts.items.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <ShoppingBag className="w-8 h-8 text-gray-300 mx-auto" />
                <p className="text-xs font-bold text-gray-700">Nenhum produto adicionado a este carrossel</p>
                <p className="text-[11px] text-gray-400">Clique em "+ Adicionar Produtos" para selecionar produtos do catálogo.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {selectedCarouselForProducts.items.map((item, index) => {
                  const product = products.find(p => p.id === item.productId);
                  if (!product) return null;

                  return (
                    <div
                      key={item.id}
                      className="p-3 bg-white border border-gray-200 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-all hover:border-gray-300"
                    >
                      {/* Produto & Preços */}
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="w-12 h-12 object-cover rounded-lg shrink-0 border border-gray-100"
                        />
                        <div className="min-w-0">
                          <h5 className="text-xs font-bold text-gray-900 truncate">{product.name}</h5>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs text-gray-400 line-through">
                              R$ {product.price.toFixed(2)}
                            </span>
                            <span className="text-xs font-black text-emerald-700">
                              R$ {item.promotionalPrice.toFixed(2)}
                            </span>
                            {item.showDiscountBadge && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-600 text-white shadow-2xs">
                                -{item.calculatedDiscountPercentage}%
                              </span>
                            )}
                            <span className="text-[10px] text-gray-500">
                              (Economia: R$ {(product.price - item.promotionalPrice).toFixed(2)})
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Controles de Ordem e Edição */}
                      {canManage && (
                        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                          {/* Botões Subir/Descer */}
                          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => handleMoveCarouselItem(index, 'up')}
                              className="p-1 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-gray-700"
                              title="Subir posição"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={index === selectedCarouselForProducts.items.length - 1}
                              onClick={() => handleMoveCarouselItem(index, 'down')}
                              className="p-1 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-gray-700 border-l border-gray-200"
                              title="Descer posição"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenItemPromotionModal(item)}
                            leftIcon={<Percent className="w-3.5 h-3.5 text-emerald-700" />}
                          >
                            Configurar Desconto
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                            onClick={() => handleRemoveProductFromCarousel(item.id)}
                            title="Remover deste carrossel"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 3: ADICIONAR PRODUTOS AO CARROSSEL                              */}
      {/* ===================================================================== */}
      <Modal
        isOpen={isAddProductsModalOpen}
        onClose={() => setIsAddProductsModalOpen(false)}
        title="Adicionar Produtos ao Carrossel"
        size="lg"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar produtos por nome..."
              value={productSearchTerm}
              onChange={(e) => setProductSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-200"
            />
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1.5 border border-gray-100 rounded-lg p-1">
            {availableProductsToAdd.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">
                Nenhum produto disponível para adicionar.
              </div>
            ) : (
              availableProductsToAdd.map((prod) => {
                const isSelected = selectedProductIdsToAdd.includes(prod.id);
                return (
                  <div
                    key={prod.id}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedProductIdsToAdd(selectedProductIdsToAdd.filter(id => id !== prod.id));
                      } else {
                        setSelectedProductIdsToAdd([...selectedProductIdsToAdd, prod.id]);
                      }
                    }}
                    className={`p-2.5 rounded-lg flex items-center justify-between cursor-pointer transition-all ${
                      isSelected ? 'bg-emerald-50 border border-emerald-300' : 'bg-white hover:bg-gray-50 border border-gray-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img src={prod.imageUrl} alt={prod.name} className="w-8 h-8 rounded object-cover shrink-0" />
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-gray-900 block truncate">{prod.name}</span>
                        <span className="text-[11px] text-gray-500">R$ {prod.price.toFixed(2)}</span>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="w-4 h-4 text-emerald-600 rounded cursor-pointer"
                    />
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <span className="text-xs text-gray-500">
              {selectedProductIdsToAdd.length} selecionado(s)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsAddProductsModalOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={selectedProductIdsToAdd.length === 0}
                onClick={handleAddSelectedProducts}
              >
                Adicionar Selecionados
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 4: CONFIGURAR DESCONTO INDIVIDUAL DO PRODUTO (COM PRÉVIA)        */}
      {/* ===================================================================== */}
      <Modal
        isOpen={!!editingItem}
        onClose={() => setEditingItem(null)}
        title="Configurar Promoção do Produto"
        size="md"
      >
        {editingItem && promoPreview && (
          <form onSubmit={handleSaveItemPromotion} className="space-y-4">
            {/* Cabeçalho do Produto */}
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-3">
              <img
                src={editingItem.product.imageUrl}
                alt={editingItem.product.name}
                className="w-12 h-12 rounded-lg object-cover shrink-0"
              />
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-gray-900 truncate">{editingItem.product.name}</h4>
                <p className="text-xs text-gray-500">
                  Preço Normal de Catálogo: <strong className="text-gray-900">R$ {editingItem.product.price.toFixed(2)}</strong>
                </p>
              </div>
            </div>

            {/* Tipo de Promoção */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700">Tipo de Promoção</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setItemPromoForm({ ...itemPromoForm, discountType: 'PERCENTAGE' })}
                  className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    itemPromoForm.discountType === 'PERCENTAGE'
                      ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  % Percentual
                </button>
                <button
                  type="button"
                  onClick={() => setItemPromoForm({ ...itemPromoForm, discountType: 'PROMOTIONAL_PRICE' })}
                  className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    itemPromoForm.discountType === 'PROMOTIONAL_PRICE'
                      ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  Preço Final
                </button>
                <button
                  type="button"
                  onClick={() => setItemPromoForm({ ...itemPromoForm, discountType: 'FIXED_AMOUNT' })}
                  className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    itemPromoForm.discountType === 'FIXED_AMOUNT'
                      ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  R$ Valor OFF
                </button>
              </div>
            </div>

            {/* Input dependendo do tipo */}
            {itemPromoForm.discountType === 'PERCENTAGE' && (
              <Input
                label="Percentual de Desconto (%) *"
                type="number"
                min={1}
                max={99}
                step={1}
                value={itemPromoForm.discountValue}
                onChange={(e) => setItemPromoForm({ ...itemPromoForm, discountValue: parseFloat(e.target.value) || 0 })}
                helperText="Ex: 30 para 30% de desconto"
              />
            )}

            {itemPromoForm.discountType === 'PROMOTIONAL_PRICE' && (
              <Input
                label="Preço Promocional (R$) *"
                type="number"
                min={0.01}
                max={editingItem.product.price - 0.01}
                step={0.01}
                value={itemPromoForm.promotionalPrice}
                onChange={(e) => setItemPromoForm({ ...itemPromoForm, promotionalPrice: parseFloat(e.target.value) || 0 })}
                helperText={`Deve ser menor que R$ ${editingItem.product.price.toFixed(2)}`}
              />
            )}

            {itemPromoForm.discountType === 'FIXED_AMOUNT' && (
              <Input
                label="Valor de Desconto em Reais (R$) *"
                type="number"
                min={0.01}
                max={editingItem.product.price - 0.01}
                step={0.01}
                value={itemPromoForm.discountValue}
                onChange={(e) => setItemPromoForm({ ...itemPromoForm, discountValue: parseFloat(e.target.value) || 0 })}
                helperText={`Ex: 10 para R$ 10,00 de desconto`}
              />
            )}

            {/* ================================================================= */}
            {/* PRÉVIA EM TEMPO REAL CONFORME SEÇÃO 16                            */}
            {/* ================================================================= */}
            <div className="p-3.5 bg-emerald-50/50 border-2 border-dashed border-emerald-300 rounded-xl space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">
                Prévia da Promoção na Vitrine:
              </span>

              <div className="bg-white p-3 rounded-lg border border-emerald-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <img
                      src={editingItem.product.imageUrl}
                      alt={editingItem.product.name}
                      className="w-12 h-12 rounded object-cover"
                    />
                    {itemPromoForm.showDiscountBadge && promoPreview.discountPct > 0 && (
                      <span className="absolute -bottom-1 -left-1 px-1.5 py-0.5 rounded text-[9px] font-black bg-emerald-600 text-white shadow-xs">
                        -{promoPreview.discountPct}%
                      </span>
                    )}
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-gray-900">{editingItem.product.name}</h5>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400 line-through">
                        R$ {promoPreview.normalPrice.toFixed(2)}
                      </span>
                      <span className="text-sm font-black text-emerald-700">
                        R$ {promoPreview.promoPrice.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-gray-500 block">Economia do Cliente</span>
                  <strong className="text-xs text-emerald-800 font-bold">
                    R$ {promoPreview.economy.toFixed(2)}
                  </strong>
                </div>
              </div>
            </div>

            {/* Opções de Exibição */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="p-2.5 border rounded-lg flex items-center gap-2 cursor-pointer bg-white">
                <input
                  type="checkbox"
                  checked={itemPromoForm.showDiscountBadge}
                  onChange={(e) => setItemPromoForm({ ...itemPromoForm, showDiscountBadge: e.target.checked })}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
                <span className="text-gray-700 font-medium">Mostrar selo -XX%</span>
              </label>

              <label className="p-2.5 border rounded-lg flex items-center gap-2 cursor-pointer bg-white">
                <input
                  type="checkbox"
                  checked={itemPromoForm.showPromotionalPrice}
                  onChange={(e) => setItemPromoForm({ ...itemPromoForm, showPromotionalPrice: e.target.checked })}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
                <span className="text-gray-700 font-medium">Destacar preço promo</span>
              </label>
            </div>

            {/* Período de Validade */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Início da Promoção (Opcional)"
                type="datetime-local"
                value={itemPromoForm.startDate}
                onChange={(e) => setItemPromoForm({ ...itemPromoForm, startDate: e.target.value })}
              />
              <Input
                label="Fim da Promoção (Opcional)"
                type="datetime-local"
                value={itemPromoForm.endDate}
                onChange={(e) => setItemPromoForm({ ...itemPromoForm, endDate: e.target.value })}
              />
            </div>

            {promoError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs font-bold text-rose-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{promoError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingItem(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="sm">
                Salvar Promoção
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ===================================================================== */}
      {/* MODAL 5: CRIAR / EDITAR CUPOM                                         */}
      {/* ===================================================================== */}
      <Modal
        isOpen={isCouponModalOpen}
        onClose={() => setIsCouponModalOpen(false)}
        title={editingCoupon ? 'Editar Cupom' : 'Novo Cupom de Desconto'}
      >
        <form onSubmit={handleSaveCoupon} className="space-y-4">
          <Input
            label="Código do Cupom *"
            placeholder="Ex: PRIMEIRACOMPRA, VOLTA10"
            value={couponForm.code}
            onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase().replace(/\s/g, '') })}
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-700 block mb-1">Tipo de Desconto</label>
              <select
                value={couponForm.discountType}
                onChange={(e) => setCouponForm({ ...couponForm, discountType: e.target.value as any })}
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-200"
              >
                <option value="PERCENTAGE">Percentual (%)</option>
                <option value="FIXED_AMOUNT">Valor Fixo (R$)</option>
              </select>
            </div>

            <Input
              label="Valor *"
              type="number"
              step={0.01}
              min={0.01}
              value={couponForm.discountValue}
              onChange={(e) => setCouponForm({ ...couponForm, discountValue: parseFloat(e.target.value) || 0 })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Compra Mínima (R$)"
              type="number"
              step={0.01}
              min={0}
              value={couponForm.minOrderValue}
              onChange={(e) => setCouponForm({ ...couponForm, minOrderValue: parseFloat(e.target.value) || 0 })}
              placeholder="0.00"
            />

            <Input
              label="Limite Total de Usos"
              type="number"
              min={1}
              value={couponForm.usageLimit}
              onChange={(e) => setCouponForm({ ...couponForm, usageLimit: e.target.value })}
              placeholder="Ilimitado"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-700 block mb-1">Cliente Específico (Opcional)</label>
            <select
              value={couponForm.customerId}
              onChange={(e) => setCouponForm({ ...couponForm, customerId: e.target.value })}
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-200"
            >
              <option value="">Público Geral (Todos os clientes)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phone})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Início (Opcional)"
              type="datetime-local"
              value={couponForm.startDate}
              onChange={(e) => setCouponForm({ ...couponForm, startDate: e.target.value })}
            />
            <Input
              label="Fim (Opcional)"
              type="datetime-local"
              value={couponForm.endDate}
              onChange={(e) => setCouponForm({ ...couponForm, endDate: e.target.value })}
            />
          </div>

          {couponError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs font-bold text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{couponError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsCouponModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Salvar Cupom
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
