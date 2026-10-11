import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase, ensureValidSession } from '../../lib/supabase';
import { offerRepository } from '../../repositories/offerRepository';
import { productRepository } from '../../repositories/productRepository';
import { orderRepository } from '../../repositories/orderRepository';
import { QRCodeCard } from '../../components/common/QRCodeCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { 
  Offer, 
  Product, 
  Order,
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
  CheckSquare,
  Square
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

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

export const MarketingPage: React.FC = () => {
  const { activeTenant, securityContext, activeRole } = useAuth();
  const { showToast } = useToast();

  const canManage = activeRole === 'OWNER' || activeRole === 'MANAGER' || activeRole === 'SUPER_ADMIN' || activeRole === 'CEO';

  // Navegação Interna do Módulo
  const [activeTab, setActiveTab] = useState<'creatives' | 'materials' | 'performance'>('creatives');

  // Dados de Criativos e Produtos
  const [offers, setOffers] = useState<Offer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tenantOrders, setTenantOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal do Editor
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Offer | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 1. DESTINO DO CARD
  const [destinationType, setDestinationType] = useState<CardDestination>('BANNER_ONLY');
  const [selectedProductId, setSelectedProductId] = useState<string>('');

  // 2. MODELO E SOBREPOSIÇÕES
  const [cardModel, setCardModel] = useState<PromoCardModel>('HERO');
  const [autoOverlay, setAutoOverlay] = useState<boolean>(true);
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

  // --------------------------------------------------------------------------
  // CARREGAR DADOS
  // --------------------------------------------------------------------------
  const loadData = useCallback(async () => {
    if (!activeTenant?.id) return;
    setIsLoading(true);
    try {
      const [offersData, prodsData, ordersData] = await Promise.all([
        offerRepository.getOffers(securityContext, activeTenant.id),
        productRepository.getProducts(securityContext, activeTenant.id),
        orderRepository.getOrders(securityContext, activeTenant.id).catch(() => []),
      ]);
      setOffers(offersData);
      setProducts(prodsData);
      setTenantOrders(ordersData);
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
    setAutoOverlay(true);
    setDisplayMode('FULL_MEDIA');
    setDestinationType('BANNER_ONLY');
    setSelectedProductId('');
    
    // Mídia Padrão
    setMediaType('IMAGE');
    setMediaSourceMode('upload');
    const defaultUrl = 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&auto=format&fit=crop&q=80';
    setMediaUrl(defaultUrl);
    inspectMedia(defaultUrl, 'IMAGE');

    // Textos e Rotação
    setTitle('Oferta Especial da Casa');
    setSubtitle('Aproveite as condições especiais por tempo limitado');
    setBadge('DESTAQUE');
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
    setCardModel(card.cardModel || 'HERO');
    setAutoOverlay(card.autoOverlay !== undefined ? card.autoOverlay : (card.displayMode !== 'FULL_MEDIA'));
    setDisplayMode(card.displayMode || 'FULL_MEDIA');
    
    // Destino
    const dest = card.destinationType || (card.hasPromoCheckout ? 'CUSTOM_OFFER' : card.productId ? 'PRODUCT' : 'BANNER_ONLY');
    setDestinationType(dest);
    setSelectedProductId(card.productId || '');

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

    // Textos
    setTitle(card.title || '');
    setSubtitle(card.subtitle || '');
    setBadge(card.badge || 'PROMOÇÃO');

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
    setPromoFulfillmentTypes(card.promoFulfillmentTypes || ['DELIVERY', 'PICKUP']);
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
      if (promoFulfillmentTypes.length === 0) {
        showToast({
          type: 'error',
          title: 'Entrega Obrigatória',
          message: 'Selecione pelo menos um tipo de entrega permitido (Entrega ou Retirada).',
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
        title: title.trim(),
        subtitle: subtitle.trim() || undefined,
        description: (destinationType === 'CUSTOM_OFFER' ? promoDescription : subtitle) || '',
        badge: badge.trim() || undefined,
        cardFormat: 'HORIZONTAL',
        mediaType,
        displayMode: autoOverlay ? 'EDITABLE_CARD' : 'FULL_MEDIA',
        cardModel,
        autoOverlay,
        destinationType,
        mediaUrl: finalPublicMediaUrl,
        imageUrl: finalPublicMediaUrl,
        durationSeconds: finalDuration,
        videoDuration: mediaType === 'VIDEO' ? (detectedVideoDuration || 10) : undefined,
        detectedWidth: detectedWidth || 1200,
        detectedHeight: detectedHeight || 675,
        aspectRatio: '16:9',
        productId: destinationType === 'PRODUCT' ? selectedProductId : undefined,
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
        promoFulfillmentTypes: destinationType === 'CUSTOM_OFFER' ? promoFulfillmentTypes : ['DELIVERY', 'PICKUP'],
        promoPaymentMethods: destinationType === 'CUSTOM_OFFER' ? promoPaymentMethods : ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'CASH'],
        promoCouponCode: destinationType === 'CUSTOM_OFFER' && promoCouponCode ? promoCouponCode.trim().toUpperCase() : undefined,
        promoUsageLimit: destinationType === 'CUSTOM_OFFER' ? parsedUsageLimit : undefined,
        promoTimesUsed: editingCard?.promoTimesUsed || 0,

        // Compatibilidade de Preço
        promotionalPrice: destinationType === 'CUSTOM_OFFER' ? parsedPromoPrice : undefined,
        originalPrice: destinationType === 'CUSTOM_OFFER' ? parsedPromoOrigPrice : undefined,
        discountPercentage: destinationType === 'CUSTOM_OFFER' ? parsedDiscountPct : undefined,

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

  // --------------------------------------------------------------------------
  // MÉTRICAS E DESEMPENHO REAL DAS PROMOÇÕES
  // --------------------------------------------------------------------------
  const promoMetrics = useMemo(() => {
    const promoOrders = tenantOrders.filter(o => o.origin === 'promotional_checkout' || o.offerId);
    const totalRevenue = promoOrders.reduce((acc, o) => acc + (o.totalAmount || 0), 0);
    const totalOrders = promoOrders.length;
    const totalDiscounts = promoOrders.reduce((acc, o) => acc + (o.discount || 0), 0);
    const limitedCards = offers.filter(o => o.promoUsageLimit && o.promoUsageLimit > 0);
    const totalRedemptions = offers.reduce((acc, o) => acc + (o.promoTimesUsed || 0), 0);

    return {
      totalOrders,
      totalRevenue,
      totalDiscounts,
      limitedCardsCount: limitedCards.length,
      totalRedemptions,
      averageTicket: totalOrders > 0 ? (totalRevenue / totalOrders) : 0,
    };
  }, [tenantOrders, offers]);

  if (!activeTenant) return null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Header do Módulo */}
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
          onClick={() => setActiveTab('creatives')}
          className={`pb-3 px-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'creatives'
              ? 'border-emerald-600 text-emerald-800'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Criativos da Vitrine</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
            {activeCount} ativos
          </span>
        </button>

        <button
          onClick={() => setActiveTab('performance')}
          className={`pb-3 px-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'performance'
              ? 'border-emerald-600 text-emerald-800'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Desempenho & Vendas</span>
        </button>

        <button
          onClick={() => setActiveTab('materials')}
          className={`pb-3 px-3 text-sm font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
            activeTab === 'materials'
              ? 'border-emerald-600 text-emerald-800'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <QrCode className="w-4 h-4" />
          <span>Materiais & QR Code</span>
        </button>
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

                      {/* Gradiente escuro se tiver autoOverlay */}
                      {card.autoOverlay !== false && card.displayMode !== 'FULL_MEDIA' && (
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
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

                        {card.autoOverlay === false && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-black/70 border border-white/30">
                            Arte Pura
                          </span>
                        )}
                      </div>

                      {isVideo && (
                        <div className="absolute w-10 h-10 rounded-full bg-white/30 backdrop-blur-md flex items-center justify-center text-white border border-white/40 shadow-lg pointer-events-none">
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        </div>
                      )}
                    </div>

                    {/* Detalhes do Card */}
                    <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-bold text-gray-900 line-clamp-1">{card.title}</h4>
                          <span className="text-[11px] font-mono text-gray-400 shrink-0">#{idx + 1}</span>
                        </div>

                        {card.subtitle && (
                          <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                            {card.subtitle}
                          </p>
                        )}

                        {/* Bloco de Valores (se houver checkout promocional) */}
                        {destType === 'CUSTOM_OFFER' && (
                          <div className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-[11px] font-bold text-amber-900">Preço da Oferta:</span>
                              <div className="flex items-center gap-1.5 font-mono">
                                {card.promoPrice && (
                                  <span className="font-extrabold text-amber-800 text-sm">
                                    R$ {card.promoPrice.toFixed(2)}
                                  </span>
                                )}
                                {card.promoOriginalPrice && (
                                  <span className="line-through text-gray-400 text-xs">
                                    R$ {card.promoOriginalPrice.toFixed(2)}
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
        <div className="space-y-6">
          {/* Cards de Métricas Reais */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 space-y-2 border-emerald-100 bg-emerald-50/40">
              <div className="flex items-center justify-between text-emerald-800">
                <span className="text-xs font-bold uppercase tracking-wider">Pedidos via Promoção</span>
                <ShoppingCart className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black font-mono text-gray-900">
                {promoMetrics.totalOrders}
              </div>
              <p className="text-[11px] text-gray-500">Pedidos gerados diretamente por cards promocionais</p>
            </Card>

            <Card className="p-4 space-y-2 border-blue-100 bg-blue-50/40">
              <div className="flex items-center justify-between text-blue-800">
                <span className="text-xs font-bold uppercase tracking-wider">Faturamento Promocional</span>
                <DollarSign className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black font-mono text-gray-900">
                R$ {promoMetrics.totalRevenue.toFixed(2)}
              </div>
              <p className="text-[11px] text-gray-500">Receita bruta proveniente de campanhas</p>
            </Card>

            <Card className="p-4 space-y-2 border-amber-100 bg-amber-50/40">
              <div className="flex items-center justify-between text-amber-800">
                <span className="text-xs font-bold uppercase tracking-wider">Benefícios Resgatados</span>
                <Flame className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black font-mono text-gray-900">
                {promoMetrics.totalRedemptions}
              </div>
              <p className="text-[11px] text-gray-500">Resgates atômicos em promoções com limite</p>
            </Card>

            <Card className="p-4 space-y-2 border-purple-100 bg-purple-50/40">
              <div className="flex items-center justify-between text-purple-800">
                <span className="text-xs font-bold uppercase tracking-wider">Ticket Médio</span>
                <TrendingUp className="w-4 h-4" />
              </div>
              <div className="text-2xl font-black font-mono text-gray-900">
                R$ {promoMetrics.averageTicket.toFixed(2)}
              </div>
              <p className="text-[11px] text-gray-500">Valor médio por compra promocional</p>
            </Card>
          </div>

          {/* Tabela de Campanhas & Pedidos */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-600" />
                <span>Desempenho por Card / Oferta</span>
              </h3>
              <span className="text-xs text-gray-500 font-mono">
                {offers.length} cards cadastrados
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider">
                    <th className="pb-3">Card / Oferta</th>
                    <th className="pb-3">Destino</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Preço</th>
                    <th className="pb-3">Usos / Limite</th>
                    <th className="pb-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {offers.map(card => {
                    const status = calculatePromoCardStatus(card);
                    const statusMeta = getPromoStatusMeta(status);
                    const dest = card.destinationType || (card.hasPromoCheckout ? 'CUSTOM_OFFER' : card.productId ? 'PRODUCT' : 'BANNER_ONLY');

                    return (
                      <tr key={card.id} className="hover:bg-gray-50">
                        <td className="py-3 font-semibold text-gray-900 flex items-center gap-2">
                          <span className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                            {card.mediaUrl ? (
                              <img src={card.mediaUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="w-full h-full flex items-center justify-center text-gray-400">🖼️</span>
                            )}
                          </span>
                          <span className="line-clamp-1">{card.title}</span>
                        </td>
                        <td className="py-3 font-medium">
                          {dest === 'CUSTOM_OFFER' ? (
                            <span className="text-amber-800 font-bold">Checkout Próprio</span>
                          ) : dest === 'PRODUCT' ? (
                            <span className="text-blue-800 font-bold">Produto</span>
                          ) : (
                            <span className="text-gray-600">Visual</span>
                          )}
                        </td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${statusMeta.badgeClass}`}>
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="py-3 font-mono font-bold text-gray-900">
                          {card.promoPrice ? `R$ ${card.promoPrice.toFixed(2)}` : (card.promotionalPrice ? `R$ ${card.promotionalPrice.toFixed(2)}` : '—')}
                        </td>
                        <td className="py-3 font-mono">
                          {card.promoUsageLimit ? `${card.promoTimesUsed || 0} / ${card.promoUsageLimit}` : 'Ilimitado'}
                        </td>
                        <td className="py-3 text-right">
                          <Button size="sm" variant="outline" onClick={() => handleOpenEdit(card)}>
                            Editar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ==================================================================== */}
      {/* ABA 3: MATERIAIS & QR CODE OFICIAL (PRESERVADA 100%)                  */}
      {/* ==================================================================== */}
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
          size="xl"
        >
          <form onSubmit={handleSaveCard} className="space-y-6">
            {/* ============================================================== */}
            {/* SEÇÃO 1: DESTINO DO CARD (REGRA PRINCIPAL)                     */}
            {/* ============================================================== */}
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3">
              <label className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-emerald-600" />
                <span>1. Destino do Card (O que acontece ao clicar?)</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* MODO 1: APENAS VISUAL */}
                <div
                  onClick={() => {
                    setDestinationType('BANNER_ONLY');
                    setHasPromoCheckout(false);
                  }}
                  className={`p-3.5 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-2.5 ${
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
                    O card apenas apresenta a imagem ou vídeo sem abrir produtos ou checkout.
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
                  className={`p-3.5 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-2.5 ${
                    destinationType === 'PRODUCT'
                      ? 'border-emerald-600 bg-emerald-50/70 shadow-xs'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black tracking-wide text-gray-900">
                      🛒 Produto do Catálogo
                    </span>
                    {destinationType === 'PRODUCT' && (
                      <div className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 leading-snug">
                    Abre o produto existente correspondente para adicionar à sacola normalmente.
                  </p>
                </div>

                {/* MODO 3: CHECKOUT PROMOCIONAL */}
                <div
                  onClick={() => {
                    setDestinationType('CUSTOM_OFFER');
                    setHasPromoCheckout(true);
                  }}
                  className={`p-3.5 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-2.5 ${
                    destinationType === 'CUSTOM_OFFER'
                      ? 'border-amber-600 bg-amber-50/70 shadow-xs'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black tracking-wide text-amber-950 flex items-center gap-1">
                      ⚡ Checkout Promocional
                    </span>
                    {destinationType === 'CUSTOM_OFFER' && (
                      <div className="w-4 h-4 rounded-full bg-amber-600 text-white flex items-center justify-center">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-amber-800/90 leading-snug">
                    Oferta completa com checkout próprio, regras, cupons e limites (não precisa de produto no catálogo).
                  </p>
                </div>
              </div>

              {/* Seletor de Produto do Catálogo se MODO 2 */}
              {destinationType === 'PRODUCT' && (
                <div className="pt-2 border-t border-gray-200 space-y-1.5">
                  <label className="text-xs font-bold text-gray-700 block">
                    Selecione o Produto Vinculado da Loja:
                  </label>
                  <select
                    value={selectedProductId}
                    onChange={(e) => {
                      setSelectedProductId(e.target.value);
                      const prod = products.find(p => p.id === e.target.value);
                      if (prod) {
                        if (!title || title === 'Oferta Especial da Casa') setTitle(prod.name);
                        if (!mediaUrl && prod.imageUrl) {
                          setMediaUrl(prod.imageUrl);
                          inspectMedia(prod.imageUrl, 'IMAGE');
                        }
                      }
                    }}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-emerald-500 font-medium"
                    required
                  >
                    <option value="">Selecione um produto do catálogo...</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} — R$ {p.price.toFixed(2)} ({p.unit || 'un'})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* ============================================================== */}
            {/* SEÇÃO 2: TRÊS MODELOS PROFISSIONAIS (1200 x 675 px — 16:9)     */}
            {/* ============================================================== */}
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-600" />
                <span>2. Modelo do Card (1200 × 675 px — 16:9)</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {PROMO_CARD_MODELS.map((model) => {
                  const isSelected = cardModel === model.id;
                  return (
                    <div
                      key={model.id}
                      onClick={() => setCardModel(model.id)}
                      className={`p-3.5 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-2.5 ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50/50 shadow-xs'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-md">
                          {model.badge}
                        </span>
                        {isSelected && (
                          <div className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <h4 className="text-xs font-black text-gray-900 leading-snug">
                          {model.name}
                        </h4>
                        <div className="font-mono text-[11px] font-bold text-emerald-800">
                          {model.tagline}
                        </div>
                        <p className="text-[11px] text-gray-500 leading-snug">
                          {model.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Dica para Criação de Arte com IA */}
              <div className="p-3.5 bg-emerald-50/80 border border-emerald-200/80 rounded-2xl space-y-1 text-xs text-emerald-950">
                <div className="flex items-center gap-1.5 font-bold uppercase tracking-wide">
                  <Lightbulb className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Dica para Criar sua Arte com IA</span>
                </div>
                <p className="text-[11px] text-emerald-900/90 leading-relaxed">
                  Para obter a melhor qualidade, gere sua imagem ou vídeo em <strong>1200 × 675 px (proporção 16:9)</strong>. Use exatamente essa resolução para evitar cortes ou deformações na vitrine.
                </p>
              </div>
            </div>

            {/* ============================================================== */}
            {/* SEÇÃO 3: ELEMENTOS AUTOMÁTICOS [ ON / OFF ]                     */}
            {/* ============================================================== */}
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-emerald-600" />
                  <span>3. Elementos Automáticos Sobrepostos</span>
                </div>
                <p className="text-[11px] text-gray-500 max-w-lg leading-relaxed">
                  Quando <strong>OFF</strong>, o sistema exibe <strong>somente o arquivo original</strong> sem textos, títulos, preços ou botões por cima. Ideal para artes finalizadas criadas em IA.
                </p>
              </div>

              <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-gray-200 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setAutoOverlay(true);
                    setDisplayMode('EDITABLE_CARD');
                  }}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    autoOverlay ? 'bg-emerald-600 text-white shadow-2xs' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  ON (Com Textos)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoOverlay(false);
                    setDisplayMode('FULL_MEDIA');
                  }}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    !autoOverlay ? 'bg-emerald-600 text-white shadow-2xs' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  OFF (Arte Pura)
                </button>
              </div>
            </div>

            {/* ============================================================== */}
            {/* SEÇÃO 4: UPLOAD DE MÍDIA (IMAGEM OU VÍDEO)                      */}
            {/* ============================================================== */}
            <div className="space-y-3 p-4 bg-gray-50 rounded-2xl border border-gray-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <label className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5 text-emerald-600" />
                    <span>4. Mídia Promocional (1200 × 675 px — 16:9)</span>
                  </label>
                  <p className="text-[11px] text-gray-500">
                    Formatos: JPG, JPEG, PNG, WEBP, MP4 ou WEBM
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
                  <label className="w-full flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-300 hover:border-emerald-500 rounded-2xl cursor-pointer bg-white transition-colors">
                    <Upload className="w-6 h-6 text-gray-400 mb-1" />
                    <span className="text-xs font-bold text-gray-700">Clique para selecionar imagem ou vídeo</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">Até 35MB para vídeo e 10MB para imagem</span>
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
                <div className="p-3 bg-white border border-gray-200 rounded-xl space-y-1 text-xs text-gray-700 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900">
                      {mediaType === 'VIDEO' ? '🎥 Arquivo de Vídeo' : '🖼️ Imagem Estática'}
                    </span>
                    {detectedWidth && detectedHeight && (
                      <span className="font-mono text-gray-500 text-[11px]">
                        ({detectedWidth} × {detectedHeight} px)
                      </span>
                    )}
                  </div>

                  {mediaType === 'VIDEO' && detectedVideoDuration && (
                    <span className="font-mono font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                      Duração real: {detectedVideoDuration}s
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* ============================================================== */}
            {/* SEÇÃO 5: CHECKOUT DA PROMOÇÃO (MODO 3 - DESTAQUE ABSOLUTO)      */}
            {/* ============================================================== */}
            {destinationType === 'CUSTOM_OFFER' && (
              <div className="p-4 bg-amber-50/60 rounded-2xl border-2 border-amber-300/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-amber-600 text-white shadow-2xs">
                      <Flame className="w-4 h-4" />
                    </span>
                    <div>
                      <h3 className="text-sm font-black text-amber-950 uppercase tracking-wide">
                        5. Configuração do Checkout da Promoção
                      </h3>
                      <p className="text-[11px] text-amber-800">
                        O cliente poderá comprar esta promoção diretamente sem precisar de produto no catálogo.
                      </p>
                    </div>
                  </div>
                  <Badge variant="warning" size="sm">Validação Server-Side</Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Nome do Produto / Oferta *"
                    value={promoTitle}
                    onChange={(e) => setPromoTitle(e.target.value)}
                    placeholder="Ex: Combo Especial 2 Garrafas + Petisco"
                    required={destinationType === 'CUSTOM_OFFER'}
                  />

                  <Input
                    label="Unidade de Medida"
                    value={promoUnit}
                    onChange={(e) => setPromoUnit(e.target.value)}
                    placeholder="Ex: combo, un, kit, garrafa"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-700 block">
                    Descrição Completa da Oferta *
                  </label>
                  <textarea
                    value={promoDescription}
                    onChange={(e) => setPromoDescription(e.target.value)}
                    placeholder="Descreva detalhadamente o que está incluso, regras de consumo ou entrega..."
                    rows={2}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-amber-500 font-medium"
                    required={destinationType === 'CUSTOM_OFFER'}
                  />
                </div>

                {/* Preços e Desconto */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input
                    label="Preço Normal / De (R$)"
                    type="number"
                    step="0.01"
                    value={promoOriginalPrice}
                    onChange={(e) => handlePromoPriceChange(e.target.value, promoPrice)}
                    placeholder="Ex: 59.90"
                  />

                  <Input
                    label="Preço Promocional / Por (R$) *"
                    type="number"
                    step="0.01"
                    value={promoPrice}
                    onChange={(e) => handlePromoPriceChange(promoOriginalPrice, e.target.value)}
                    placeholder="Ex: 44.90"
                    required={destinationType === 'CUSTOM_OFFER'}
                  />

                  <Input
                    label="% de Desconto"
                    type="number"
                    value={promoDiscountPercentage}
                    onChange={(e) => setPromoDiscountPercentage(e.target.value)}
                    placeholder="Ex: 25"
                  />
                </div>

                {/* Quantidades e Limites */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input
                    label="Quantidade Mínima"
                    type="number"
                    min={1}
                    value={promoMinQuantity}
                    onChange={(e) => setPromoMinQuantity(e.target.value)}
                    placeholder="Ex: 1"
                  />

                  <Input
                    label="Máximo por Cliente"
                    type="number"
                    min={1}
                    value={promoMaxQuantityPerCustomer}
                    onChange={(e) => setPromoMaxQuantityPerCustomer(e.target.value)}
                    placeholder="Ex: 5"
                  />

                  <Input
                    label="Limite de Usos (Ex: 20 primeiros)"
                    type="number"
                    min={1}
                    value={promoUsageLimit}
                    onChange={(e) => setPromoUsageLimit(e.target.value)}
                    placeholder="Vazio = Sem limite"
                  />
                </div>

                {/* Opções de Entrega e Pagamento */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-amber-200">
                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-gray-700 block">
                      Tipos de Entrega Permitidos:
                    </span>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={promoFulfillmentTypes.includes('DELIVERY')}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPromoFulfillmentTypes(prev => [...prev, 'DELIVERY']);
                            } else {
                              setPromoFulfillmentTypes(prev => prev.filter(t => t !== 'DELIVERY'));
                            }
                          }}
                          className="rounded text-amber-600 focus:ring-amber-500"
                        />
                        <span>Entrega (Delivery)</span>
                      </label>

                      <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={promoFulfillmentTypes.includes('PICKUP')}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPromoFulfillmentTypes(prev => [...prev, 'PICKUP']);
                            } else {
                              setPromoFulfillmentTypes(prev => prev.filter(t => t !== 'PICKUP'));
                            }
                          }}
                          className="rounded text-amber-600 focus:ring-amber-500"
                        />
                        <span>Retirada no Balcão</span>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-gray-700 block">
                      Cupom de Desconto Vinculado (Opcional):
                    </span>
                    <Input
                      placeholder="Ex: SABADO20"
                      value={promoCouponCode}
                      onChange={(e) => setPromoCouponCode(e.target.value.toUpperCase())}
                    />
                  </div>
                </div>

                <Input
                  label="Instruções / Observação da Oferta (Exibida no checkout)"
                  value={promoNotes}
                  onChange={(e) => setPromoNotes(e.target.value)}
                  placeholder="Ex: Validade exclusiva para o turno da noite ou retirada até 23h."
                />
              </div>
            )}

            {/* ============================================================== */}
            {/* SEÇÃO 6: IDENTIFICAÇÃO E COMPOSIÇÃO DE TEXTOS                  */}
            {/* ============================================================== */}
            <div className="space-y-3">
              <Input
                label="Identificação Interna / Nome do Card *"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Super Oferta de Sábado"
                required
              />

              {autoOverlay && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-200">
                  <Input
                    label="Etiqueta / Badge Superior"
                    value={badge}
                    onChange={(e) => setBadge(e.target.value)}
                    placeholder="Ex: SUPER OFERTA, DESTAQUE"
                  />
                  <Input
                    label="Subtítulo Sobreposto"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    placeholder="Ex: Compre 2 e ganhe 1 taça especial"
                  />
                </div>
              )}
            </div>

            {/* ============================================================== */}
            {/* SEÇÃO 7: AGENDAMENTO COMPLETO (DATA + HORÁRIO)                 */}
            {/* ============================================================== */}
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                  <CalendarDays className="w-3.5 h-3.5 text-emerald-600" />
                  <span>6. Programar Período de Exibição</span>
                </label>
                <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200">
                  Fuso Horário: Brasília (America/Sao_Paulo)
                </span>
              </div>

              {/* Início */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-gray-700">INÍCIO DA EXIBIÇÃO</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Data de início</label>
                    <Input
                      type="date"
                      value={startDateInput}
                      onChange={(e) => setStartDateInput(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Horário de início</label>
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
              <div className="space-y-2 pt-2 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-700">TÉRMINO DA EXIBIÇÃO</span>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-emerald-800">
                    <input
                      type="checkbox"
                      checked={noEndDate}
                      onChange={(e) => setNoEndDate(e.target.checked)}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                    />
                    <span>Sem data de término (permanece ativo até desativação)</span>
                  </label>
                </div>

                {!noEndDate ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Data de término</label>
                      <Input
                        type="date"
                        value={endDateInput}
                        onChange={(e) => setEndDateInput(e.target.value)}
                        required={!noEndDate}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-gray-500 mb-1 block">Horário de término</label>
                      <Input
                        type="time"
                        value={endTimeInput}
                        onChange={(e) => setEndTimeInput(e.target.value)}
                        required={!noEndDate}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-white border border-gray-200 rounded-xl text-xs text-gray-600 italic">
                    Card configurado sem data de término. Ele permanecerá em exibição contínua na vitrine até ser desativado manualmente.
                  </div>
                )}
              </div>

              {/* Box de Resumo Visual em Tempo Real */}
              <div className={`p-4 rounded-xl border space-y-2.5 transition-colors ${formStatusMeta.cardBorderClass}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold tracking-wide uppercase flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>📅 Período de Exibição</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold border shadow-2xs ${formStatusMeta.badgeClass}`}>
                    {formStatusMeta.fullLabel}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-semibold text-gray-500 block">Início:</span>
                    <span className="font-mono font-bold text-gray-900">
                      {computedStartIso ? formatPromoDateTimeBr(computedStartIso) : 'Aguardando data/horário...'}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-semibold text-gray-500 block">Término:</span>
                    <span className="font-mono font-bold text-gray-900">
                      {noEndDate 
                        ? 'Indeterminado (Sem data de término)' 
                        : (computedEndIso ? formatPromoDateTimeBr(computedEndIso) : 'Aguardando data/horário...')}
                    </span>
                  </div>
                </div>

                <div className="pt-1.5 border-t border-black/10 text-xs font-medium leading-relaxed">
                  {formStatusMeta.summaryText}
                </div>
              </div>
            </div>

            {/* ============================================================== */}
            {/* SEÇÃO 8: TEMPO DE ROTAÇÃO                                       */}
            {/* ============================================================== */}
            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3">
              <label className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-600" />
                <span>7. Tempo de Rotação do Carrossel</span>
              </label>

              {mediaType === 'VIDEO' ? (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Film className="w-4 h-4 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-bold">
                        Duração do vídeo: {detectedVideoDuration ? `${detectedVideoDuration} segundos` : 'Detectando...'}
                      </span>
                      <p className="text-[11px] text-blue-800">
                        O card respeitará a duração real do arquivo de vídeo. O carrossel avançará automaticamente ao término da reprodução.
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 font-mono font-black text-sm bg-white rounded-lg border border-blue-200 text-blue-950 shrink-0">
                    {detectedVideoDuration ? `${detectedVideoDuration}s` : 'Auto'}
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
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
                        {sec} segundos
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

            {/* ============================================================== */}
            {/* SEÇÃO 9: PRÉ-VISUALIZAÇÃO EM TEMPO REAL                        */}
            {/* ============================================================== */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-emerald-600" />
                <span>8. Pré-visualização em Tempo Real (16:9)</span>
              </label>

              <div className="p-4 bg-gray-950 rounded-3xl flex items-center justify-center overflow-hidden">
                <div className="w-full max-w-md aspect-16/9 rounded-2xl overflow-hidden relative flex items-center justify-center bg-black shadow-2xl">
                  {mediaType === 'VIDEO' && mediaUrl ? (
                    <video
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
                      alt="Preview Arte"
                      className="w-full h-full object-cover object-center"
                    />
                  ) : (
                    <div className="text-white/40 text-xs">Selecione uma imagem ou vídeo para visualizar</div>
                  )}

                  {/* Overlays apenas se autoOverlay for TRUE */}
                  {autoOverlay && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent flex flex-col justify-end p-4 text-white">
                      {badge && (
                        <span className="self-start px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/20 backdrop-blur-md border border-white/30 mb-1">
                          {badge}
                        </span>
                      )}
                      <h3 className="text-base font-black leading-tight drop-shadow-md">
                        {destinationType === 'CUSTOM_OFFER' && promoTitle ? promoTitle : (title || 'Título do Card')}
                      </h3>
                      {subtitle && (
                        <p className="text-xs text-white/90 line-clamp-1 mt-0.5">
                          {subtitle}
                        </p>
                      )}

                      {destinationType === 'CUSTOM_OFFER' && promoPrice && (
                        <div className="flex items-center gap-2 pt-1 font-mono">
                          <span className="text-base font-extrabold text-amber-300">
                            R$ {parseFloat(promoPrice).toFixed(2)}
                          </span>
                          {promoOriginalPrice && (
                            <span className="text-xs line-through text-white/70">
                              R$ {parseFloat(promoOriginalPrice).toFixed(2)}
                            </span>
                          )}
                          {promoDiscountPercentage && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400 text-gray-950 font-black">
                              {promoDiscountPercentage}% OFF
                            </span>
                          )}
                        </div>
                      )}

                      <div className="pt-2">
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold shadow-sm">
                          {destinationType === 'CUSTOM_OFFER' ? '⚡ Comprar Agora' : 'Aproveitar Oferta'}
                          <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  )}
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

                {/* Overlays somente se autoOverlay estiver ativo */}
                {previewingCard.autoOverlay !== false && previewingCard.displayMode !== 'FULL_MEDIA' && (
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent flex flex-col justify-end p-5 text-white pointer-events-none">
                    {previewingCard.badge && (
                      <span className="self-start px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-white/20 backdrop-blur-md border border-white/30 mb-1">
                        {previewingCard.badge}
                      </span>
                    )}
                    <h3 className="text-lg font-black leading-tight drop-shadow-md">
                      {previewingCard.destinationType === 'CUSTOM_OFFER' && previewingCard.promoTitle
                        ? previewingCard.promoTitle
                        : previewingCard.title}
                    </h3>
                    {previewingCard.subtitle && (
                      <p className="text-xs text-white/90 line-clamp-2 mt-1">
                        {previewingCard.subtitle}
                      </p>
                    )}
                    {(previewingCard.promoPrice || previewingCard.promotionalPrice) && (
                      <div className="flex items-center gap-2 pt-2 font-mono">
                        <span className="text-base font-extrabold text-amber-300">
                          R$ {(previewingCard.promoPrice || previewingCard.promotionalPrice)?.toFixed(2)}
                        </span>
                        {(previewingCard.promoOriginalPrice || previewingCard.originalPrice) && (
                          <span className="text-xs line-through text-white/70">
                            R$ {(previewingCard.promoOriginalPrice || previewingCard.originalPrice)?.toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
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
