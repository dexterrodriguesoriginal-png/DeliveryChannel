import { PhonePreview } from '../../components/common/PhonePreview';
import { ArrivalQrMarketingCard } from '../../components/pickup/ArrivalQrMarketingCard';
import { useModules } from '../../hooks/useModules';
import { showPickupQrTab, type MarketingTab } from '../../lib/marketingTabs';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { initialPromoFulfillmentTypes, promoFulfillmentTypesForSave } from '../../utils/promoCardFulfillment';
import { useAuth } from '../../context/AuthContext';
import { supabase, ensureValidSession } from '../../lib/supabase';
import { offerRepository } from '../../repositories/offerRepository';
import { isN1N6Backend } from '../../lib/backendSchema';
import { productRepository } from '../../repositories/productRepository';
import { categoryRepository } from '../../repositories/categoryRepository';
import { promotionRepository } from '../../repositories/promotionRepository';
import { PromoPerformancePanel } from '../../components/marketing/PromoPerformancePanel';
import { CampaignsPanel } from '../../components/marketing/CampaignsPanel';
import { mediaRepository } from '../../repositories/mediaRepository';
import { QRCodeCard } from '../../components/common/QRCodeCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { 
  Offer, 
  Product, 
  Category,
  PromotionCarousel,
  PromotionCarouselItem,
  CardFormat, 
  CardMediaType, 
  CardDisplayMode,
  CardDestination,
  PromoCardModel
} from '../../types';
import { getPublicStoreUrl, isValidStoreSlug, getPublicStorePath } from '../../utils/publicStoreUrl';
import { 
  combineDateAndTimeToIso, 
  extractDateAndTimeFromIso, 
  formatPromoDateTimeBr, 
  calculatePromoCardStatus, 
  validatePromoSchedule, 
  getPromoStatusMeta,
  SAO_PAULO_TZ 
} from '../../utils/promoCardDateUtils';
import { 
  Sparkles, 
  QrCode, 
  MessageCircle, 
  Instagram,
  Plus,
  Play,
  Film,
  Image as ImageIcon,
  ChevronUp,
  ChevronDown,
  Edit3,
  Copy,
  Trash2,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Calendar,
  Layers,
  Tag,
  ArrowRight,
  Upload,
  Link as LinkIcon,
  RefreshCw,
  Info,
  Check,
  Sliders,
  CalendarDays,
  Lightbulb,
  Radio,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  DollarSign,
  BarChart3,
  Percent,
  Flame,
  EyeOff,
  CheckSquare,
  Square,
  Search,
  X,
  Filter
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { formatBRL } from '../../lib/pricing/money';

// ----------------------------------------------------------------------------
// MODELOS VISUAIS PROFISSIONAIS (1200 x 675 px — 16:9)
// ----------------------------------------------------------------------------
interface CardModelConfig {
  id: PromoCardModel;
  name: string;
  badge: string;
  recommendedWidth: number;
  recommendedHeight: number;
  aspectRatio: string;
  tagline: string;
  description: string;
  idealFor: string;
}

const PROMO_CARD_MODELS: CardModelConfig[] = [
  {
    id: 'HERO',
    name: 'MODELO 1 — HERO PROMOCIONAL',
    badge: 'DESTAQUE MÁXIMO',
    recommendedWidth: 1200,
    recommendedHeight: 675,
    aspectRatio: '16:9',
    tagline: '1200 × 675 px (16:9)',
    description: 'Design expansivo de alta conversão para o topo da vitrine com chamada principal.',
    idealFor: 'Lançamentos, combos da casa, avisos importantes e campanhas do fim de semana.',
  },
  {
    id: 'HIGHLIGHT',
    name: 'MODELO 2 — OFERTA COM DESTAQUE',
    badge: 'ALTA CONVERSÃO',
    recommendedWidth: 1200,
    recommendedHeight: 675,
    aspectRatio: '16:9',
    tagline: '1200 × 675 px (16:9)',
    description: 'Foco imediato no benefício financeiro, preço com desconto e botão direto de compra.',
    idealFor: 'Promoções de preço baixo, descontos agressivos, queima de estoque e kits.',
  },
  {
    id: 'ANIMATED',
    name: 'MODELO 3 — CARD VISUAL/ANIMADO',
    badge: 'MÍDIA PURA & VÍDEO',
    recommendedWidth: 1200,
    recommendedHeight: 675,
    aspectRatio: '16:9',
    tagline: '1200 × 675 px (16:9)',
    description: 'Otimizado para vídeos curtos ou artes finais de alta fidelidade sem interferências visuais.',
    idealFor: 'Vídeos promocionais gerados por IA, motion graphics e artes prontas de designers.',
  },
];

const DURATION_PRESETS = [3, 5, 7, 10, 15, 20, 30];

interface MarketingPageProps {
  activeTab?: MarketingTab | null;
  onTabChange?: (tab: MarketingTab) => void;
}

export const MarketingPage: React.FC<MarketingPageProps> = ({ activeTab: requestedTab, onTabChange }) => {
  const { activeTenant, securityContext, activeRole } = useAuth();
  const { showToast } = useToast();

  // N5: campanhas só OWNER/MANAGER (RLS; sem CEO/SUPER_ADMIN) e só com backend n1n6.
  const canManageCampaigns = isN1N6Backend() && (activeRole === 'OWNER' || activeRole === 'MANAGER');
  const canManage = activeRole === 'OWNER' || activeRole === 'MANAGER' || activeRole === 'SUPER_ADMIN' || activeRole === 'CEO';

  // Navegação interna da ferramenta
  const [internalActiveTab, setInternalActiveTab] = useState<MarketingTab>('creatives');
  const selectedTab = requestedTab === null ? 'creatives' : requestedTab ?? internalActiveTab;
  const activeTab = selectedTab === 'campaigns' && !canManageCampaigns ? 'creatives' : selectedTab;
  const changeActiveTab = (tab: MarketingTab) => {
    setInternalActiveTab(tab);
    onTabChange?.(tab);
  };
  const { isModuleEnabled } = useModules();
  const pickupQrTabVisible = showPickupQrTab(isModuleEnabled);
  useEffect(() => {
    if (requestedTab === undefined && internalActiveTab === 'pickup-qr' && !pickupQrTabVisible) {
      setInternalActiveTab('creatives');
    }
  }, [requestedTab, internalActiveTab, pickupQrTabVisible]);

  // Dados de Criativos e Produtos
  const [offers, setOffers] = useState<Offer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [promotionCarousels, setPromotionCarousels] = useState<PromotionCarousel[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal do Editor
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Offer | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 1. DESTINO DO CARD
  const [destinationType, setDestinationType] = useState<CardDestination>('BANNER_ONLY');
  const [selectedProductId, setSelectedProductId] = useState<string>('');

  // SELETOR AVANÇADO: PRODUTO DO CATÁLOGO / OFERTA EXISTENTE
  const [productLinkMode, setProductLinkMode] = useState<'CATALOG' | 'EXISTING_OFFER'>('CATALOG');
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [selectedProductCategory, setSelectedProductCategory] = useState('ALL');
  const [offerSearchTerm, setOfferSearchTerm] = useState('');
  const [offerStatusFilter, setOfferStatusFilter] = useState<'ALL' | 'ACTIVE'>('ACTIVE');
  const [isChangingProductSelection, setIsChangingProductSelection] = useState(false);
  const [isChangingOfferSelection, setIsChangingOfferSelection] = useState(false);
  const [selectedLinkedOfferMeta, setSelectedLinkedOfferMeta] = useState<{
    carouselName: string;
    originalPrice: number;
    promotionalPrice: number;
    discountPercentage: number;
    startDate?: string;
    endDate?: string;
  } | null>(null);
  const [isCustomPromoUnit, setIsCustomPromoUnit] = useState(false);

  // 2. MODELO E SOBREPOSIÇÕES
  const [cardModel, setCardModel] = useState<PromoCardModel>('HERO');
  const [autoOverlay, setAutoOverlay] = useState<boolean>(false);
  const [displayMode, setDisplayMode] = useState<CardDisplayMode>('FULL_MEDIA');

  // 3. MÍDIA
  const [mediaType, setMediaType] = useState<CardMediaType>('IMAGE');
  const [mediaSourceMode, setMediaSourceMode] = useState<'upload' | 'url'>('upload');
  const [mediaUrl, setMediaUrl] = useState('');
  const [pendingMarketingAsset, setPendingMarketingAsset] = useState<{ assetId: string; path: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [detectedWidth, setDetectedWidth] = useState<number | null>(null);
  const [detectedHeight, setDetectedHeight] = useState<number | null>(null);
  const [detectedVideoDuration, setDetectedVideoDuration] = useState<number | null>(null);

  // 4. TEMPO DE ROTAÇÃO
  const [durationSeconds, setDurationSeconds] = useState<number>(5);
  const [isCustomDuration, setIsCustomDuration] = useState<boolean>(false);
  const [customDurationInput, setCustomDurationInput] = useState<string>('5');

  // 5. CAMPOS BÁSICOS DO CARD
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [badge, setBadge] = useState('SUPER OFERTA');
  const [backgroundColor, setBackgroundColor] = useState('#15803d');
  const [accentColor, setAccentColor] = useState('#4ade80');
  const [isActive, setIsActive] = useState(true);

  // 6. SEÇÃO: CHECKOUT DA PROMOÇÃO (MODO 3)
  const [hasPromoCheckout, setHasPromoCheckout] = useState(false);
  const [promoTitle, setPromoTitle] = useState('');
  const [promoDescription, setPromoDescription] = useState('');
  const [promoOriginalPrice, setPromoOriginalPrice] = useState('');
  const [promoPrice, setPromoPrice] = useState('');
  const [promoDiscountPercentage, setPromoDiscountPercentage] = useState('');
  const [promoUnit, setPromoUnit] = useState('un');
  const [promoMinQuantity, setPromoMinQuantity] = useState('1');
  const [promoMaxQuantityPerCustomer, setPromoMaxQuantityPerCustomer] = useState('10');
  const [promoNotes, setPromoNotes] = useState('');
  const [promoFulfillmentTypes, setPromoFulfillmentTypes] = useState<('DELIVERY' | 'PICKUP')[]>(['DELIVERY', 'PICKUP']);
  const [promoPaymentMethods, setPromoPaymentMethods] = useState<('PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'CASH')[]>([
    'PIX',
    'CREDIT_CARD',
    'DEBIT_CARD',
    'CASH',
  ]);
  const [promoCouponCode, setPromoCouponCode] = useState('');
  const [promoUsageLimit, setPromoUsageLimit] = useState('');

  // 7. AGENDAMENTO COMPLETO (DATA + HORÁRIO)
  const [startDateInput, setStartDateInput] = useState('');
  const [startTimeInput, setStartTimeInput] = useState('07:00');
  const [endDateInput, setEndDateInput] = useState('');
  const [endTimeInput, setEndTimeInput] = useState('23:59');
  const [noEndDate, setNoEndDate] = useState(false);

  // Modal de Preview
  const [previewingCard, setPreviewingCard] = useState<Offer | null>(null);

  // Estados da Pré-visualização Interativa no Editor (Formulário à Esquerda / Prévia à Direita)
  const [editorPreviewTab, setEditorPreviewTab] = useState<'isolated' | 'carousel' | 'action' | 'phone'>('isolated');
  const [simulatedProgress, setSimulatedProgress] = useState(0);

  // Efeito da Barra de Progresso Simulada para Modo Carrossel na Prévia
  useEffect(() => {
    if (!isEditorOpen || editorPreviewTab !== 'carousel') {
      setSimulatedProgress(0);
      return;
    }
    const currentDurSec = mediaType === 'VIDEO'
      ? (detectedVideoDuration || 10)
      : (isCustomDuration ? Math.max(1, parseInt(customDurationInput, 10) || 5) : durationSeconds);
    const intervalMs = 50;
    const step = (intervalMs / (currentDurSec * 1000)) * 100;
    const timer = setInterval(() => {
      setSimulatedProgress(prev => (prev >= 100 ? 0 : prev + step));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isEditorOpen, editorPreviewTab, durationSeconds, detectedVideoDuration, mediaType, isCustomDuration, customDurationInput]);

  // --------------------------------------------------------------------------
  // CARREGAR DADOS
  // --------------------------------------------------------------------------
  const loadData = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    try {
      const [offersData, prodsData, catsData, carouselsData] = await Promise.all([
        offerRepository.getOffers(securityContext, activeTenant.id),
        productRepository.getProducts(securityContext, activeTenant.id),
        categoryRepository.getCategories(securityContext, activeTenant.id).catch(() => []),
        promotionRepository.getCarousels(securityContext, activeTenant.id).catch(() => []),
      ]);
      setOffers(offersData);
      setProducts(prodsData);
      setCategories(catsData);
      setPromotionCarousels(carouselsData);
    } catch (err) {
      console.error('[MarketingPage] Erro ao carregar dados:', err);
      showToast({
        type: 'error',
        title: 'Erro de Carregamento',
        message: err instanceof Error ? err.message : 'Não foi possível carregar os criativos promocionais.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [activeTenant?.id, securityContext, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Contagem de Cards Ativos no momento presente
  const activeCount = useMemo(() => {
    return offers.filter(o => calculatePromoCardStatus(o) === 'ACTIVE').length;
  }, [offers]);

  // Lista unificada de Ofertas cadastradas em Promoções e Cupons
  const availableOffers = useMemo(() => {
    const list: Array<{
      id: string;
      carouselId: string;
      carouselName: string;
      productId: string;
      productName: string;
      productImage?: string;
      categoryName?: string;
      originalPrice: number;
      promotionalPrice: number;
      discountPercentage: number;
      discountType: string;
      startDate?: string;
      endDate?: string;
      isActive: boolean;
      unit: string;
    }> = [];

    promotionCarousels.forEach(carousel => {
      (carousel.items || []).forEach(item => {
        const prod = item.product || products.find(p => p.id === item.productId);
        if (!prod) return;
        const cat = categories.find(c => c.id === prod.categoryId);
        const origPrice = Number(prod.price || 0);
        const promoPrice = Number(item.promotionalPrice || 0);
        const discountPct = item.calculatedDiscountPercentage 
          ? item.calculatedDiscountPercentage 
          : (origPrice > promoPrice && origPrice > 0 ? Math.round(((origPrice - promoPrice) / origPrice) * 100) : 0);

        list.push({
          id: item.id,
          carouselId: carousel.id,
          carouselName: carousel.name,
          productId: item.productId,
          productName: prod.name,
          productImage: prod.imageUrl,
          categoryName: cat?.name,
          originalPrice: origPrice,
          promotionalPrice: promoPrice,
          discountPercentage: discountPct,
          discountType: item.discountType,
          startDate: item.startDate,
          endDate: item.endDate,
          isActive: Boolean(item.isActive && carousel.isActive),
          unit: prod.unit || 'un',
        });
      });
    });

    return list;
  }, [promotionCarousels, products, categories]);

  // Filtro de ofertas de Promoções e Cupons
  const filteredOffers = useMemo(() => {
    return availableOffers.filter(offer => {
      if (offerStatusFilter === 'ACTIVE' && !offer.isActive) return false;
      if (offerSearchTerm.trim()) {
        const q = offerSearchTerm.toLowerCase();
        const matchName = offer.productName.toLowerCase().includes(q);
        const matchCar = offer.carouselName.toLowerCase().includes(q);
        const matchCat = offer.categoryName?.toLowerCase().includes(q);
        if (!matchName && !matchCar && !matchCat) return false;
      }
      return true;
    });
  }, [availableOffers, offerStatusFilter, offerSearchTerm]);

  // Filtro avançado de produtos do catálogo (Multi-tenant real do estabelecimento)
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (selectedProductCategory !== 'ALL' && p.categoryId !== selectedProductCategory) {
        return false;
      }
      if (productSearchTerm.trim()) {
        const q = productSearchTerm.toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchDesc = p.description?.toLowerCase().includes(q);
        const cat = categories.find(c => c.id === p.categoryId);
        const matchCat = cat?.name.toLowerCase().includes(q);
        if (!matchName && !matchDesc && !matchCat) return false;
      }
      return true;
    });
  }, [products, selectedProductCategory, productSearchTerm, categories]);

  // Modelo Selecionado
  const currentModelConfig = useMemo(() => {
    return PROMO_CARD_MODELS.find(m => m.id === cardModel) || PROMO_CARD_MODELS[0];
  }, [cardModel]);

  // Timestamps Calculados no Fuso America/Sao_Paulo
  const computedStartIso = useMemo(() => {
    return combineDateAndTimeToIso(startDateInput, startTimeInput);
  }, [startDateInput, startTimeInput]);

  const computedEndIso = useMemo(() => {
    if (noEndDate) return null;
    return combineDateAndTimeToIso(endDateInput, endTimeInput);
  }, [endDateInput, endTimeInput, noEndDate]);

  // Status Computado em Tempo Real para o Formulário
  const computedFormStatus = useMemo(() => {
    return calculatePromoCardStatus({
      isActive,
      startAt: computedStartIso,
      endAt: computedEndIso,
    });
  }, [isActive, computedStartIso, computedEndIso]);

  const formStatusMeta = useMemo(() => {
    return getPromoStatusMeta(computedFormStatus);
  }, [computedFormStatus]);

  // --------------------------------------------------------------------------
  // INSPEÇÃO DE MÍDIA (DIMENSÕES E DURAÇÃO DE VÍDEO)
  // --------------------------------------------------------------------------
  const inspectMedia = (url: string, type: CardMediaType) => {
    if (!url) return;
    if (type === 'VIDEO') {
      const vid = document.createElement('video');
      vid.preload = 'metadata';
      vid.onloadedmetadata = () => {
        setDetectedWidth(vid.videoWidth || 1200);
        setDetectedHeight(vid.videoHeight || 675);
        if (vid.duration && !isNaN(vid.duration)) {
          const roundedSec = Math.round(vid.duration * 10) / 10;
          setDetectedVideoDuration(roundedSec);
          setDurationSeconds(roundedSec);
        }
      };
      vid.src = url;
    } else {
      const img = new Image();
      img.onload = () => {
        setDetectedWidth(img.naturalWidth || 1200);
        setDetectedHeight(img.naturalHeight || 675);
      };
      img.src = url;
      setDetectedVideoDuration(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTenant?.id) return;

    const isVideoFile = file.type.startsWith('video/');
    const isImageFile = file.type.startsWith('image/');

    if (!isVideoFile && !isImageFile) {
      showToast({
        type: 'error',
        title: 'Formato Não Suportado',
        message: 'Envie um arquivo de imagem (JPG, PNG, WEBP) ou vídeo (MP4, WEBM).',
      });
      return;
    }

    // Limites alinhados ao bucket `marketing` (migration 023: file_size_limit = 35 MB).
    const maxSize = isVideoFile ? 35 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast({
        type: 'error',
        title: 'Arquivo Muito Grande',
        message: `Tamanho máximo: ${isVideoFile ? '35MB para vídeo' : '10MB para imagem'}.`,
      });
      return;
    }

    setIsUploading(true);
    try {
      const detectedType: CardMediaType = isVideoFile ? 'VIDEO' : 'IMAGE';
      const localPreviewUrl = URL.createObjectURL(file);

      // Pré-detecta dimensões e duração antes do upload para alimentar confirm_marketing_upload (N3)
      let preWidth: number | null = null;
      let preHeight: number | null = null;
      let preDuration: number | null = null;

      try {
        if (isVideoFile) {
          const meta = await new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
            const vid = document.createElement('video');
            vid.preload = 'metadata';
            vid.onloadedmetadata = () => {
              resolve({
                width: vid.videoWidth || 1200,
                height: vid.videoHeight || 675,
                duration: vid.duration && !isNaN(vid.duration) ? Math.round(vid.duration * 10) / 10 : 10,
              });
            };
            vid.onerror = () => reject(new Error('Erro ao inspecionar metadados do vídeo.'));
            vid.src = localPreviewUrl;
          });
          preWidth = meta.width;
          preHeight = meta.height;
          preDuration = meta.duration;
          setDetectedWidth(meta.width);
          setDetectedHeight(meta.height);
          setDetectedVideoDuration(meta.duration);
          setDurationSeconds(meta.duration);
        } else {
          const meta = await new Promise<{ width: number; height: number }>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              resolve({
                width: img.naturalWidth || 1200,
                height: img.naturalHeight || 675,
              });
            };
            img.onerror = () => reject(new Error('Erro ao inspecionar dimensões da imagem.'));
            img.src = localPreviewUrl;
          });
          preWidth = meta.width;
          preHeight = meta.height;
          setDetectedWidth(meta.width);
          setDetectedHeight(meta.height);
          setDetectedVideoDuration(null);
        }
      } catch (metaErr) {
        console.warn('[MarketingPage] Não foi possível inspecionar dimensões prévias, usando valores padrão:', metaErr);
      }

      const uploadResult = await offerRepository.uploadMedia(
        activeTenant.id,
        editingCard?.id || crypto.randomUUID(),
        file,
        {
          width: preWidth,
          height: preHeight,
          duration: preDuration,
        }
      );

      // Define a URL local imediatamente para renderização no visualizador em tempo real (16:9).
      // Se não houver assetId (ex: modo local), utiliza o caminho retornado ou preview local.
      setMediaUrl(localPreviewUrl || uploadResult.path);
      if (uploadResult.assetId) {
        setPendingMarketingAsset({
          assetId: uploadResult.assetId,
          path: uploadResult.path,
        });
      } else {
        setPendingMarketingAsset(null);
      }
      setMediaType(detectedType);
      inspectMedia(localPreviewUrl, detectedType);

      showToast({
        type: 'success',
        title: 'Upload Realizado com Sucesso',
        message: `Mídia carregada (${detectedType === 'VIDEO' ? 'Vídeo' : 'Imagem'}).`,
      });
    } catch (err: any) {
      console.error('[MarketingPage] Erro no upload:', err);
      showToast({
        type: 'error',
        title: 'Falha no Upload',
        message: err.message || 'Não foi possível carregar o arquivo.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  // --------------------------------------------------------------------------
  // ABERTURA DO EDITOR
  // --------------------------------------------------------------------------
  const handleOpenCreate = () => {
    setEditingCard(null);
    setPendingMarketingAsset(null);
    setCardModel('HERO');
    setAutoOverlay(false);
    setDisplayMode('FULL_MEDIA');
    setDestinationType('BANNER_ONLY');
    setSelectedProductId('');
    setProductLinkMode('CATALOG');
    setProductSearchTerm('');
    setSelectedProductCategory('ALL');
    setOfferSearchTerm('');
    setOfferStatusFilter('ACTIVE');
    setIsChangingProductSelection(false);
    setIsChangingOfferSelection(false);
    setSelectedLinkedOfferMeta(null);
    setIsCustomPromoUnit(false);
    
    // Mídia Padrão
    setMediaType('IMAGE');
    setMediaSourceMode('upload');
    const defaultUrl = 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&auto=format&fit=crop&q=80';
    setMediaUrl(defaultUrl);
    inspectMedia(defaultUrl, 'IMAGE');

    // Identificação Interna e Rotação
    setTitle(`Card Promocional #${offers.length + 1}`);
    setSubtitle('');
    setBadge('');
    setDurationSeconds(5);
    setIsCustomDuration(false);
    setCustomDurationInput('5');

    // Checkout Promocional
    setHasPromoCheckout(false);
    setPromoTitle('Oferta Especial da Casa');
    setPromoDescription('Promoção exclusiva de alta qualidade preparada pelo estabelecimento.');
    setPromoOriginalPrice('49.90');
    setPromoPrice('39.90');
    setPromoDiscountPercentage('20');
    setPromoUnit('un');
    setPromoMinQuantity('1');
    setPromoMaxQuantityPerCustomer('10');
    setPromoNotes('Disponível para consumo imediato ou entrega');
    setPromoFulfillmentTypes(['DELIVERY', 'PICKUP']);
    setPromoPaymentMethods(['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH']);
    setPromoCouponCode('');
    setPromoUsageLimit('');

    // Agendamento: Hoje 07:00 às 23:59
    const nowExt = extractDateAndTimeFromIso(new Date().toISOString());
    setStartDateInput(nowExt.date);
    setStartTimeInput('07:00');
    setEndDateInput(nowExt.date);
    setEndTimeInput('23:59');
    setNoEndDate(false);

    setBackgroundColor(activeTenant?.theme?.primaryColor || '#15803d');
    setAccentColor('#4ade80');
    setIsActive(true);
    setIsEditorOpen(true);
  };

  const handleOpenEdit = (card: Offer) => {
    setEditingCard(card);
    setPendingMarketingAsset(null);
    setCardModel('HERO');
    setAutoOverlay(false);
    setDisplayMode('FULL_MEDIA');
    
    // Destino
    const dest = card.destinationType || (card.hasPromoCheckout ? 'CUSTOM_OFFER' : card.productId ? 'PRODUCT' : 'BANNER_ONLY');
    setDestinationType(dest);
    setSelectedProductId(card.productId || '');
    setProductSearchTerm('');
    setSelectedProductCategory('ALL');
    setOfferSearchTerm('');
    setOfferStatusFilter('ACTIVE');
    setIsChangingProductSelection(false);
    setIsChangingOfferSelection(false);

    // Identifica se havia oferta vinculada preservada
    const linkedOffer = card.productId ? availableOffers.find(o => o.productId === card.productId) : null;
    if (linkedOffer && (card.promotionalPrice || card.discountPercentage)) {
      setProductLinkMode('EXISTING_OFFER');
      setSelectedLinkedOfferMeta({
        carouselName: linkedOffer.carouselName,
        originalPrice: linkedOffer.originalPrice,
        promotionalPrice: linkedOffer.promotionalPrice,
        discountPercentage: linkedOffer.discountPercentage,
        startDate: linkedOffer.startDate,
        endDate: linkedOffer.endDate,
      });
    } else {
      setProductLinkMode('CATALOG');
      setSelectedLinkedOfferMeta(null);
    }

    const currentUnit = card.promoUnit || 'un';
    const isStandardUnit = ['un', 'kit', 'cesta', 'combo', 'serviço', 'kg', 'g'].includes(currentUnit);
    setIsCustomPromoUnit(!isStandardUnit);

    // Mídia
    setMediaType(card.mediaType || 'IMAGE');
    setMediaSourceMode('upload');
    const sourceUrl = card.mediaUrl || card.imageUrl || '';
    setMediaUrl(sourceUrl);
    inspectMedia(sourceUrl, card.mediaType || 'IMAGE');

    // Rotação
    const dur = card.durationSeconds || 5;
    setDurationSeconds(dur);
    setCustomDurationInput(String(dur));
    setIsCustomDuration(!DURATION_PRESETS.includes(dur));

    // Identificação Interna
    setTitle(card.title || `Card Promocional #${offers.indexOf(card) + 1}`);
    setSubtitle('');
    setBadge('');

    // Checkout Promocional
    setHasPromoCheckout(Boolean(card.hasPromoCheckout || dest === 'CUSTOM_OFFER'));
    setPromoTitle(card.promoTitle || card.title || '');
    setPromoDescription(card.promoDescription || card.description || '');
    setPromoOriginalPrice(card.promoOriginalPrice ? card.promoOriginalPrice.toString() : (card.originalPrice ? card.originalPrice.toString() : ''));
    setPromoPrice(card.promoPrice ? card.promoPrice.toString() : (card.promotionalPrice ? card.promotionalPrice.toString() : ''));
    setPromoDiscountPercentage(card.promoDiscountPercentage ? card.promoDiscountPercentage.toString() : (card.discountPercentage ? card.discountPercentage.toString() : ''));
    setPromoUnit(card.promoUnit || 'un');
    setPromoMinQuantity(card.promoMinQuantity ? card.promoMinQuantity.toString() : '1');
    setPromoMaxQuantityPerCustomer(card.promoMaxQuantityPerCustomer ? card.promoMaxQuantityPerCustomer.toString() : '10');
    setPromoNotes(card.promoNotes || '');
    setPromoFulfillmentTypes(initialPromoFulfillmentTypes(card));
    setPromoPaymentMethods(card.promoPaymentMethods || ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH']);
    setPromoCouponCode(card.promoCouponCode || '');
    setPromoUsageLimit(card.promoUsageLimit ? card.promoUsageLimit.toString() : '');

    // Agendamento
    const startIso = card.startAt || card.startDate;
    const endIso = card.endAt || card.endDate;
    if (startIso) {
      const s = extractDateAndTimeFromIso(startIso);
      setStartDateInput(s.date);
      setStartTimeInput(s.time || '07:00');
    } else {
      const nowExt = extractDateAndTimeFromIso(new Date().toISOString());
      setStartDateInput(nowExt.date);
      setStartTimeInput('07:00');
    }

    if (endIso) {
      const e = extractDateAndTimeFromIso(endIso);
      setEndDateInput(e.date);
      setEndTimeInput(e.time || '23:59');
      setNoEndDate(false);
    } else {
      setEndDateInput('');
      setEndTimeInput('23:59');
      setNoEndDate(true);
    }

    setBackgroundColor(card.backgroundColor || activeTenant?.theme?.primaryColor || '#15803d');
    setAccentColor(card.accentColor || '#4ade80');
    setIsActive(card.isActive);
    setIsEditorOpen(true);
  };

  // Cálculo Automático de Desconto na Promoção
  const handlePromoPriceChange = (origStr: string, promoStr: string) => {
    setPromoOriginalPrice(origStr);
    setPromoPrice(promoStr);
    const numOrig = parseFloat(origStr);
    const numPromo = parseFloat(promoStr);
    if (numOrig > 0 && numPromo > 0 && numOrig > numPromo) {
      const pct = Math.round(((numOrig - numPromo) / numOrig) * 100);
      setPromoDiscountPercentage(pct.toString());
    } else {
      setPromoDiscountPercentage('');
    }
  };

  // --------------------------------------------------------------------------
  // SALVAR / PUBLICAR CARD
  // --------------------------------------------------------------------------
  const handleSaveCard = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      showToast({
        type: 'error',
        title: 'Título Obrigatório',
        message: 'Informe um nome ou título para identificar sua promoção.',
      });
      return;
    }

    if (!mediaUrl.trim()) {
      showToast({
        type: 'error',
        title: 'Mídia Obrigatória',
        message: 'Envie uma imagem/vídeo ou informe a URL do criativo.',
      });
      return;
    }

    // Validação de Agendamento
    const scheduleValidation = validatePromoSchedule(computedStartIso, computedEndIso, noEndDate);
    if (!scheduleValidation.isValid) {
      showToast({
        type: 'error',
        title: 'Agendamento Inválido',
        message: scheduleValidation.errorMessage || 'Verifique as datas e horários de exibição.',
      });
      return;
    }

    // Validação específica para CHECKOUT PROMOCIONAL (Modo 3)
    if (destinationType === 'CUSTOM_OFFER') {
      if (isN1N6Backend() && !selectedProductId) {
        showToast({
          type: 'error',
          title: 'Produto Obrigatório',
          message: 'O checkout promocional precisa de um produto do catálogo vinculado.',
        });
        return;
      }
      const priceNum = parseFloat(promoPrice);
      if (isNaN(priceNum) || priceNum <= 0) {
        showToast({
          type: 'error',
          title: 'Preço Inválido',
          message: 'No Checkout Promocional, informe um Preço Promocional válido maior que zero.',
        });
        return;
      }
      if (!promoTitle.trim()) {
        showToast({
          type: 'error',
          title: 'Título da Promoção Obrigatório',
          message: 'Informe o título que o cliente visualizará no checkout.',
        });
        return;
      }
      if (promoPaymentMethods.length === 0) {
        showToast({
          type: 'error',
          title: 'Pagamento Obrigatório',
          message: 'Selecione pelo menos uma forma de pagamento permitida.',
        });
        return;
      }
    }

    // Validação de Produto do Catálogo (Modo 2)
    if (destinationType === 'PRODUCT' && !selectedProductId) {
      showToast({
        type: 'error',
        title: 'Produto Não Selecionado',
        message: 'Selecione o produto do catálogo que será aberto ao clicar no card.',
      });
      return;
    }

    setIsSaving(true);
    try {
      // Fluxo Oficial de Publicação N3: executa somente quando há novo asset pendente de publicação
      let finalPublicMediaUrl = mediaUrl.trim();
      let publishedAssetId: string | undefined;

      if (pendingMarketingAsset?.assetId) {
        const { assetId } = pendingMarketingAsset;

        // 1. Chamar request_publish_marketing_asset({ p_asset_id: assetId })
        const { data: pubReqData, error: pubReqErr } = await supabase.rpc('request_publish_marketing_asset', {
          p_asset_id: assetId,
        });

        if (pubReqErr || !pubReqData) {
          throw new Error(`Falha ao solicitar publicação do asset: ${pubReqErr?.message || 'Resposta inválida do servidor.'}`);
        }

        const reqRow = Array.isArray(pubReqData) ? pubReqData[0] : pubReqData;
        const sourceBucket = reqRow?.source_bucket;
        const sourcePath = reqRow?.source_path;
        const targetBucket = reqRow?.target_bucket;
        const targetPath = reqRow?.target_path;

        if (!sourceBucket || !sourcePath || !targetBucket || !targetPath) {
          throw new Error('request_publish_marketing_asset não retornou os campos obrigatórios (source_bucket, source_path, target_bucket, target_path).');
        }

        // 2. Copiar o objeto de source_bucket/source_path para target_bucket/target_path
        await ensureValidSession();
        let copyErrResult = (
          await supabase.storage
            .from(sourceBucket)
            .copy(sourcePath, targetPath, { destinationBucket: targetBucket })
        ).error;

        if (copyErrResult && /exp claim|jwt|expired|token/i.test(copyErrResult.message || '')) {
          console.warn('[MarketingPage] Token expirado na cópia para publicação, renovando sessão e tentando novamente...');
          const { error: refreshErr } = await supabase.auth.refreshSession();
          if (!refreshErr) {
            copyErrResult = (
              await supabase.storage
                .from(sourceBucket)
                .copy(sourcePath, targetPath, { destinationBucket: targetBucket })
            ).error;
          }
        }

        if (copyErrResult) {
          throw new Error(`Falha ao copiar mídia para o bucket de publicação: ${copyErrResult.message}`);
        }

        // 3. Somente se a cópia for concluída com sucesso chamar confirm_publish_marketing_asset({ p_asset_id: assetId })
        const { data: pubConfirmData, error: pubConfirmErr } = await supabase.rpc('confirm_publish_marketing_asset', {
          p_asset_id: assetId,
        });

        if (pubConfirmErr || !pubConfirmData) {
          throw new Error(`Falha ao confirmar publicação do asset: ${pubConfirmErr?.message || 'Resposta inválida na confirmação.'}`);
        }

        const confirmRow = Array.isArray(pubConfirmData) ? pubConfirmData[0] : pubConfirmData;
        const publicPath = typeof pubConfirmData === 'string'
          ? pubConfirmData
          : (confirmRow?.public_path || confirmRow?.publicPath || confirmRow?.public_url || confirmRow?.publicUrl);

        if (!publicPath || typeof publicPath !== 'string') {
          throw new Error('confirm_publish_marketing_asset não retornou public_path válido.');
        }

        // Obtém a URL pública definitiva a partir do bucket marketing-public e do public_path retornado
        let resolvedPublicUrl = '';
        if (publicPath.startsWith('http://') || publicPath.startsWith('https://')) {
          resolvedPublicUrl = publicPath;
        } else {
          const { data: publicUrlObj } = supabase.storage
            .from('marketing-public')
            .getPublicUrl(publicPath);

          if (!publicUrlObj?.publicUrl) {
            throw new Error('Não foi possível gerar a URL pública para o asset no bucket marketing-public.');
          }
          resolvedPublicUrl = publicUrlObj.publicUrl;
        }

        // 4. Usar a URL pública definitiva no estado da aplicação e para persistência em image_url
        finalPublicMediaUrl = resolvedPublicUrl;

        // Marca que o asset foi publicado com sucesso
        publishedAssetId = assetId;
        setPendingMarketingAsset(null);
        setMediaUrl(finalPublicMediaUrl);
      }

      const finalDuration = mediaType === 'VIDEO'
        ? (detectedVideoDuration || 10)
        : (isCustomDuration ? Math.max(1, parseInt(customDurationInput, 10) || 5) : durationSeconds);

      const parsedPromoPrice = promoPrice ? parseFloat(promoPrice) : undefined;
      const parsedPromoOrigPrice = promoOriginalPrice ? parseFloat(promoOriginalPrice) : undefined;
      const parsedDiscountPct = promoDiscountPercentage ? parseInt(promoDiscountPercentage, 10) : undefined;
      const parsedUsageLimit = promoUsageLimit ? parseInt(promoUsageLimit, 10) : undefined;

      const payload: Omit<Offer, 'id' | 'tenantId' | 'createdAt'> = {
        title: title.trim() || 'Card Promocional',
        subtitle: undefined,
        description: (destinationType === 'CUSTOM_OFFER' ? promoDescription : '') || '',
        badge: undefined,
        cardFormat: 'HORIZONTAL',
        mediaType,
        displayMode: 'FULL_MEDIA',
        cardModel: 'HERO',
        autoOverlay: false,
        destinationType,
        mediaUrl: finalPublicMediaUrl,
        imageUrl: finalPublicMediaUrl,
        durationSeconds: finalDuration,
        videoDuration: mediaType === 'VIDEO' ? (detectedVideoDuration || 10) : undefined,
        detectedWidth: detectedWidth || 1200,
        detectedHeight: detectedHeight || 675,
        aspectRatio: '16:9',
        // N4 (n1n6): o checkout promocional exige product_id; em legacy CUSTOM_OFFER segue sem produto.
        productId: destinationType === 'PRODUCT' || (destinationType === 'CUSTOM_OFFER' && isN1N6Backend() && selectedProductId)
          ? selectedProductId
          : undefined,
        mediaAssetId: isN1N6Backend() ? (publishedAssetId || editingCard?.mediaAssetId || undefined) : undefined,
        internalLink: destinationType === 'PRODUCT' && selectedProductId && activeTenant?.slug
          ? `${getPublicStorePath(activeTenant.slug)}?product=${selectedProductId}`
          : undefined,

        // Campos do Checkout Promocional Próprio
        hasPromoCheckout: destinationType === 'CUSTOM_OFFER',
        promoTitle: destinationType === 'CUSTOM_OFFER' ? promoTitle.trim() : undefined,
        promoDescription: destinationType === 'CUSTOM_OFFER' ? promoDescription.trim() : undefined,
        promoPrice: destinationType === 'CUSTOM_OFFER' ? parsedPromoPrice : undefined,
        promoOriginalPrice: destinationType === 'CUSTOM_OFFER' ? parsedPromoOrigPrice : undefined,
        promoDiscountPercentage: destinationType === 'CUSTOM_OFFER' ? parsedDiscountPct : undefined,
        promoUnit: destinationType === 'CUSTOM_OFFER' ? promoUnit : 'un',
        promoMinQuantity: destinationType === 'CUSTOM_OFFER' ? (parseInt(promoMinQuantity, 10) || 1) : 1,
        promoMaxQuantityPerCustomer: destinationType === 'CUSTOM_OFFER' ? (parseInt(promoMaxQuantityPerCustomer, 10) || 10) : 10,
        promoNotes: destinationType === 'CUSTOM_OFFER' ? promoNotes.trim() : undefined,
        // Compat: preserva o valor gravado no card (ou ambos para cards novos); a escolha real ocorre no checkout.
        promoFulfillmentTypes: promoFulfillmentTypesForSave(destinationType, promoFulfillmentTypes, editingCard),
        promoPaymentMethods: destinationType === 'CUSTOM_OFFER' ? promoPaymentMethods : ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'],
        promoCouponCode: destinationType === 'CUSTOM_OFFER' && promoCouponCode ? promoCouponCode.trim().toUpperCase() : undefined,
        promoUsageLimit: destinationType === 'CUSTOM_OFFER' ? parsedUsageLimit : undefined,
        promoTimesUsed: editingCard?.promoTimesUsed || 0,

        // Compatibilidade de Preço
        promotionalPrice: destinationType === 'CUSTOM_OFFER' 
          ? parsedPromoPrice 
          : (destinationType === 'PRODUCT' && selectedLinkedOfferMeta ? selectedLinkedOfferMeta.promotionalPrice : undefined),
        originalPrice: destinationType === 'CUSTOM_OFFER' 
          ? parsedPromoOrigPrice 
          : (destinationType === 'PRODUCT' && selectedLinkedOfferMeta ? selectedLinkedOfferMeta.originalPrice : undefined),
        discountPercentage: destinationType === 'CUSTOM_OFFER' 
          ? parsedDiscountPct 
          : (destinationType === 'PRODUCT' && selectedLinkedOfferMeta ? selectedLinkedOfferMeta.discountPercentage : undefined),

        // Agendamento
        startDate: computedStartIso || undefined,
        endDate: noEndDate ? undefined : (computedEndIso || undefined),
        startAt: computedStartIso || undefined,
        endAt: noEndDate ? undefined : (computedEndIso || undefined),
        noEndDate,

        backgroundColor,
        accentColor,
        isActive,
        order: editingCard ? editingCard.order : (offers.length + 1),
      };

      if (editingCard) {
        const updated = await offerRepository.update(securityContext, activeTenant!.id, editingCard.id, payload);
        setOffers(prev => prev.map(o => o.id === updated.id ? updated : o));
        
        if (computedFormStatus === 'SCHEDULED') {
          showToast({
            type: 'info',
            title: 'Card agendado com sucesso',
            message: `Este card ficará visível na vitrine a partir de ${formatPromoDateTimeBr(computedStartIso)}.`,
          });
        } else {
          showToast({
            type: 'success',
            title: 'Card Atualizado',
            message: `Campanha "${payload.title}" atualizada com sucesso.`,
          });
        }
      } else {
        const created = await offerRepository.create(securityContext, activeTenant!.id, payload);
        setOffers(prev => [...prev, created]);

        if (computedFormStatus === 'SCHEDULED') {
          showToast({
            type: 'info',
            title: 'Card agendado com sucesso',
            message: `Este card ficará visível na vitrine a partir de ${formatPromoDateTimeBr(computedStartIso)}.`,
          });
        } else {
          showToast({
            type: 'success',
            title: 'Card publicado e ativo na vitrine',
            message: `O card já está visível para seus clientes.`,
          });
        }
      }

      setIsEditorOpen(false);
    } catch (err: any) {
      console.error('[MarketingPage] Erro ao salvar card:', err);
      showToast({
        type: 'error',
        title: 'Erro ao Salvar',
        message: err.message || 'Falha ao persistir criativo promocional.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // --------------------------------------------------------------------------
  // DUPLICAÇÃO DE CARD
  // --------------------------------------------------------------------------
  const handleDuplicateCard = async (card: Offer) => {
    if (!activeTenant?.id) return;
    try {
      const duplicated = await offerRepository.duplicate(securityContext, activeTenant.id, card.id);
      setOffers(prev => [...prev, duplicated]);
      showToast({
        type: 'success',
        title: 'Card Duplicado',
        message: `Uma cópia de "${card.title}" foi criada. Ajuste as datas e horários da nova campanha.`,
      });
      handleOpenEdit(duplicated);
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Duplicar',
        message: err.message || 'Não foi possível duplicar o card.',
      });
    }
  };

  // --------------------------------------------------------------------------
  // REORDENAÇÃO & STATUS
  // --------------------------------------------------------------------------
  const handleMoveOrder = async (index: number, direction: 'up' | 'down') => {
    if (!activeTenant?.id || !canManage) return;
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= offers.length) return;

    const newOffers = [...offers];
    const temp = newOffers[index];
    newOffers[index] = newOffers[targetIdx];
    newOffers[targetIdx] = temp;

    const previousOffers = offers;
    setOffers(newOffers);
    try {
      const persisted = await offerRepository.reorderOffers(
        securityContext,
        activeTenant.id,
        newOffers.map(o => o.id)
      );
      setOffers(persisted);
    } catch (err: any) {
      console.error('[MarketingPage] Erro ao reordenar:', err);
      // Ordem não foi salva no banco: volta para o estado real anterior.
      setOffers(previousOffers);
      showToast({
        type: 'error',
        title: 'Ordem Não Salva',
        message: err?.message || 'Não foi possível salvar a nova ordem dos cards.',
      });
    }
  };

  const handleToggleActive = async (card: Offer) => {
    if (!activeTenant?.id || !canManage) return;
    try {
      const newStatus = await offerRepository.toggleStatus(securityContext, activeTenant.id, card.id);
      setOffers(prev => prev.map(o => o.id === card.id ? { ...o, isActive: newStatus } : o));
      showToast({
        type: 'info',
        title: newStatus ? 'Card Ativado' : 'Card Pausado',
        message: `O card "${card.title}" foi ${newStatus ? 'ativado' : 'pausado'}.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro de Status',
        message: err.message || 'Não foi possível alterar o status.',
      });
    }
  };

  const handleDeleteCard = async (card: Offer) => {
    if (!activeTenant?.id || !canManage) return;
    if (!window.confirm(`Deseja realmente remover o card "${card.title}"?`)) return;

    try {
      await offerRepository.delete(securityContext, activeTenant.id, card.id);
      setOffers(prev => prev.filter(o => o.id !== card.id));
      showToast({
        type: 'success',
        title: 'Card Removido',
        message: `O card "${card.title}" foi excluído.`,
      });
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro ao Excluir',
        message: err.message || 'Não foi possível remover o card.',
      });
    }
  };

  /** N3 (n1n6): despublica a mídia do card (remove de marketing-public) e limpa a URL do card. */
  const handleUnpublishMedia = async (card: Offer) => {
    if (!activeTenant?.id || !canManage || !card.mediaAssetId) return;
    const reason = window.prompt('Motivo da despublicação da mídia (obrigatório):');
    if (!reason || !reason.trim()) return;
    try {
      await mediaRepository.unpublish(card.mediaAssetId, reason);
      const updated = await offerRepository.update(securityContext, activeTenant.id, card.id, {
        mediaUrl: '',
        imageUrl: '',
      });
      setOffers(prev => prev.map(o => (o.id === card.id ? updated : o)));
      showToast({ type: 'success', title: 'Mídia Despublicada', message: 'A mídia saiu da vitrine pública.' });
    } catch (err: any) {
      showToast({ type: 'error', title: 'Erro ao Despublicar', message: err.message || 'Não foi possível despublicar.' });
    }
  };

  if (!activeTenant) return null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Cabeçalho da ferramenta */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-emerald-600" />
            <span>Cards & Campanhas Promocionais</span>
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Gerencie criativos profissionais em 16:9, agendamentos automáticos e ofertas com checkout próprio.
          </p>
        </div>

        {canManage && activeTab === 'creatives' && (
          <Button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 shadow-sm font-bold text-xs cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Card Promocional</span>
          </Button>
        )}
      </div>

      {/* Tabs de Navegação */}
      <div className="flex items-center gap-2 border-b border-gray-200">
        <button
          onClick={() => changeActiveTab('creatives')}
          className={`pb-3 px-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'creatives'
              ? 'border-emerald-600 text-emerald-800'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Cards Promocionais</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
            {activeCount} ativos
          </span>
        </button>

        <button
          onClick={() => changeActiveTab('performance')}
          className={`pb-3 px-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'performance'
              ? 'border-emerald-600 text-emerald-800'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Desempenho & Vendas</span>
        </button>

        {canManageCampaigns && (
          <button
            data-testid="tab-campaigns"
            onClick={() => changeActiveTab('campaigns')}
            className={`pb-3 px-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'campaigns'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Flame className="w-4 h-4" />
            <span>Campanhas</span>
          </button>
        )}

        <button
          onClick={() => changeActiveTab('materials')}
          className={`pb-3 px-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'materials'
              ? 'border-emerald-600 text-emerald-800'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <QrCode className="w-4 h-4" />
          <span>Materiais & QR Code</span>
        </button>

        {pickupQrTabVisible && (
          <button
            onClick={() => changeActiveTab('pickup-qr')}
            data-testid="tab-pickup-qr"
            className={`pb-3 px-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'pickup-qr'
                ? 'border-emerald-600 text-emerald-800'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>QR Code de Retirada</span>
          </button>
        )}
      </div>

      {/* ==================================================================== */}
      {/* ABA 1: CRIATIVOS PROMOCIONAIS                                        */}
      {/* ==================================================================== */}
      {activeTab === 'creatives' && (
        <div className="space-y-6">
          {/* Banner de Apresentação das Novas Funções */}
          <div className="p-4 bg-linear-to-r from-emerald-50 via-teal-50 to-blue-50 border border-emerald-200/70 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-600 text-white shadow-2xs">
                  <Flame className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-extrabold text-gray-900">
                  Gerenciador Profissional: Visual Puro, Catálogo ou Checkout Promocional Próprio
                </h3>
              </div>
              <p className="text-xs text-gray-600 max-w-3xl leading-relaxed">
                Você pode criar cards com imagem ou vídeo em 16:9 (1200×675 px). Escolha entre <strong>Apenas Visual</strong> (sem overlays), <strong>Produto do Catálogo</strong> ou <strong>Checkout Promocional</strong> (oferta independente com preço, regras e limites sem precisar de produto cadastrado).
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-semibold text-emerald-800 bg-white/90 px-3 py-1.5 rounded-xl border border-emerald-200 shadow-2xs flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-600" />
                Agendamento Atômico Ativo
              </span>
            </div>
          </div>

          {/* Grid de Cards Existentes */}
          {isLoading ? (
            <div className="p-12 text-center text-gray-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
              <p className="text-xs">Carregando criativos promocionais...</p>
            </div>
          ) : offers.length === 0 ? (
            <Card className="p-12 text-center space-y-4 border-dashed border-2 border-gray-300">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
                <Sparkles className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-gray-900">Nenhum card promocional cadastrado</h4>
                <p className="text-xs text-gray-500 max-w-md mx-auto">
                  Crie seu primeiro criativo para a vitrine. Escolha entre banner visual, produto do catálogo ou checkout promocional próprio.
                </p>
              </div>
              {canManage && (
                <Button onClick={handleOpenCreate} className="mx-auto">
                  <Plus className="w-4 h-4 mr-1.5" />
                  Criar Primeiro Card Promocional
                </Button>
              )}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {offers.map((card, idx) => {
                const isVideo = card.mediaType === 'VIDEO';
                const status = calculatePromoCardStatus(card);
                const statusMeta = getPromoStatusMeta(status);
                const destType = card.destinationType || (card.hasPromoCheckout ? 'CUSTOM_OFFER' : card.productId ? 'PRODUCT' : 'BANNER_ONLY');

                return (
                  <Card key={card.id} className="overflow-hidden p-0 flex flex-col justify-between group border-gray-200 hover:shadow-md transition-shadow">
                    {/* Visualização de Mídia */}
                    <div 
                      className="relative h-44 w-full bg-gray-900 cursor-pointer overflow-hidden flex items-center justify-center"
                      onClick={() => setPreviewingCard(card)}
                    >
                      {isVideo && card.mediaUrl ? (
                        <video
                          src={card.mediaUrl}
                          muted
                          playsInline
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (card.imageUrl || card.mediaUrl) ? (
                        <img
                          src={card.imageUrl || card.mediaUrl}
                          alt={card.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="text-white/40 text-xs">Sem mídia</div>
                      )}

                      {/* Badges superiores na mídia */}
                      <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between z-10">
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md text-[10px] font-bold text-white flex items-center gap-1 border border-white/20">
                            {isVideo ? <Film className="w-3 h-3 text-amber-400" /> : <ImageIcon className="w-3 h-3 text-emerald-400" />}
                            <span>{isVideo ? 'Vídeo' : 'Imagem'}</span>
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md text-[10px] font-medium text-white/90 border border-white/20">
                            16:9
                          </span>
                        </div>

                        {/* Status Badge */}
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide border shadow-2xs ${statusMeta.badgeClass}`}>
                          {statusMeta.fullLabel}
                        </span>
                      </div>

                      {/* Badges inferiores na foto */}
                      <div className="absolute bottom-2.5 left-2.5 right-2.5 text-white z-10 flex items-center justify-between gap-2">
                        {/* Tipo de Destino */}
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider backdrop-blur-md border ${
                          destType === 'CUSTOM_OFFER'
                            ? 'bg-amber-600/90 text-white border-amber-400/50'
                            : destType === 'PRODUCT'
                            ? 'bg-blue-600/90 text-white border-blue-400/50'
                            : 'bg-purple-900/80 text-purple-200 border-purple-400/40'
                        }`}>
                          {destType === 'CUSTOM_OFFER' 
                            ? '⚡ Checkout Próprio' 
                            : destType === 'PRODUCT' 
                            ? '🛒 Produto do Catálogo' 
                            : '👁️ Apenas Visual'}
                        </span>
                      </div>

                      {isVideo && (
                        <div className="absolute w-10 h-10 rounded-full bg-white/30 backdrop-blur-md flex items-center justify-center text-white border border-white/40 shadow-lg pointer-events-none">
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        </div>
                      )}
                    </div>

                    {/* Detalhes do Card */}
                    <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-bold text-gray-900 line-clamp-1">{card.title}</h4>
                          <span className="text-[11px] font-mono text-gray-400 shrink-0">#{idx + 1}</span>
                        </div>

                        {/* Bloco de Valores (se houver checkout promocional) */}
                        {destType === 'CUSTOM_OFFER' && (
                          <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-[11px] font-bold text-amber-900">Preço da Oferta:</span>
                              <div className="flex items-center gap-1.5 font-mono">
                                {card.promoPrice && (
                                  <span className="font-extrabold text-amber-800 text-sm">
                                    {formatBRL(card.promoPrice)}
                                  </span>
                                )}
                                {card.promoOriginalPrice && (
                                  <span className="line-through text-gray-400 text-xs">
                                    {formatBRL(card.promoOriginalPrice)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {card.promoUsageLimit && card.promoUsageLimit > 0 && (
                              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-amber-200/60">
                                <span className="text-amber-800 font-semibold">Limite de Usos:</span>
                                <span className="font-mono font-bold text-amber-950">
                                  {card.promoTimesUsed || 0} de {card.promoUsageLimit} utilizados
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Bloco de Agendamento */}
                        <div className="p-2.5 bg-gray-50 border border-gray-150 rounded-xl space-y-1 text-[11px]">
                          <div className="flex items-center justify-between text-gray-600">
                            <span className="font-semibold text-gray-500">Início:</span>
                            <span className="font-mono text-gray-800 font-medium">
                              {formatPromoDateTimeBr(card.startAt || card.startDate)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-gray-600">
                            <span className="font-semibold text-gray-500">Término:</span>
                            <span className="font-mono text-gray-800 font-medium">
                              {(card.endAt || card.endDate) ? formatPromoDateTimeBr(card.endAt || card.endDate) : 'Sem término (contínuo)'}
                            </span>
                          </div>
                        </div>

                        {/* Informações Técnicas de Rotação */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-gray-500">
                          <span className="flex items-center gap-1 font-mono font-medium">
                            <Clock className="w-3 h-3 text-gray-400" />
                            {isVideo ? `Vídeo: ${card.videoDuration || 10}s (real)` : `Rotação: ${card.durationSeconds || 5}s`}
                          </span>

                          <span className="font-semibold text-emerald-800">
                            {card.cardModel === 'HIGHLIGHT' ? 'Oferta em Destaque' : card.cardModel === 'ANIMATED' ? 'Visual Animado' : 'Hero Promocional'}
                          </span>
                        </div>
                      </div>

                      {/* Ações e Controles */}
                      <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
                        {/* Controles de Ordem */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleMoveOrder(idx, 'up')}
                            disabled={idx === 0 || !canManage}
                            className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                            title="Subir ordem"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <span className="text-xs font-mono font-bold text-gray-500 px-1">
                            #{idx + 1}
                          </span>
                          <button
                            onClick={() => handleMoveOrder(idx, 'down')}
                            disabled={idx === offers.length - 1 || !canManage}
                            className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                            title="Descer ordem"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Botões de Ação */}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setPreviewingCard(card)}
                            className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                            title="Visualizar Preview"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {canManage && (
                            <>
                              <button
                                onClick={() => handleToggleActive(card)}
                                className={`px-2 py-1 text-xs font-bold rounded-lg border transition-colors cursor-pointer ${
                                  card.isActive
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                    : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                }`}
                                title={card.isActive ? 'Desativar Card' : 'Ativar Card'}
                              >
                                {card.isActive ? 'Ativo' : 'Desativado'}
                              </button>

                              <button
                                onClick={() => handleOpenEdit(card)}
                                className="p-1.5 text-gray-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                title="Editar Card"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>

                              <button
                                onClick={() => handleDuplicateCard(card)}
                                className="p-1.5 text-gray-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                                title="Duplicar Card"
                              >
                                <Copy className="w-4 h-4" />
                              </button>

                              {isN1N6Backend() && card.mediaAssetId && (
                                <button
                                  data-testid="unpublish-media"
                                  onClick={() => handleUnpublishMedia(card)}
                                  className="p-1.5 text-gray-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                  title="Despublicar mídia"
                                >
                                  <EyeOff className="w-4 h-4" />
                                </button>
                              )}

                              <button
                                onClick={() => handleDeleteCard(card)}
                                className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                title="Excluir Card"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* ABA 2: DESEMPENHO & MÉTRICAS REAIS DAS PROMOÇÕES                     */}
      {/* ==================================================================== */}
      {activeTab === 'performance' && (
        <PromoPerformancePanel
          tenantId={activeTenant.id}
          securityContext={securityContext}
          offers={offers}
          onEditCard={handleOpenEdit}
        />
      )}

      {/* ==================================================================== */}
      {/* ABA 3: MATERIAIS & QR CODE OFICIAL (PRESERVADA 100%)                  */}
      {/* ==================================================================== */}
      {activeTab === 'campaigns' && canManageCampaigns && (
        <CampaignsPanel tenantId={activeTenant.id} offers={offers} products={products} />
      )}

      {activeTab === 'pickup-qr' && pickupQrTabVisible && activeTenant?.id && (
        <ArrivalQrMarketingCard tenantId={activeTenant.id} storeName={activeTenant.name}
          canManage={activeRole === 'OWNER' || activeRole === 'MANAGER'} />
      )}

      {activeTab === 'materials' && (
        <div className="space-y-6">
          <QRCodeCard
            slug={activeTenant.slug}
            storeName={activeTenant.name}
            primaryColor={activeTenant.theme.primaryColor}
            onOpenApp={() => window.open(getPublicStoreUrl(activeTenant.slug), '_blank')}
          />
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: EDITOR PROFISSIONAL DE CARDS PROMOCIONAIS                     */}
      {/* ==================================================================== */}
      {isEditorOpen && (
        <Modal
          isOpen={isEditorOpen}
          onClose={() => !isSaving && setIsEditorOpen(false)}
          title={editingCard ? 'Editar Criativo Promocional' : 'Novo Card Promocional'}
          size="2xl"
        >
          <form onSubmit={handleSaveCard} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* ============================================================== */}
              {/* COLUNA ESQUERDA: FORMULÁRIO COMPLETO                           */}
              {/* ============================================================== */}
              <div className="lg:col-span-7 space-y-4">
                {/* ------------------------------------------------------------ */}
                {/* SEÇÃO 1: DESTINO DO CARD (O QUE ACONTECE AO CLICAR)           */}
                {/* ------------------------------------------------------------ */}
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-emerald-600" />
                      <span>1. Destino do Card (O que acontece ao clicar?)</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {/* MODO 1: APENAS VISUAL */}
                    <div
                      onClick={() => {
                        setDestinationType('BANNER_ONLY');
                        setHasPromoCheckout(false);
                      }}
                      className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-2 ${
                        destinationType === 'BANNER_ONLY'
                          ? 'border-emerald-600 bg-emerald-50/70 shadow-xs'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black tracking-wide text-gray-900">
                          👁️ Apenas Visual
                        </span>
                        {destinationType === 'BANNER_ONLY' && (
                          <div className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 leading-snug">
                        Exibição pura de arte ou vídeo sem abrir produtos ou checkout.
                      </p>
                    </div>

                    {/* MODO 2: PRODUTO DO CATÁLOGO */}
                    <div
                      onClick={() => {
                        setDestinationType('PRODUCT');
                        setHasPromoCheckout(false);
                        if (!selectedProductId && products[0]?.id) {
                          setSelectedProductId(products[0].id);
                        }
                      }}
                      className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-2 ${
                        destinationType === 'PRODUCT'
                          ? 'border-emerald-600 bg-emerald-50/70 shadow-xs'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black tracking-wide text-gray-900">
                          🛒 Produto Loja
                        </span>
                        {destinationType === 'PRODUCT' && (
                          <div className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 leading-snug">
                        Abre um produto existente do catálogo para adicionar à sacola.
                      </p>
                    </div>

                    {/* MODO 3: CHECKOUT PROMOCIONAL */}
                    <div
                      onClick={() => {
                        setDestinationType('CUSTOM_OFFER');
                        setHasPromoCheckout(true);
                      }}
                      className={`p-3 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-2 ${
                        destinationType === 'CUSTOM_OFFER'
                          ? 'border-amber-600 bg-amber-50/70 shadow-xs'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black tracking-wide text-amber-950 flex items-center gap-1">
                          ⚡ Checkout
                        </span>
                        {destinationType === 'CUSTOM_OFFER' && (
                          <div className="w-4 h-4 rounded-full bg-amber-600 text-white flex items-center justify-center">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-amber-800/90 leading-snug">
                        Oferta direta independente com preço De/Por, cupons e regras.
                      </p>
                    </div>
                  </div>

                  {/* SELETOR AVANÇADO DE PRODUTO OU OFERTA EXISTENTE (MODO 2) */}
                  {destinationType === 'PRODUCT' && (
                    <div className="pt-3 border-t border-gray-200 space-y-3">
                      {/* Sub-abas de escolha: Produto Direto vs Oferta Existente de Promoções e Cupons */}
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                          <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Vínculo do Card:</span>
                        </label>

                        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-gray-200 shadow-2xs">
                          <button
                            type="button"
                            onClick={() => {
                              setProductLinkMode('CATALOG');
                              setIsChangingProductSelection(false);
                            }}
                            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                              productLinkMode === 'CATALOG'
                                ? 'bg-emerald-600 text-white shadow-2xs'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            <ShoppingBag className="w-3 h-3" />
                            <span>Produto do Catálogo</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setProductLinkMode('EXISTING_OFFER');
                              setIsChangingOfferSelection(false);
                            }}
                            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                              productLinkMode === 'EXISTING_OFFER'
                                ? 'bg-amber-600 text-white shadow-2xs'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
                          >
                            <Flame className="w-3 h-3 text-amber-200" />
                            <span>Oferta em Promoções ({availableOffers.length})</span>
                          </button>
                        </div>
                      </div>

                      {/* ============================================================== */}
                      {/* SUB-MODO A: PRODUTO DO CATÁLOGO                                */}
                      {/* ============================================================== */}
                      {productLinkMode === 'CATALOG' && (
                        <div className="space-y-2.5 bg-white p-3 rounded-xl border border-gray-200 shadow-2xs">
                          {/* 1. SE PRODUTO ESTIVER SELECIONADO E NÃO EM MODO DE TROCA */}
                          {selectedProductId && !isChangingProductSelection ? (
                            (() => {
                              const selProd = products.find(p => p.id === selectedProductId);
                              const cat = selProd ? categories.find(c => c.id === selProd.categoryId) : null;
                              return selProd ? (
                                <div className="p-3 bg-emerald-50/70 border-2 border-emerald-500 rounded-xl space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                      Produto Selecionado do Catálogo
                                    </span>
                                    <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                                      Ativo na Loja
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-3">
                                    {selProd.imageUrl ? (
                                      <img
                                        src={selProd.imageUrl}
                                        alt={selProd.name}
                                        className="w-14 h-14 rounded-lg object-cover border border-emerald-200 shrink-0 bg-white"
                                      />
                                    ) : (
                                      <div className="w-14 h-14 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-200">
                                        <ShoppingBag className="w-6 h-6" />
                                      </div>
                                    )}

                                    <div className="flex-1 min-w-0">
                                      <h4 className="text-xs font-extrabold text-gray-900 truncate">
                                        {selProd.name}
                                      </h4>
                                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                        {cat && (
                                          <span className="text-[10px] font-semibold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                                            {cat.name}
                                          </span>
                                        )}
                                        <span className="text-[11px] font-extrabold text-emerald-800">
                                          {formatBRL(selProd.price)}
                                          <span className="text-[10px] text-gray-500 font-normal"> / {selProd.unit || 'un'}</span>
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-gray-500 mt-0.5">
                                        Estoque: {selProd.stockQuantity > 0 ? `${selProd.stockQuantity} disponíveis` : 'Sem estoque'}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-emerald-200/80">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedProductId('');
                                        setIsChangingProductSelection(true);
                                      }}
                                      className="px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                    >
                                      Remover Seleção
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setIsChangingProductSelection(true)}
                                      className="px-3 py-1 text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                      <span>Trocar Produto</span>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                                  Produto vinculado não encontrado. Selecione um novo produto abaixo.
                                </div>
                              );
                            })()
                          ) : (
                            /* 2. PESQUISA INSTANTÂNEA E FILTRO POR CATEGORIA */
                            <div className="space-y-2.5">
                              {/* Barra de Filtro de Categoria e Busca */}
                              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                                {/* Filtro por Categoria */}
                                <div className="sm:col-span-5">
                                  <div className="relative">
                                    <select
                                      value={selectedProductCategory}
                                      onChange={(e) => setSelectedProductCategory(e.target.value)}
                                      className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 font-medium text-gray-800"
                                    >
                                      <option value="ALL">Todas as Categorias ({products.length})</option>
                                      {categories.map((c) => {
                                        const count = products.filter(p => p.categoryId === c.id).length;
                                        return (
                                          <option key={c.id} value={c.id}>
                                            {c.name} ({count})
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </div>
                                </div>

                                {/* Barra de Pesquisa Instantânea */}
                                <div className="sm:col-span-7">
                                  <div className="relative">
                                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                    <input
                                      type="text"
                                      placeholder="Pesquisar por nome ou descrição..."
                                      value={productSearchTerm}
                                      onChange={(e) => setProductSearchTerm(e.target.value)}
                                      className="w-full pl-8 pr-7 py-1.5 text-xs border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 font-medium text-gray-800 placeholder-gray-400"
                                    />
                                    {productSearchTerm && (
                                      <button
                                        type="button"
                                        onClick={() => setProductSearchTerm('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Lista de Resultados de Produtos com Imagem, Preço e Categoria */}
                              <div className="border border-gray-200 rounded-xl overflow-hidden">
                                <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200 flex items-center justify-between text-[11px] text-gray-500 font-semibold">
                                  <span>{filteredProducts.length} produtos encontrados</span>
                                  {selectedProductId && (
                                    <button
                                      type="button"
                                      onClick={() => setIsChangingProductSelection(false)}
                                      className="text-emerald-700 hover:underline cursor-pointer font-bold"
                                    >
                                      Manter atual
                                    </button>
                                  )}
                                </div>

                                <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 p-1">
                                  {filteredProducts.length === 0 ? (
                                    <div className="p-6 text-center text-gray-500 space-y-1">
                                      <ShoppingBag className="w-7 h-7 mx-auto text-gray-300" />
                                      <p className="text-xs font-semibold">Nenhum produto encontrado</p>
                                      <p className="text-[11px] text-gray-400">
                                        Tente alterar o termo da pesquisa ou trocar a categoria selecionada.
                                      </p>
                                    </div>
                                  ) : (
                                    filteredProducts.map((p) => {
                                      const isSelected = selectedProductId === p.id;
                                      const cat = categories.find(c => c.id === p.categoryId);
                                      return (
                                        <div
                                          key={p.id}
                                          onClick={() => {
                                            setSelectedProductId(p.id);
                                            setIsChangingProductSelection(false);
                                            setSelectedLinkedOfferMeta(null);
                                            if (!title || title.startsWith('Card Promocional')) {
                                              setTitle(p.name);
                                            }
                                            if (!mediaUrl && p.imageUrl) {
                                              setMediaUrl(p.imageUrl);
                                              inspectMedia(p.imageUrl, 'IMAGE');
                                            }
                                          }}
                                          className={`p-2 rounded-lg flex items-center justify-between gap-2.5 cursor-pointer transition-all ${
                                            isSelected
                                              ? 'bg-emerald-50 border border-emerald-500 text-emerald-950 font-medium'
                                              : 'hover:bg-gray-50 border border-transparent'
                                          }`}
                                        >
                                          <div className="flex items-center gap-2.5 min-w-0">
                                            {p.imageUrl ? (
                                              <img
                                                src={p.imageUrl}
                                                alt={p.name}
                                                className="w-10 h-10 rounded-lg object-cover border border-gray-200 shrink-0 bg-white"
                                              />
                                            ) : (
                                              <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center shrink-0 border border-gray-200">
                                                <ShoppingBag className="w-4 h-4" />
                                              </div>
                                            )}

                                            <div className="min-w-0">
                                              <p className="text-xs font-bold text-gray-900 truncate">
                                                {p.name}
                                              </p>
                                              <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                                                {cat && (
                                                  <span className="bg-gray-100 text-gray-700 px-1 py-0.2 rounded font-medium">
                                                    {cat.name}
                                                  </span>
                                                )}
                                                <span>Estoque: {p.stockQuantity}</span>
                                              </div>
                                            </div>
                                          </div>

                                          <div className="flex items-center gap-2 shrink-0">
                                            <div className="text-right">
                                              <span className="text-xs font-extrabold text-emerald-800 block">
                                                {formatBRL(p.price)}
                                              </span>
                                              <span className="text-[10px] text-gray-400 block">
                                                por {p.unit || 'un'}
                                              </span>
                                            </div>

                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                                              isSelected ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-400'
                                            }`}>
                                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ============================================================== */}
                      {/* SUB-MODO B: OFERTA EXISTENTE EM PROMOÇÕES E CUPONS              */}
                      {/* ============================================================== */}
                      {productLinkMode === 'EXISTING_OFFER' && (
                        <div className="space-y-2.5 bg-white p-3 rounded-xl border border-gray-200 shadow-2xs">
                          {/* SE JÁ HÁ UMA OFERTA VINCULADA E NÃO ESTÁ TROCANDO */}
                          {selectedProductId && selectedLinkedOfferMeta && !isChangingOfferSelection ? (
                            (() => {
                              const selProd = products.find(p => p.id === selectedProductId);
                              return (
                                <div className="p-3 bg-amber-50/70 border-2 border-amber-500 rounded-xl space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-900 flex items-center gap-1">
                                      <Flame className="w-3.5 h-3.5 text-amber-600" />
                                      Oferta Vinculada Preservada (Promoções e Cupons)
                                    </span>
                                    <span className="text-[11px] font-bold text-amber-900 bg-amber-200/70 px-2 py-0.5 rounded-full">
                                      {selectedLinkedOfferMeta.carouselName}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-3">
                                    {selProd?.imageUrl ? (
                                      <img
                                        src={selProd.imageUrl}
                                        alt={selProd.name}
                                        className="w-14 h-14 rounded-lg object-cover border border-amber-200 shrink-0 bg-white"
                                      />
                                    ) : (
                                      <div className="w-14 h-14 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 border border-amber-200">
                                        <Flame className="w-6 h-6" />
                                      </div>
                                    )}

                                    <div className="flex-1 min-w-0">
                                      <h4 className="text-xs font-extrabold text-gray-900 truncate">
                                        {selProd?.name || 'Oferta Promocional'}
                                      </h4>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[11px] text-gray-400 line-through">
                                          {formatBRL(selectedLinkedOfferMeta.originalPrice)}
                                        </span>
                                        <span className="text-xs font-black text-amber-700">
                                          {formatBRL(selectedLinkedOfferMeta.promotionalPrice)}
                                        </span>
                                        <span className="text-[10px] font-extrabold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded">
                                          -{selectedLinkedOfferMeta.discountPercentage}% OFF
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-gray-500 mt-0.5">
                                        {selectedLinkedOfferMeta.startDate || selectedLinkedOfferMeta.endDate
                                          ? `Vigência: ${selectedLinkedOfferMeta.startDate ? formatPromoDateTimeBr(selectedLinkedOfferMeta.startDate) : 'Início imediato'} até ${selectedLinkedOfferMeta.endDate ? formatPromoDateTimeBr(selectedLinkedOfferMeta.endDate) : 'Sem expiração'}`
                                          : 'Oferta com vigência contínua'}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-amber-200/80">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedProductId('');
                                        setSelectedLinkedOfferMeta(null);
                                        setIsChangingOfferSelection(true);
                                      }}
                                      className="px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                    >
                                      Remover Vínculo
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setIsChangingOfferSelection(true)}
                                      className="px-3 py-1 text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                      <span>Trocar Oferta</span>
                                    </button>
                                  </div>
                                </div>
                              );
                            })()
                          ) : (
                            /* LISTAGEM DE OFERTAS EXISTENTES DE PROMOÇÕES E CUPONS */
                            <div className="space-y-2.5">
                              {/* Barra de Busca de Ofertas e Filtro de Situação */}
                              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                                <div className="sm:col-span-8">
                                  <div className="relative">
                                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                    <input
                                      type="text"
                                      placeholder="Pesquisar por oferta, produto ou carrossel..."
                                      value={offerSearchTerm}
                                      onChange={(e) => setOfferSearchTerm(e.target.value)}
                                      className="w-full pl-8 pr-7 py-1.5 text-xs border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-amber-500 font-medium text-gray-800 placeholder-gray-400"
                                    />
                                    {offerSearchTerm && (
                                      <button
                                        type="button"
                                        onClick={() => setOfferSearchTerm('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <div className="sm:col-span-4">
                                  <select
                                    value={offerStatusFilter}
                                    onChange={(e) => setOfferStatusFilter(e.target.value as 'ALL' | 'ACTIVE')}
                                    className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-amber-500 font-medium text-gray-800"
                                  >
                                    <option value="ACTIVE">Apenas Ativas</option>
                                    <option value="ALL">Todas as Ofertas</option>
                                  </select>
                                </div>
                              </div>

                              {/* Lista de Resultados de Ofertas */}
                              <div className="border border-gray-200 rounded-xl overflow-hidden">
                                <div className="bg-amber-50/60 px-3 py-1.5 border-b border-gray-200 flex items-center justify-between text-[11px] text-amber-900 font-semibold">
                                  <span>{filteredOffers.length} ofertas elegíveis encontradas</span>
                                  {selectedProductId && selectedLinkedOfferMeta && (
                                    <button
                                      type="button"
                                      onClick={() => setIsChangingOfferSelection(false)}
                                      className="text-amber-800 hover:underline cursor-pointer font-bold"
                                    >
                                      Manter atual
                                    </button>
                                  )}
                                </div>

                                <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 p-1">
                                  {filteredOffers.length === 0 ? (
                                    <div className="p-6 text-center text-gray-500 space-y-1">
                                      <Flame className="w-7 h-7 mx-auto text-amber-300" />
                                      <p className="text-xs font-semibold">Nenhuma oferta promocional disponível</p>
                                      <p className="text-[11px] text-gray-400 max-w-sm mx-auto">
                                        Nenhuma oferta foi encontrada com estes filtros. Você pode selecionar um "Produto do Catálogo" ou cadastrar uma oferta no menu "Promoções".
                                      </p>
                                    </div>
                                  ) : (
                                    filteredOffers.map((off) => {
                                      const isSelected = selectedProductId === off.productId;
                                      return (
                                        <div
                                          key={off.id}
                                          onClick={() => {
                                            setSelectedProductId(off.productId);
                                            setSelectedLinkedOfferMeta({
                                              carouselName: off.carouselName,
                                              originalPrice: off.originalPrice,
                                              promotionalPrice: off.promotionalPrice,
                                              discountPercentage: off.discountPercentage,
                                              startDate: off.startDate,
                                              endDate: off.endDate,
                                            });
                                            setIsChangingOfferSelection(false);

                                            // Preserva título e imagem quando apropriado
                                            if (!title || title.startsWith('Card Promocional')) {
                                              setTitle(off.productName);
                                            }
                                            if (!mediaUrl && off.productImage) {
                                              setMediaUrl(off.productImage);
                                              inspectMedia(off.productImage, 'IMAGE');
                                            }

                                            // Preserva agendamento se a oferta possuir datas cadastradas
                                            if (off.startDate) {
                                              const s = extractDateAndTimeFromIso(off.startDate);
                                              setStartDateInput(s.date);
                                              setStartTimeInput(s.time || '07:00');
                                            }
                                            if (off.endDate) {
                                              const e = extractDateAndTimeFromIso(off.endDate);
                                              setEndDateInput(e.date);
                                              setEndTimeInput(e.time || '23:59');
                                              setNoEndDate(false);
                                            }
                                          }}
                                          className={`p-2.5 rounded-lg flex items-center justify-between gap-2.5 cursor-pointer transition-all ${
                                            isSelected
                                              ? 'bg-amber-50 border border-amber-500 text-amber-950 font-medium'
                                              : 'hover:bg-amber-50/40 border border-transparent'
                                          }`}
                                        >
                                          <div className="flex items-center gap-2.5 min-w-0">
                                            {off.productImage ? (
                                              <img
                                                src={off.productImage}
                                                alt={off.productName}
                                                className="w-10 h-10 rounded-lg object-cover border border-gray-200 shrink-0 bg-white"
                                              />
                                            ) : (
                                              <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 border border-amber-200">
                                                <Flame className="w-4 h-4" />
                                              </div>
                                            )}

                                            <div className="min-w-0">
                                              <div className="flex items-center gap-1.5">
                                                <p className="text-xs font-bold text-gray-900 truncate">
                                                  {off.productName}
                                                </p>
                                                <span className={`text-[9.5px] px-1.5 py-0.2 rounded font-semibold ${
                                                  off.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                  {off.isActive ? 'Ativa' : 'Inativa'}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-1.5 text-[10px] text-gray-500 mt-0.5">
                                                <span className="font-medium text-amber-900">
                                                  📁 {off.carouselName}
                                                </span>
                                                {off.categoryName && <span>• {off.categoryName}</span>}
                                              </div>
                                            </div>
                                          </div>

                                          <div className="flex items-center gap-2 shrink-0">
                                            <div className="text-right">
                                              <span className="text-[10px] text-gray-400 line-through block">
                                                {formatBRL(off.originalPrice)}
                                              </span>
                                              <span className="text-xs font-black text-amber-700 block">
                                                {formatBRL(off.promotionalPrice)}
                                              </span>
                                              <span className="text-[9.5px] font-bold text-emerald-800 bg-emerald-50 px-1 py-0.2 rounded">
                                                -{off.discountPercentage}%
                                              </span>
                                            </div>

                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                                              isSelected ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-400'
                                            }`}>
                                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ------------------------------------------------------------ */}
                {/* SEÇÃO 2: MÍDIA PROMOCIONAL (1200 x 675 px — 16:9)            */}
                {/* ------------------------------------------------------------ */}
                <div className="space-y-3 p-4 bg-gray-50 rounded-2xl border border-gray-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <label className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                        <Film className="w-3.5 h-3.5 text-emerald-600" />
                        <span>2. Mídia Promocional (1200 × 675 px — 16:9)</span>
                      </label>
                      <p className="text-[11px] text-gray-500">
                        Arte 100% limpa (sem textos sobrepostos). Upload direto ou URL externa.
                      </p>
                    </div>

                    <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-gray-200 self-start sm:self-auto">
                      <button
                        type="button"
                        onClick={() => setMediaSourceMode('upload')}
                        className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                          mediaSourceMode === 'upload' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        <Upload className="w-3 h-3" />
                        <span>Upload</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setMediaSourceMode('url')}
                        className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                          mediaSourceMode === 'url' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        <LinkIcon className="w-3 h-3" />
                        <span>URL Externa</span>
                      </button>
                    </div>
                  </div>

                  {mediaSourceMode === 'upload' ? (
                    <div className="flex flex-col sm:flex-row items-center gap-3">
                      <label className="w-full flex flex-col items-center justify-center p-5 border-2 border-dashed border-gray-300 hover:border-emerald-500 rounded-2xl cursor-pointer bg-white transition-colors">
                        <Upload className="w-6 h-6 text-gray-400 mb-1" />
                        <span className="text-xs font-bold text-gray-700">Clique para enviar imagem ou vídeo</span>
                        <span className="text-[10px] text-gray-400 mt-0.5">JPG, PNG, WEBP até 10MB • MP4, WEBM até 35MB</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
                          onChange={handleFileUpload}
                          disabled={isUploading}
                          className="hidden"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Input
                        placeholder="https://exemplo.com/sua-arte-16-9.jpg ou .mp4"
                        value={mediaUrl}
                        onChange={(e) => {
                          const val = e.target.value;
                          setMediaUrl(val);
                          setPendingMarketingAsset(null);
                          const isVid = /\.(mp4|webm|mov)(\?.*)?$/i.test(val);
                          setMediaType(isVid ? 'VIDEO' : 'IMAGE');
                          inspectMedia(val, isVid ? 'VIDEO' : 'IMAGE');
                        }}
                        required
                      />
                    </div>
                  )}

                  {/* Informações da Mídia Detectada */}
                  {mediaUrl && (
                    <div className="p-2.5 bg-white border border-gray-200 rounded-xl text-xs text-gray-700 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900">
                          {mediaType === 'VIDEO' ? '🎥 Vídeo Detectado' : '🖼️ Imagem Detectada'}
                        </span>
                        {detectedWidth && detectedHeight && (
                          <span className="font-mono text-gray-500 text-[11px]">
                            ({detectedWidth} × {detectedHeight} px)
                          </span>
                        )}
                      </div>

                      {mediaType === 'VIDEO' && detectedVideoDuration && (
                        <span className="font-mono font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-[11px]">
                          Duração: {detectedVideoDuration}s
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* ------------------------------------------------------------ */}
                {/* SEÇÃO 3: CHECKOUT DA PROMOÇÃO (MODO 3)                       */}
                {/* ------------------------------------------------------------ */}
                {destinationType === 'CUSTOM_OFFER' && (
                  <div className="p-4 bg-amber-50/60 rounded-2xl border-2 border-amber-300/80 space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="p-1 rounded-lg bg-amber-600 text-white shadow-2xs">
                          <Flame className="w-3.5 h-3.5" />
                        </span>
                        <div>
                          <h3 className="text-xs font-black text-amber-950 uppercase tracking-wide">
                            3. Regras do Checkout Promocional
                          </h3>
                        </div>
                      </div>
                      <Badge variant="warning" size="sm">Oferta Independente</Badge>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5">
                      {isN1N6Backend() && (
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-gray-700 block">
                            Produto do catálogo vendido neste checkout *
                          </label>
                          <select
                            data-testid="promo-checkout-product"
                            value={selectedProductId}
                            onChange={(e) => setSelectedProductId(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white"
                          >
                            <option value="">Selecione o produto…</option>
                            {products.map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                          <p className="text-[11px] text-gray-500">
                            O pedido e a baixa de estoque são do produto; preço e limites são validados pelo servidor.
                          </p>
                        </div>
                      )}
                      <Input
                        label="Nome da Oferta *"
                        value={promoTitle}
                        onChange={(e) => setPromoTitle(e.target.value)}
                        placeholder="Ex: Combo Especial 2 Garrafas + Petisco"
                        required={destinationType === 'CUSTOM_OFFER'}
                      />

                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-gray-700 block">
                          Unidade de venda
                        </label>
                        <select
                          value={isCustomPromoUnit ? 'outro' : (['un', 'kit', 'cesta', 'combo', 'serviço', 'kg', 'g'].includes(promoUnit) ? promoUnit : 'outro')}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'outro') {
                              setIsCustomPromoUnit(true);
                              if (promoUnit === 'un') setPromoUnit('');
                            } else {
                              setIsCustomPromoUnit(false);
                              setPromoUnit(val);
                            }
                          }}
                          className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-amber-500 font-medium"
                        >
                          <option value="un">Unidade (padrão - un)</option>
                          <option value="kit">Kit (kit)</option>
                          <option value="cesta">Cesta (cesta)</option>
                          <option value="combo">Combo (combo)</option>
                          <option value="serviço">Serviço (serv)</option>
                          <option value="kg">Quilograma (kg)</option>
                          <option value="g">Grama (g)</option>
                          <option value="outro">Outro (personalizada)...</option>
                        </select>
                        {isCustomPromoUnit && (
                          <div className="pt-1">
                            <Input
                              placeholder="Digite a unidade comercial (ex: garrafa, dúzia, taça)"
                              value={promoUnit}
                              onChange={(e) => setPromoUnit(e.target.value)}
                              required={destinationType === 'CUSTOM_OFFER'}
                            />
                          </div>
                        )}
                        <p className="text-[10px] text-gray-500">
                          Define a unidade comercial vendida. Não altera quantidades mínimas, máximas ou preços.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-gray-700 block">
                        Descrição da Oferta *
                      </label>
                      <textarea
                        value={promoDescription}
                        onChange={(e) => setPromoDescription(e.target.value)}
                        placeholder="Descreva detalhadamente o que está incluso na promoção..."
                        rows={2}
                        className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-amber-500 font-medium"
                        required={destinationType === 'CUSTOM_OFFER'}
                      />
                    </div>

                    {/* Preços e Desconto */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <Input
                        label="Preço De (R$)"
                        type="number"
                        step="0.01"
                        value={promoOriginalPrice}
                        onChange={(e) => handlePromoPriceChange(e.target.value, promoPrice)}
                        placeholder="Ex: 59.90"
                      />

                      <Input
                        label="Preço Por (R$) *"
                        type="number"
                        step="0.01"
                        value={promoPrice}
                        onChange={(e) => handlePromoPriceChange(promoOriginalPrice, e.target.value)}
                        placeholder="Ex: 44.90"
                        required={destinationType === 'CUSTOM_OFFER'}
                      />

                      <Input
                        label="% Desconto"
                        type="number"
                        value={promoDiscountPercentage}
                        onChange={(e) => setPromoDiscountPercentage(e.target.value)}
                        placeholder="Auto"
                      />
                    </div>

                    {/* Quantidades e Limites */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <Input
                        label="Qtd Mínima"
                        type="number"
                        min={1}
                        value={promoMinQuantity}
                        onChange={(e) => setPromoMinQuantity(e.target.value)}
                        placeholder="1"
                      />

                      <Input
                        label="Máx / Cliente"
                        type="number"
                        min={1}
                        value={promoMaxQuantityPerCustomer}
                        onChange={(e) => setPromoMaxQuantityPerCustomer(e.target.value)}
                        placeholder="10"
                      />

                      <Input
                        label="Limite de Usos"
                        type="number"
                        min={1}
                        value={promoUsageLimit}
                        onChange={(e) => setPromoUsageLimit(e.target.value)}
                        placeholder="Sem limite"
                      />
                    </div>

                    {/* Cupom vinculado. A modalidade (Delivery/Retirada) agora é escolhida pelo cliente no checkout,
                        conforme as Configurações da Loja. Restrições antigas de modalidade gravadas no card são
                        preservadas intactas (compatibilidade) e respeitadas no checkout como interseção. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-amber-200">
                      {promoFulfillmentTypes.length > 0 && promoFulfillmentTypes.length < 2 && (
                        <div className="sm:col-span-2 p-2 rounded-lg bg-amber-100/70 border border-amber-300 text-[11px] text-amber-900 flex flex-wrap items-center justify-between gap-2" data-testid="legacy-fulfillment-restriction">
                          <span>
                            Card antigo restrito a <strong>{promoFulfillmentTypes[0] === 'PICKUP' ? 'Retirada' : 'Delivery'}</strong>. O checkout respeita essa restrição junto com as Configurações da Loja.
                          </span>
                          <button
                            type="button"
                            onClick={() => setPromoFulfillmentTypes(['DELIVERY', 'PICKUP'])}
                            className="px-2 py-0.5 rounded-md bg-white border border-amber-400 font-bold hover:bg-amber-50"
                          >
                            Usar configuração da loja
                          </button>
                        </div>
                      )}
                      <div>
                        <Input
                          label="Cupom Vinculado (Opcional)"
                          placeholder="Ex: PROMO20"
                          value={promoCouponCode}
                          onChange={(e) => setPromoCouponCode(e.target.value.toUpperCase())}
                        />
                      </div>
                    </div>

                    <Input
                      label="Observações / Regras da Oferta"
                      value={promoNotes}
                      onChange={(e) => setPromoNotes(e.target.value)}
                      placeholder="Ex: Validade exclusiva para o turno da noite."
                    />
                  </div>
                )}

                {/* ------------------------------------------------------------ */}
                {/* SEÇÃO 4: IDENTIFICAÇÃO DO CARD                                */}
                {/* ------------------------------------------------------------ */}
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-1.5">
                  <label className="text-xs font-bold text-gray-800 uppercase tracking-wider block">
                    4. Nome de Identificação do Card (Apenas para organização interna) *
                  </label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: Banner Fim de Semana, Combo Chopp"
                    required
                  />
                  <p className="text-[11px] text-gray-500">
                    Este nome é exclusivo para gestão no seu painel. A imagem/vídeo ocupa 100% da área do card na vitrine, sem nenhum texto ou faixa por cima.
                  </p>
                </div>

                {/* ------------------------------------------------------------ */}
                {/* SEÇÃO 5: AGENDAMENTO (DATA + HORÁRIO)                         */}
                {/* ------------------------------------------------------------ */}
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5 text-emerald-600" />
                      <span>5. Período de Exibição</span>
                    </label>
                    <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Horário de Brasília
                    </span>
                  </div>

                  {/* Início */}
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-gray-700">INÍCIO DA EXIBIÇÃO</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500 mb-0.5 block">Data</label>
                        <Input
                          type="date"
                          value={startDateInput}
                          onChange={(e) => setStartDateInput(e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-gray-500 mb-0.5 block">Horário</label>
                        <Input
                          type="time"
                          value={startTimeInput}
                          onChange={(e) => setStartTimeInput(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Término */}
                  <div className="space-y-1.5 pt-2 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-gray-700">TÉRMINO DA EXIBIÇÃO</span>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-emerald-800">
                        <input
                          type="checkbox"
                          checked={noEndDate}
                          onChange={(e) => setNoEndDate(e.target.checked)}
                          className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                        />
                        <span>Sem término (contínuo)</span>
                      </label>
                    </div>

                    {!noEndDate ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="text-[10px] font-semibold text-gray-500 mb-0.5 block">Data</label>
                          <Input
                            type="date"
                            value={endDateInput}
                            onChange={(e) => setEndDateInput(e.target.value)}
                            required={!noEndDate}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-gray-500 mb-0.5 block">Horário</label>
                          <Input
                            type="time"
                            value={endTimeInput}
                            onChange={(e) => setEndTimeInput(e.target.value)}
                            required={!noEndDate}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-white border border-gray-200 rounded-xl text-[11px] text-gray-600 italic">
                        O card permanecerá ativo na vitrine até ser desativado manualmente.
                      </div>
                    )}
                  </div>
                </div>

                {/* ------------------------------------------------------------ */}
                {/* SEÇÃO 6: TEMPO DE ROTAÇÃO                                     */}
                {/* ------------------------------------------------------------ */}
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3">
                  <label className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-emerald-600" />
                    <span>6. Tempo de Rotação do Carrossel</span>
                  </label>

                  {mediaType === 'VIDEO' ? (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Film className="w-4 h-4 text-blue-600 shrink-0" />
                        <div>
                          <span className="font-bold">
                            Vídeo: {detectedVideoDuration ? `${detectedVideoDuration} segundos` : 'Detectando duração...'}
                          </span>
                          <p className="text-[11px] text-blue-800">
                            Avança automaticamente ao término da reprodução do arquivo de vídeo.
                          </p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 font-mono font-black text-xs bg-white rounded-lg border border-blue-200 text-blue-950 shrink-0">
                        {detectedVideoDuration ? `${detectedVideoDuration}s` : 'Auto'}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {DURATION_PRESETS.map((sec) => (
                          <button
                            key={sec}
                            type="button"
                            onClick={() => {
                              setDurationSeconds(sec);
                              setIsCustomDuration(false);
                              setCustomDurationInput(String(sec));
                            }}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                              !isCustomDuration && durationSeconds === sec
                                ? 'bg-emerald-600 text-white shadow-2xs'
                                : 'bg-white text-gray-700 border border-gray-300 hover:border-gray-400'
                            }`}
                          >
                            {sec}s
                          </button>
                        ))}

                        <button
                          type="button"
                          onClick={() => setIsCustomDuration(true)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            isCustomDuration
                              ? 'bg-emerald-600 text-white shadow-2xs'
                              : 'bg-white text-gray-700 border border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          Personalizado
                        </button>
                      </div>

                      {isCustomDuration && (
                        <div className="flex items-center gap-2 max-w-xs pt-1">
                          <Input
                            type="number"
                            min={1}
                            max={60}
                            value={customDurationInput}
                            onChange={(e) => setCustomDurationInput(e.target.value)}
                            placeholder="Ex: 8"
                          />
                          <span className="text-xs font-semibold text-gray-600">segundos</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ============================================================== */}
              {/* COLUNA DIREITA: PRÉVIA AO VIVO STICKY (16:9)                   */}
              {/* ============================================================== */}
              <div className="lg:col-span-5 lg:sticky lg:top-0 space-y-4">
                {/* Box de Prévia Interativa */}
                <div className="bg-slate-900 text-white p-4 rounded-3xl border border-slate-800 shadow-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-slate-200">
                      <Eye className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Prévia ao Vivo na Vitrine</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700">
                      16:9 • 1200×675 px
                    </span>
                  </div>

                  {/* Abas da Prévia */}
                  <div className="grid grid-cols-4 gap-1 bg-slate-950 p-1 rounded-xl text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setEditorPreviewTab('isolated')}
                      className={`py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
                        editorPreviewTab === 'isolated'
                          ? 'bg-emerald-600 text-white font-bold shadow-xs'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      🖼️ Isolado
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorPreviewTab('carousel')}
                      className={`py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
                        editorPreviewTab === 'carousel'
                          ? 'bg-emerald-600 text-white font-bold shadow-xs'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      🎠 Carrossel
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorPreviewTab('action')}
                      className={`py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
                        editorPreviewTab === 'action'
                          ? 'bg-emerald-600 text-white font-bold shadow-xs'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      🛍️ Ao Clicar
                    </button>
                    <button
                      type="button"
                      data-testid="marketing-preview-phone-tab"
                      onClick={() => setEditorPreviewTab('phone')}
                      className={`py-1.5 px-2 rounded-lg transition-all text-center cursor-pointer ${
                        editorPreviewTab === 'phone'
                          ? 'bg-emerald-600 text-white font-bold shadow-xs'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      📱 Celular
                    </button>
                  </div>

                  {/* Banner 16:9 Fiel ao App do Cliente */}
                  {editorPreviewTab === 'phone' && activeTenant?.slug && (
                    <div className="rounded-2xl bg-slate-950 p-3" data-testid="marketing-phone-preview">
                      <PhonePreview
                        storeSlug={activeTenant.slug}
                        reservedHeight={340}
                        card={{
                          title, subtitle, badge, mediaType, mediaUrl, imageUrl: mediaType === 'IMAGE' ? mediaUrl : undefined,
                          durationSeconds, destinationType, isActive: true,
                        } as any}
                      />
                      <p className="mt-2 text-center text-[10px] text-slate-400">É o app real da loja; seu card aparece primeiro. Nada é salvo.</p>
                    </div>
                  )}
                  <div className={`${editorPreviewTab === 'phone' ? 'hidden ' : ''}relative aspect-16/9 w-full rounded-2xl overflow-hidden bg-black flex items-center justify-center border border-slate-800 shadow-2xl group`}>
                    {mediaType === 'VIDEO' && mediaUrl ? (
                      <video
                        key={mediaUrl}
                        src={mediaUrl}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="w-full h-full object-cover object-center"
                      />
                    ) : mediaUrl ? (
                      <img
                        src={mediaUrl}
                        alt={title || 'Arte do Card'}
                        className="w-full h-full object-cover object-center"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 text-center text-slate-500 space-y-1.5">
                        <Film className="w-8 h-8 text-slate-600" />
                        <span className="text-xs font-semibold text-slate-300">Área do Card 16:9</span>
                        <span className="text-[10px] text-slate-500">Envie uma imagem/vídeo ou insira uma URL</span>
                      </div>
                    )}

                    {/* Simulação de Carrossel: Indicadores Segmentados Estilo iFood e Setas */}
                    {editorPreviewTab === 'carousel' && (
                      <>
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center backdrop-blur-xs text-xs z-20 shadow-md">
                          ‹
                        </div>
                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center backdrop-blur-xs text-xs z-20 shadow-md">
                          ›
                        </div>

                        {/* Indicadores Segmentados no Estilo do iFood */}
                        <div className="absolute bottom-0 left-0 right-0 z-30 pt-6 pb-2 px-3 bg-gradient-to-t from-black/80 via-black/35 to-transparent pointer-events-none">
                          <div className="flex items-center gap-1.5 w-full">
                            {/* Segmento 1: Anterior concluído */}
                            <div className="flex-1 h-1 rounded-full overflow-hidden bg-white/35">
                              <div className="h-full bg-white rounded-full w-full" />
                            </div>
                            {/* Segmento 2: Card em edição (progresso animado ao vivo) */}
                            <div className="flex-1 h-1 rounded-full overflow-hidden bg-white/35">
                              <div
                                className="h-full bg-white rounded-full transition-all duration-75 ease-linear"
                                style={{ width: `${simulatedProgress}%` }}
                              />
                            </div>
                            {/* Segmento 3: Próximo anúncio */}
                            <div className="flex-1 h-1 rounded-full overflow-hidden bg-white/35">
                              <div className="h-full bg-white rounded-full w-0" />
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Badge de tipo de mídia */}
                    {mediaUrl && (
                      <div className="absolute top-2.5 left-2.5 z-20 pointer-events-none">
                        <span className="px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md text-[9.5px] font-bold text-white flex items-center gap-1 border border-white/20">
                          {mediaType === 'VIDEO' ? <Film className="w-3 h-3 text-amber-400" /> : <ImageIcon className="w-3 h-3 text-emerald-400" />}
                          <span>{mediaType === 'VIDEO' ? 'Vídeo (16:9)' : 'Imagem (16:9)'}</span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Simulação do Destino / Ação ao Clicar */}
                  {editorPreviewTab === 'action' && (
                    <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 text-xs space-y-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        Comportamento no Toque do Cliente:
                      </span>

                      {destinationType === 'BANNER_ONLY' && (
                        <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 text-xs space-y-1">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <span>👁️ Apenas Visual</span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-snug">
                            O banner é uma campanha institucional ou artística de destaque sem acionar modal.
                          </p>
                        </div>
                      )}

                      {destinationType === 'PRODUCT' && (
                        <div className={`p-2.5 rounded-xl border text-xs space-y-1.5 ${
                          selectedLinkedOfferMeta 
                            ? 'bg-amber-950/60 border-amber-800/80 text-amber-200' 
                            : 'bg-emerald-950/60 border-emerald-800/80 text-emerald-200'
                        }`}>
                          <div className={`font-bold flex items-center gap-1.5 ${
                            selectedLinkedOfferMeta ? 'text-amber-300' : 'text-emerald-300'
                          }`}>
                            <span>
                              {selectedLinkedOfferMeta ? '🔥 Oferta Vinculada (Promoções e Cupons):' : '🛒 Abre o Produto Vinculado:'}
                            </span>
                          </div>
                          {selectedProductId ? (
                            (() => {
                              const p = products.find(prod => prod.id === selectedProductId);
                              return p ? (
                                <div className="p-2 bg-slate-900 rounded-lg flex items-center justify-between border border-slate-700/60">
                                  <div className="min-w-0 pr-2">
                                    <p className="font-bold text-white text-xs truncate">{p.name}</p>
                                    {selectedLinkedOfferMeta ? (
                                      <div className="flex items-center gap-1.5 text-[10px]">
                                        <span className="text-slate-400 line-through">{formatBRL(selectedLinkedOfferMeta.originalPrice)}</span>
                                        <span className="font-bold text-amber-400">{formatBRL(selectedLinkedOfferMeta.promotionalPrice)}</span>
                                        <span className="px-1 rounded bg-emerald-900 text-emerald-300 font-bold">-{selectedLinkedOfferMeta.discountPercentage}%</span>
                                      </div>
                                    ) : (
                                      <p className="text-[10px] text-slate-400">{formatBRL(p.price)} / {p.unit || 'un'}</p>
                                    )}
                                  </div>
                                  <span className={`text-[10px] px-2 py-0.5 rounded text-white font-bold shrink-0 ${
                                    selectedLinkedOfferMeta ? 'bg-amber-600' : 'bg-emerald-600'
                                  }`}>
                                    {selectedLinkedOfferMeta ? 'Aproveitar Oferta' : 'Adicionar à Sacola'}
                                  </span>
                                </div>
                              ) : <span className="text-slate-400">Produto não encontrado</span>;
                            })()
                          ) : (
                            <p className="text-amber-300 text-[11px]">Selecione um produto ou oferta no formulário.</p>
                          )}
                        </div>
                      )}

                      {destinationType === 'CUSTOM_OFFER' && (
                        <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-800/80 text-amber-200 text-xs space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-amber-300 flex items-center gap-1">
                              <span>⚡ Modal de Checkout Promocional</span>
                            </span>
                            {promoDiscountPercentage && (
                              <span className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold text-[10px]">
                                {promoDiscountPercentage}% OFF
                              </span>
                            )}
                          </div>

                          <div className="p-2.5 bg-slate-900 rounded-xl space-y-1 border border-amber-700/50">
                            <p className="font-extrabold text-white text-xs">{promoTitle || 'Nome da Oferta'}</p>
                            <p className="text-[11px] text-slate-400 line-clamp-2">{promoDescription || 'Descrição da promoção...'}</p>
                            
                            <div className="flex items-baseline gap-2 pt-1">
                              {promoPrice && (
                                <span className="font-extrabold text-amber-400 text-sm font-mono">
                                  {formatBRL(parseFloat(promoPrice))}
                                </span>
                              )}
                              {promoOriginalPrice && (
                                <span className="line-through text-slate-500 text-[11px] font-mono">
                                  {formatBRL(parseFloat(promoOriginalPrice))}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400">/{promoUnit || 'un'}</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                            <span>Entrega/Retirada: escolha no checkout</span>
                            <span className="font-bold text-amber-400">Checkout Atômico</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Card de Resumo Técnico e Auditoria do Criativo */}
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Resumo da Configuração</span>
                    </span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${formStatusMeta.badgeClass}`}>
                      {formStatusMeta.fullLabel}
                    </span>
                  </div>

                  <div className="space-y-2 text-gray-600 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Destino:</span>
                      <span className="font-bold text-gray-900">
                        {destinationType === 'CUSTOM_OFFER' 
                          ? '⚡ Checkout Promocional' 
                          : destinationType === 'PRODUCT' 
                          ? '🛒 Produto do Catálogo' 
                          : '👁️ Apenas Visual'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Tempo de Exibição:</span>
                      <span className="font-mono font-bold text-gray-900">
                        {mediaType === 'VIDEO' ? `${detectedVideoDuration || 10}s (Vídeo)` : `${isCustomDuration ? customDurationInput : durationSeconds}s (Imagem)`}
                      </span>
                    </div>

                    <div className="flex items-start justify-between gap-2">
                      <span className="text-gray-500 shrink-0">Período:</span>
                      <span className="font-mono text-right font-medium text-gray-800">
                        {computedStartIso ? formatPromoDateTimeBr(computedStartIso) : 'Aguardando'} 
                        {' → '}
                        {noEndDate ? 'Indeterminado' : (computedEndIso ? formatPromoDateTimeBr(computedEndIso) : 'Aguardando')}
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl text-[11px] text-emerald-900 leading-snug">
                    {formStatusMeta.summaryText}
                  </div>
                </div>
              </div>
            </div>

            {/* BOTÕES DE FINALIZAÇÃO */}
            <div className="pt-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditorOpen(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving || isUploading}
                className="flex items-center gap-2"
              >
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>{editingCard ? 'Salvar Alterações' : 'Publicar Card na Vitrine'}</span>
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ==================================================================== */}
      {/* MODAL: PREVIEW COMPLETO DO CARD                                      */}
      {/* ==================================================================== */}
      {previewingCard && (
        <Modal
          isOpen={!!previewingCard}
          onClose={() => setPreviewingCard(null)}
          title={`Visualização: ${previewingCard.title}`}
          size="lg"
        >
          <div className="space-y-4">
            <div className="p-6 bg-gray-950 rounded-3xl flex items-center justify-center">
              <div className="w-full max-w-md aspect-16/9 rounded-2xl overflow-hidden relative flex items-center justify-center bg-black shadow-2xl">
                {previewingCard.mediaType === 'VIDEO' && previewingCard.mediaUrl ? (
                  <video
                    src={previewingCard.mediaUrl}
                    autoPlay
                    controls
                    playsInline
                    className="w-full h-full object-cover object-center"
                  />
                ) : (previewingCard.imageUrl || previewingCard.mediaUrl) ? (
                  <img
                    src={previewingCard.imageUrl || previewingCard.mediaUrl}
                    alt={previewingCard.title}
                    className="w-full h-full object-cover object-center"
                  />
                ) : (
                  <div className="text-white/40 text-xs">Sem mídia disponível</div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t">
              <span>Modelo: {previewingCard.cardModel || 'HERO'} (16:9)</span>
              <span>Duração: {previewingCard.durationSeconds || 5}s</span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
