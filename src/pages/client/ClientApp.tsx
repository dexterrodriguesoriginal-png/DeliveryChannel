import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { publicStoreRepository, PublicStoreData } from '../../repositories/publicStoreRepository';
import { orderRepository } from '../../repositories/orderRepository';
import { customerRepository } from '../../repositories/customerRepository';
import { orderService } from '../../services/orderService';
import { OfferCarousel } from '../../components/common/OfferCarousel';
import { MobileNavigation } from '../../components/layout/MobileNavigation';
import { AddressAutocompleteInput, ParsedAddress } from '../../components/onboarding/AddressAutocompleteInput';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Product, CustomerOrigin, Order, Offer, OrderStatus, TenantTheme } from '../../types';
import { 
  Search, 
  ShoppingBag, 
  Plus, 
  Minus, 
  Clock, 
  MapPin, 
  CheckCircle2, 
  ArrowRight, 
  Sparkles,
  User as UserIcon,
  Tag,
  Store,
  Phone,
  ArrowLeft,
  Bike,
  Building,
  CreditCard,
  QrCode,
  Copy,
  AlertCircle,
  MessageCircle,
  FileText,
  XCircle,
  Check,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Lock,
  UserCheck,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  RotateCcw
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

interface CartItem {
  product: Product;
  quantity: number;
  notes?: string;
}

const GoogleIcon: React.FC = () => (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

export const ClientApp: React.FC<{ forcedSlug?: string }> = ({ forcedSlug }) => {
  const { supabaseUser, signInWithGoogle, signInWithPassword, signUp, signOut } = useAuth();
  const { showToast } = useToast();

  // 1. Extração estrita do Slug da URL
  const slug = useMemo(() => {
    if (forcedSlug) return forcedSlug;
    const path = window.location.pathname;
    if (path.startsWith('/app/')) {
      return path.replace('/app/', '').split('/')[0];
    }
    return '';
  }, [forcedSlug]);

  // 2. Estados de Carregamento e Dados do Catálogo Real
  const [storeData, setStoreData] = useState<PublicStoreData | null>(null);
  const [isLoadingStore, setIsLoadingStore] = useState(true);
  const [storeNotFound, setStoreNotFound] = useState(false);

  // 3. Estados de Navegação e Filtros
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [navTab, setNavTab] = useState<'home' | 'orders' | 'cart' | 'account'>('home');
  const [selectedProductModal, setSelectedProductModal] = useState<Product | null>(null);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);

  // 4. Carrinho estritamente isolado pelo tenant.id real
  const [cart, setCart] = useState<CartItem[]>([]);

  // 5. Histórico e Pedidos do Cliente
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [customerOrdersError, setCustomerOrdersError] = useState<string | null>(null);

  // 6. Modais
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // 7. Autenticação do Cliente no Checkout
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // 8. Form de Checkout
  const [customerName, setCustomerName] = useState(() => localStorage.getItem('adegafood_cust_name') || '');
  const [customerPhone, setCustomerPhone] = useState(() => localStorage.getItem('adegafood_cust_phone') || '');
  const [fulfillmentType, setFulfillmentType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');

  // Endereço de entrega com Google Places
  const [streetAddress, setStreetAddress] = useState(() => localStorage.getItem('adegafood_cust_street') || '');
  const [addressNumber, setAddressNumber] = useState(() => localStorage.getItem('adegafood_cust_number') || '');
  const [neighborhood, setNeighborhood] = useState(() => localStorage.getItem('adegafood_cust_neighborhood') || '');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [complement, setComplement] = useState('');
  const [reference, setReference] = useState('');
  const [formattedAddress, setFormattedAddress] = useState('');
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [placeId, setPlaceId] = useState<string | undefined>();

  // Pagamento e Observações
  const [paymentMethod, setPaymentMethod] = useState<'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'CASH'>('PIX');
  const [cashChange, setCashChange] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [origin] = useState<CustomerOrigin>('qr_code');

  // Submissão do Pedido
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [copiedPix, setCopiedPix] = useState(false);

  // --------------------------------------------------------------------------
  // CARREGAR CATÁLOGO REAL DO ESTABELECIMENTO PELO SLUG (SEM FALLBACK MOCK)
  // --------------------------------------------------------------------------
  const loadStore = useCallback(async () => {
    if (!slug) {
      setStoreData(null);
      setStoreNotFound(true);
      setIsLoadingStore(false);
      return;
    }

    setIsLoadingStore(true);
    setStoreNotFound(false);

    try {
      const data = await publicStoreRepository.getPublicStore(slug);
      if (data && data.tenant) {
        setStoreData(data);
        // Carrega carrinho específico deste estabelecimento
        try {
          const savedCart = localStorage.getItem(`adegafood_cart_${data.tenant.id}`);
          if (savedCart) setCart(JSON.parse(savedCart));
          else setCart([]);
        } catch {
          setCart([]);
        }
      } else {
        setStoreData(null);
        setStoreNotFound(true);
      }
    } catch (err) {
      console.warn('[ClientApp] Erro ao carregar loja por slug:', err);
      setStoreData(null);
      setStoreNotFound(true);
    } finally {
      setIsLoadingStore(false);
    }
  }, [slug]);

  useEffect(() => {
    loadStore();
  }, [loadStore]);

  // Persistir carrinho no localStorage sob o ID oficial do tenant
  useEffect(() => {
    if (storeData?.tenant.id) {
      try {
        localStorage.setItem(`adegafood_cart_${storeData.tenant.id}`, JSON.stringify(cart));
      } catch {
        // ignore
      }
    }
  }, [cart, storeData?.tenant.id]);

  // Rastreia o usuário e tenant anteriormente sincronizados para evitar limpar pedidos indevidamente
  const prevSyncUserTenantRef = useRef<string | null>(null);

  // Sincronizar dados cadastrais do cliente autenticado e limpar histórico anterior SOMENTE ao trocar de usuário ou tenant
  useEffect(() => {
    const currentKey = `${supabaseUser?.id || 'anon'}_${storeData?.tenant.id || 'none'}`;

    if (prevSyncUserTenantRef.current !== currentKey) {
      prevSyncUserTenantRef.current = currentKey;
      setCustomerOrders([]);
      setCustomerOrdersError(null);
    }

    if (supabaseUser && storeData?.tenant.id) {
      customerRepository.getCustomerByUserId(storeData.tenant.id, supabaseUser.id)
        .then((existingCust) => {
          if (existingCust) {
            setCustomerName(existingCust.name);
            setCustomerPhone(existingCust.phone);
          } else {
            const metaName = supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name;
            if (metaName) setCustomerName(metaName);
          }
        })
        .catch(() => {});
    }
  }, [supabaseUser?.id, storeData?.tenant.id]);

  // Carregar histórico de pedidos do cliente autenticado
  const loadCustomerOrders = useCallback(async () => {
    if (!storeData?.tenant.id || !supabaseUser?.id) {
      setCustomerOrders([]);
      setCustomerOrdersError(null);
      return;
    }

    setIsLoadingOrders(true);
    setCustomerOrdersError(null);
    try {
      const orders = await orderRepository.getCustomerOrders(storeData.tenant.id, supabaseUser.id);
      setCustomerOrders(prev => {
        // Se a busca remota retornou pedidos, mesclamos mantendo qualquer pedido criado localmente
        if (orders && orders.length > 0) {
          const map = new Map<string, Order>();
          // Pedidos remotos têm precedência de status
          orders.forEach(o => map.set(o.id, o));
          // Preserva pedidos locais recentes caso ainda não tenham sido indexados
          prev.forEach(p => {
            if (!map.has(p.id)) map.set(p.id, p);
          });
          return Array.from(map.values()).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        }
        // Se a busca remota retornou vazia mas o cliente tem pedidos no state local deste mesmo tenant, mantém os locais
        const localBelongingToTenant = prev.filter(p => p.tenantId === storeData.tenant.id);
        if (localBelongingToTenant.length > 0) {
          return localBelongingToTenant;
        }
        return orders;
      });
    } catch (err: any) {
      console.warn('[ClientApp] Erro ao carregar pedidos do cliente:', err);
      // Não exibe erro impeditivo se já existirem pedidos carregados em memória
      setCustomerOrders(prev => {
        if (prev.length === 0) {
          setCustomerOrdersError(err.message || 'Falha de comunicação ao consultar seus pedidos.');
        }
        return prev;
      });
    } finally {
      setIsLoadingOrders(false);
    }
  }, [storeData?.tenant.id, supabaseUser?.id]);

  // Repetir um pedido anterior recarregando itens no carrinho
  const handleRepeatOrder = useCallback((order: Order) => {
    if (!order.items || order.items.length === 0) return;
    const newItems: CartItem[] = [];
    order.items.forEach(it => {
      const prod = storeData?.products.find(p => p.id === it.productId);
      if (prod) {
        newItems.push({ product: prod, quantity: it.quantity });
      } else {
        newItems.push({
          product: {
            id: it.productId,
            tenantId: order.tenantId,
            categoryId: 'geral',
            name: it.productName,
            description: '',
            price: it.unitPrice,
            imageUrl: '',
            isAvailable: true,
            isActive: true,
            stockQuantity: 99,
            unit: it.unit || 'un'
          },
          quantity: it.quantity
        });
      }
    });

    if (newItems.length > 0) {
      setCart(newItems);
      setNavTab('home');
      setIsCheckoutOpen(true);
      showToast({
        type: 'success',
        title: 'Itens adicionados!',
        message: 'Os produtos do pedido foram recarregados no seu carrinho.',
      });
    }
  }, [storeData?.products, showToast]);

  useEffect(() => {
    if (navTab === 'orders') {
      loadCustomerOrders();
      // Polling de 8 segundos enquanto estiver visualizando a aba de pedidos
      const interval = setInterval(() => {
        loadCustomerOrders();
      }, 8000);
      return () => clearInterval(interval);
    }
  }, [navTab, loadCustomerOrders]);

  // Tema visual dinâmico do estabelecimento
  const theme: Partial<TenantTheme> = storeData?.theme || {
    primaryColor: '#15803d',
    secondaryColor: '#166534',
    backgroundColor: '#f8fafc',
    cardColor: '#ffffff',
    buttonColor: '#15803d',
    textColor: '#0f172a',
    borderRadius: '1rem',
    fontFamily: 'Inter',
    storeName: '',
    tagline: '',
  };

  const primaryColor = theme.primaryColor || '#15803d';
  const buttonColor = theme.buttonColor || primaryColor;
  const borderRadius = theme.borderRadius || '1rem';

  // --------------------------------------------------------------------------
  // CÁLCULOS DO CARRINHO
  // --------------------------------------------------------------------------
  const cartTotalCount = cart.reduce((acc, item) => acc + item.quantity, 0);

  const subtotal = cart.reduce((acc, item) => {
    const price = item.product.promotionalPrice && item.product.promotionalPrice > 0
      ? item.product.promotionalPrice
      : item.product.price;
    return acc + (price * item.quantity);
  }, 0);

  const freeThreshold = storeData?.settings.freeDeliveryThreshold;
  const isFreeDelivery = fulfillmentType === 'DELIVERY' && 
    Boolean(freeThreshold && subtotal >= freeThreshold);

  const deliveryFee = fulfillmentType === 'PICKUP'
    ? 0
    : (subtotal > 0 ? (isFreeDelivery ? 0 : (storeData?.settings.deliveryFee || 0)) : 0);

  const grandTotal = subtotal + deliveryFee;

  // Normalização de telefone / WhatsApp com máscara brasileira
  const handlePhoneChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) {
      setCustomerPhone(digits);
    } else if (digits.length <= 7) {
      setCustomerPhone(`(${digits.slice(0, 2)}) ${digits.slice(2)}`);
    } else {
      setCustomerPhone(`(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`);
    }
  };

  // Manipulação de Carrinho
  const handleAddToCart = (product: Product) => {
    const isAvailable = product.isAvailable !== undefined ? product.isAvailable : (product.stockQuantity > 0);
    if (!isAvailable) {
      showToast({
        type: 'warning',
        title: 'Produto Esgotado',
        message: `O item "${product.name}" está temporariamente indisponível.`,
      });
      return;
    }

    setCart((prev) => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });

    showToast({
      type: 'success',
      title: 'Adicionado à Sacola',
      message: `${product.name} adicionado com sucesso.`,
    });
  };

  const handleRemoveFromCart = (productId: string) => {
    setCart((prev) => {
      const existing = prev.find(item => item.product.id === productId);
      if (existing && existing.quantity > 1) {
        return prev.map(item =>
          item.product.id === productId ? { ...item, quantity: item.quantity - 1 } : item
        );
      }
      return prev.filter(item => item.product.id !== productId);
    });
  };

  // --------------------------------------------------------------------------
  // NAVEGAÇÃO E SELEÇÃO DE PRODUTO (OFERTAS & LINKS INTERNOS)
  // --------------------------------------------------------------------------
  const handleSelectProduct = useCallback((targetProductId: string) => {
    if (!storeData) return;

    // Validação estrita de segurança: o produto DEVE pertencer ao mesmo tenant da vitrine
    const product = storeData.products.find(
      p => p.id === targetProductId && p.tenantId === storeData.tenant.id
    );

    if (!product) {
      console.warn(`[ClientApp] Produto ${targetProductId} não encontrado ou não pertence a este estabelecimento.`);
      return;
    }

    if (!product.isActive) {
      console.warn(`[ClientApp] Produto ${targetProductId} está inativo.`);
      return;
    }

    // 1. Abre o modal com os dados detalhados do produto
    setSelectedProductModal(product);

    // 2. Garante que o card esteja acessível na vitrine (limpa busca e ajusta filtro de categoria)
    setSearchTerm('');
    if (activeCategory !== 'ALL' && activeCategory !== product.categoryId) {
      setActiveCategory(product.categoryId);
    }

    // 3. Aplica destaque visual e rolagem suave até o card correspondente
    setHighlightedProductId(product.id);
    setTimeout(() => {
      const el = document.getElementById(`product-${product.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);

    // 4. Desativa o anel de destaque após 4 segundos
    setTimeout(() => {
      setHighlightedProductId(prev => prev === product.id ? null : prev);
    }, 4000);
  }, [storeData, activeCategory]);

  const handleOfferClick = useCallback((offer: Offer) => {
    // Validação de segurança: a oferta deve pertencer exatamente ao tenant atual
    if (offer.tenantId !== storeData?.tenant.id) {
      console.warn(`[ClientApp] Oferta recusada por segurança: tenant mismatch (${offer.tenantId} != ${storeData?.tenant.id})`);
      return;
    }

    let targetProductId = offer.productId;

    // Fallback: extrai do internalLink (?product=UUID) se necessário
    if (!targetProductId && offer.internalLink) {
      const match = offer.internalLink.match(/[?&]product=([a-f0-9-]+)/i);
      if (match && match[1]) {
        targetProductId = match[1];
      }
    }

    if (targetProductId) {
      // Atualiza URL com o productId preservando histórico limpo
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('product', targetProductId);
        window.history.replaceState({}, '', url.toString());
      } catch {
        // Ignora em ambientes restritos
      }

      handleSelectProduct(targetProductId);
    }
  }, [storeData, handleSelectProduct]);

  const handleCloseProductModal = useCallback(() => {
    setSelectedProductModal(null);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('product')) {
        url.searchParams.delete('product');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // Ignora em ambientes restritos
    }
  }, []);

  // Leitura automática do query param ?product={productId} ao carregar a loja
  useEffect(() => {
    if (!storeData) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const queryProductId = params.get('product');
      if (queryProductId) {
        handleSelectProduct(queryProductId);
      }
    } catch {
      // Ignora erro de parsing em ambientes sem window
    }
  }, [storeData, handleSelectProduct]);

  // Filtragem de Produtos
  const filteredProducts = useMemo(() => {
    if (!storeData) return [];
    return storeData.products.filter(p => {
      const matchesCategory = activeCategory === 'ALL' || p.categoryId === activeCategory;
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            p.description.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [storeData, activeCategory, searchTerm]);

  // --------------------------------------------------------------------------
  // AUTENTICAÇÃO DO CLIENTE (GOOGLE OU E-MAIL)
  // --------------------------------------------------------------------------
  const handleGoogleLogin = async () => {
    setIsAuthenticating(true);
    try {
      if (isSupabaseConfigured) {
        await signInWithGoogle({ returnTo: `/app/${slug}`, intent: 'customer' });
      } else {
        showToast({
          type: 'info',
          title: 'Modo Offline / Demonstração',
          message: 'Autenticação simulada no ambiente de testes.',
        });
        setIsAuthModalOpen(false);
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Falha no login com Google',
        message: err.message || 'Não foi possível autenticar com o Google.',
      });
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim() || !authPassword.trim()) {
      showToast({ type: 'warning', title: 'Dados Incompletos', message: 'Preencha e-mail e senha.' });
      return;
    }

    setIsAuthenticating(true);
    try {
      if (authMode === 'login') {
        const res = await signInWithPassword(authEmail.trim(), authPassword);
        if (!res.success) throw new Error(res.error || 'Credenciais inválidas.');
        showToast({ type: 'success', title: 'Login realizado!', message: 'Você está conectado como cliente.' });
        setIsAuthModalOpen(false);
      } else {
        if (!authName.trim()) {
          showToast({ type: 'warning', title: 'Nome obrigatório', message: 'Informe seu nome completo.' });
          setIsAuthenticating(false);
          return;
        }
        const res = await signUp(authEmail.trim(), authPassword, authName.trim(), undefined, { user_type: 'customer' });
        if (!res.success) throw new Error(res.error || 'Falha ao criar conta.');
        showToast({ type: 'success', title: 'Conta criada!', message: 'Sua conta de cliente foi criada com sucesso.' });
        setCustomerName(authName.trim());
        setIsAuthModalOpen(false);
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Erro na autenticação',
        message: err.message || 'Verifique suas credenciais e tente novamente.',
      });
    } finally {
      setIsAuthenticating(false);
    }
  };

  // --------------------------------------------------------------------------
  // FINALIZAR PEDIDO (CHECKOUT COM SUPABASE E ATOMICIDADE REAL)
  // --------------------------------------------------------------------------
  const handleFinishOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeData) return;
    if (isSubmittingOrder) return; // Proteção estrita contra múltiplos envios simultâneos

    // REGRA FUNDAMENTAL: NÃO EXISTE CHECKOUT ANÔNIMO
    if (!supabaseUser) {
      setIsAuthModalOpen(true);
      showToast({
        type: 'warning',
        title: 'Identificação Necessária',
        message: 'Para sua segurança e acompanhamento, entre ou crie sua conta de cliente para finalizar.',
      });
      return;
    }

    if (!customerName.trim()) {
      showToast({
        type: 'warning',
        title: 'Nome Obrigatório',
        message: 'Por favor, informe seu nome completo.',
      });
      return;
    }

    const cleanPhone = customerPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 11) {
      showToast({
        type: 'warning',
        title: 'WhatsApp Inválido',
        message: 'Por favor, informe um número de WhatsApp válido com DDD (ex: 11 98765-4321).',
      });
      return;
    }

    if (fulfillmentType === 'DELIVERY') {
      if (!streetAddress.trim() || !addressNumber.trim()) {
        showToast({
          type: 'warning',
          title: 'Endereço Incompleto',
          message: 'Rua e número são obrigatórios para a entrega em domicílio.',
        });
        return;
      }
    }

    const minOrder = storeData.settings.minOrderValue || 0;
    if (minOrder > 0 && subtotal < minOrder) {
      showToast({
        type: 'warning',
        title: 'Pedido Mínimo',
        message: `O valor mínimo deste estabelecimento é de R$ ${minOrder.toFixed(2)}.`,
      });
      return;
    }

    // Persistir dados do cliente no LocalStorage para conveniência
    try {
      localStorage.setItem('adegafood_cust_name', customerName);
      localStorage.setItem('adegafood_cust_phone', customerPhone);
      if (streetAddress) localStorage.setItem('adegafood_cust_street', streetAddress);
      if (addressNumber) localStorage.setItem('adegafood_cust_number', addressNumber);
      if (neighborhood) localStorage.setItem('adegafood_cust_neighborhood', neighborhood);
    } catch {
      // ignore
    }

    const fullDeliveryAddress = fulfillmentType === 'DELIVERY'
      ? `${streetAddress}, ${addressNumber}${neighborhood ? ` - ${neighborhood}` : ''}${city ? `, ${city}` : ''}${complement ? ` (${complement})` : ''}`
      : `Retirada no Balcão: ${storeData.settings.address}`;

    const notesWithCash = paymentMethod === 'CASH' && cashChange
      ? `${orderNotes ? `${orderNotes} | ` : ''}Troco para: R$ ${cashChange}`
      : orderNotes;

    setIsSubmittingOrder(true);

    try {
      const order = await orderService.createPublic(storeData.tenant.slug, {
        customerName: customerName.trim(),
        customerPhone: `+55${cleanPhone}`,
        customerEmail: supabaseUser.email || undefined,
        deliveryAddress: fullDeliveryAddress,
        addressDetails: {
          street: streetAddress,
          number: addressNumber,
          complement: complement || undefined,
          neighborhood: neighborhood || '',
          city: city || 'São Paulo',
          state: state || 'SP',
          cep: postalCode || undefined,
          reference: reference || undefined,
          formattedAddress: formattedAddress || undefined,
          latitude,
          longitude,
          placeId,
        },
        paymentMethod,
        fulfillmentType,
        notes: notesWithCash,
        origin,
        items: cart.map(item => ({
          productId: item.product.id,
          quantity: item.quantity,
          notes: item.notes,
        })),
      });

      // Limpar carrinho e exibir confirmação
      setCompletedOrder(order);
      setCart([]);
      setIsCheckoutOpen(false);

      // Atualiza imediatamente o estado de pedidos do cliente em memória (sem race condition)
      setCustomerOrders(prev => {
        const exists = prev.some(o => o.id === order.id);
        if (exists) return prev;
        return [order, ...prev];
      });

      showToast({
        type: 'success',
        title: 'Pedido Confirmado!',
        message: `Pedido #${order.orderNumber || order.id.slice(0, 6)} enviado para ${storeData.tenant.name} com sucesso!`,
      });
    } catch (err: any) {
      console.error('[ClientApp] Erro na criação do pedido:', err);
      showToast({
        type: 'error',
        title: 'Não foi possível finalizar seu pedido',
        message: err.message || 'Ocorreu um erro no processamento. Tente novamente.',
      });
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleCopyPix = () => {
    if (!storeData) return;
    const pixCode = `00020126580014br.gov.bcb.pix0136adegafood-${storeData.tenant.slug}-${completedOrder?.orderNumber || '0000'}5204000053039865405${completedOrder?.totalAmount.toFixed(2)}5802BR5913${storeData.tenant.name.substring(0, 13)}6009Sao Paulo62070503***6304`;
    navigator.clipboard.writeText(pixCode);
    setCopiedPix(true);
    showToast({
      type: 'success',
      title: 'Código PIX Copiado!',
      message: 'Abra o app do seu banco e cole o código para efetuar o pagamento.',
    });
    setTimeout(() => setCopiedPix(false), 3000);
  };

  const openWhatsAppContact = (orderNumber?: number) => {
    if (!storeData) return;
    const phone = storeData.settings.phoneWhatsApp || storeData.tenant.phone;
    const cleanPhone = phone.replace(/\D/g, '');
    const message = orderNumber
      ? `Olá! Gostaria de informações sobre meu Pedido #${orderNumber} feito no app do ${storeData.tenant.name}.`
      : `Olá! Tenho uma dúvida sobre o cardápio do ${storeData.tenant.name}.`;
    window.open(`https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  // --------------------------------------------------------------------------
  // ESTADO DE CARREGAMENTO INICIAL DO CATÁLOGO
  // --------------------------------------------------------------------------
  if (isLoadingStore) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="w-14 h-14 rounded-2xl bg-emerald-700 flex items-center justify-center text-white font-black text-xl shadow-md animate-pulse mb-4">
          AF
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
          <span>Carregando cardápio oficial...</span>
        </div>
        <p className="text-xs text-gray-400 mt-1 font-medium font-mono">/app/{slug}</p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // ESTADO 404: ESTABELECIMENTO NÃO ENCONTRADO (SEM FALLBACK MOCK)
  // --------------------------------------------------------------------------
  if (storeNotFound || !storeData) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-gray-200 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
            <Store className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-950">Estabelecimento Não Encontrado</h2>
          <p className="text-xs text-gray-600 leading-relaxed">
            Não encontramos nenhum estabelecimento ativo correspondente ao endereço: <br />
            <strong className="text-gray-900 font-mono text-sm">/app/{slug}</strong>
          </p>
          <p className="text-[11px] text-gray-400">
            Verifique se o link ou QR Code foi gerado corretamente para este estabelecimento comercial.
          </p>
          <div className="pt-2">
            <Button
              className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              Voltar ao Início
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen pb-24 font-sans text-gray-900 transition-colors"
      style={{ 
        backgroundColor: theme.backgroundColor || '#f8fafc',
        fontFamily: theme.fontFamily || 'Inter'
      }}
    >
      {/* Top Header com Marca Oficial do Estabelecimento */}
      <div 
        className="sticky top-0 z-30 shadow-xs px-4 py-3 flex items-center justify-between border-b border-black/5 backdrop-blur-md"
        style={{ backgroundColor: `${theme.cardColor || '#ffffff'}f2` }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {theme.logoUrl ? (
            <img
              src={theme.logoUrl}
              alt={storeData.tenant.name}
              className="w-10 h-10 rounded-xl object-cover border border-gray-200 shadow-2xs"
            />
          ) : (
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-base shadow-xs"
              style={{ backgroundColor: primaryColor }}
            >
              {storeData.tenant.name.substring(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-extrabold text-sm text-gray-900 truncate flex items-center gap-1.5">
              <span>{storeData.tenant.name}</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0" title="Aberto para pedidos" />
            </h1>
            <p className="text-[11px] text-gray-500 truncate flex items-center gap-1">
              <Clock className="w-3 h-3 text-gray-400" />
              <span>{storeData.settings.defaultPrepTimeMinutes ? `Preparo: ${storeData.settings.defaultPrepTimeMinutes} min` : (storeData.settings.estimatedDeliveryTime || 'Preparo: 30 min')}</span>
              <span>•</span>
              <span className="font-medium text-emerald-700">
                {deliveryFee === 0 ? 'Entrega Grátis' : `Entrega R$ ${(storeData.settings.deliveryFee || 0).toFixed(2)}`}
              </span>
            </p>
          </div>
        </div>

        {/* Status de Login do Cliente / Botão de Acesso */}
        <div className="flex items-center gap-2">
          {supabaseUser ? (
            <button
              onClick={() => setIsAccountOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 cursor-pointer transition-all"
            >
              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span className="max-w-[100px] truncate">{customerName || supabaseUser.email?.split('@')[0]}</span>
            </button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsAuthModalOpen(true)}
              className="text-xs h-8 px-2.5 rounded-xl cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5 mr-1" />
              Entrar
            </Button>
          )}
        </div>
      </div>

      {/* Visualização de Pedidos do Cliente */}
      {navTab === 'orders' ? (
        <div className="max-w-lg mx-auto p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Seus Pedidos em {storeData.tenant.name}</h2>
            <Button size="sm" variant="ghost" onClick={() => setNavTab('home')} className="text-xs">
              Voltar ao Cardápio
            </Button>
          </div>

          {!supabaseUser ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-gray-200 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <LogIn className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-gray-900 text-sm">Acesse sua Conta de Cliente</h3>
              <p className="text-xs text-gray-500">
                Entre com seu e-mail ou Google para acompanhar em tempo real o status dos seus pedidos.
              </p>
              <Button
                onClick={() => setIsAuthModalOpen(true)}
                className="w-full text-white font-bold"
                style={{ backgroundColor: buttonColor }}
              >
                Entrar ou Criar Conta
              </Button>
            </div>
          ) : isLoadingOrders ? (
            <div className="p-8 text-center text-gray-500 text-xs space-y-2">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-emerald-700" />
              <p>Carregando seus pedidos...</p>
            </div>
          ) : customerOrdersError ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-amber-200/80 space-y-3 shadow-xs">
              <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-gray-900 text-sm">Não foi possível carregar seus pedidos</h3>
              <p className="text-xs text-gray-500 max-w-xs mx-auto">
                {customerOrdersError}
              </p>
              <Button
                size="sm"
                onClick={() => loadCustomerOrders()}
                disabled={isLoadingOrders}
                className="text-white font-bold text-xs"
                style={{ backgroundColor: buttonColor }}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoadingOrders ? 'animate-spin' : ''}`} />
                Tentar Novamente
              </Button>
            </div>
          ) : customerOrders.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-2xl border border-gray-200 space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-gray-900 text-sm">Nenhum pedido realizado nesta loja com esta conta.</h3>
              <p className="text-xs text-gray-500 max-w-xs mx-auto leading-relaxed">
                Você está conectado como <span className="font-semibold text-gray-700 font-mono">{supabaseUser.email}</span>. Se realizou a compra com outro e-mail, verifique sua conta.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsAccountOpen(true)}
                  className="w-full sm:w-auto text-xs"
                >
                  <UserIcon className="w-3.5 h-3.5 mr-1 text-slate-500" />
                  Verificar conta
                </Button>
                <Button
                  size="sm"
                  onClick={() => setNavTab('home')}
                  className="w-full sm:w-auto text-white font-bold text-xs"
                  style={{ backgroundColor: buttonColor }}
                >
                  Ver Cardápio
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {customerOrders.map(order => {
                const isDelivered = order.status === 'DELIVERED';
                const isCancelled = order.status === 'CANCELLED';
                const isDelivery = order.status === 'OUT_FOR_DELIVERY' || order.status === 'READY' || order.status === 'WAITING_FOR_DRIVER';
                const isPreparing = order.status === 'PREPARING' || order.status === 'CONFIRMED';
                const isPending = order.status === 'PENDING';

                // Determina o índice de progresso da esteira (1 a 4)
                const currentStep = isDelivered ? 4 : isDelivery ? 3 : isPreparing ? 2 : 1;

                return (
                  <div 
                    key={order.id} 
                    className="p-4 sm:p-5 bg-white rounded-3xl border border-gray-200/90 shadow-xs hover:shadow-md transition-all space-y-4"
                  >
                    {/* TOPO: NÚMERO DO PEDIDO + DATA + TOTAL EM DESTAQUE */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <ShoppingBag className="w-4 h-4 text-emerald-700 shrink-0" />
                          <span className="font-black text-base text-gray-900 font-mono">
                            Pedido #{order.orderNumber || order.id.slice(0, 6)}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-400 font-mono mt-0.5">
                          {new Date(order.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="inline-block px-3 py-1 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-800 font-mono font-black text-base">
                          R$ {order.totalAmount.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* STATUS BADGES & ATENDIMENTO */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`px-2.5 py-1 rounded-lg font-mono font-bold text-[11px] uppercase border flex items-center gap-1.5 ${
                        isPending ? 'bg-amber-50 text-amber-800 border-amber-300 animate-pulse' :
                        isPreparing ? 'bg-blue-50 text-blue-800 border-blue-200' :
                        isDelivery ? 'bg-purple-50 text-purple-800 border-purple-200' :
                        isDelivered ? 'bg-emerald-100 text-emerald-900 border-emerald-300' :
                        'bg-rose-50 text-rose-800 border-rose-200'
                      }`}>
                        {isPending && <Clock className="w-3 h-3 text-amber-600 animate-spin" />}
                        {isPreparing && <Clock className="w-3 h-3 text-blue-600 animate-spin" />}
                        {isDelivery && <Bike className="w-3 h-3 text-purple-600" />}
                        {isDelivered && <CheckCircle2 className="w-3 h-3 text-emerald-700" />}
                        {isCancelled && <AlertCircle className="w-3 h-3 text-rose-700" />}
                        <span>
                          {isPending ? 'Recebido • Aguardando Loja' :
                           order.status === 'CONFIRMED' ? 'Confirmado' :
                           order.status === 'PREPARING' ? `Em Preparo (${order.prepTimeMinutes || storeData.settings.defaultPrepTimeMinutes || 30} min)` :
                           order.status === 'READY' ? 'Pronto p/ Despacho' :
                           isDelivery ? 'Saiu para Entrega' :
                           isDelivered ? 'Entregue com Sucesso' : 'Pedido Cancelado'}
                        </span>
                      </span>

                      <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 font-mono font-bold text-[10px] uppercase border border-gray-200">
                        {order.fulfillmentType === 'PICKUP' ? '🛍️ Retirada no Balcão' : '🛵 Entrega Delivery'}
                      </span>

                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 font-mono font-bold text-[10px] uppercase border border-emerald-200">
                        {order.paymentMethod === 'CASH' ? 'Dinheiro' : order.paymentMethod === 'PIX' ? 'PIX' : 'Cartão'}
                      </span>
                    </div>

                    {/* PROGRESS TRACKER STEPPER HORIZONTAL */}
                    {!isCancelled && (
                      <div className="bg-slate-50 border border-slate-200/70 rounded-2xl p-3.5 space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase text-slate-400">
                          <span className={currentStep >= 1 ? 'text-emerald-700 font-black' : ''}>1. Recebido</span>
                          <span className={currentStep >= 2 ? 'text-emerald-700 font-black' : ''}>2. Preparo</span>
                          <span className={currentStep >= 3 ? 'text-purple-700 font-black' : ''}>3. A Caminho</span>
                          <span className={currentStep >= 4 ? 'text-emerald-700 font-black' : ''}>4. Entregue</span>
                        </div>
                        {/* Linha de Progresso Visual */}
                        <div className="relative flex items-center justify-between">
                          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-slate-200 z-0 rounded-full" />
                          <div 
                            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-emerald-500 z-0 rounded-full transition-all duration-500"
                            style={{ width: currentStep === 1 ? '10%' : currentStep === 2 ? '40%' : currentStep === 3 ? '75%' : '100%' }}
                          />
                          {[1, 2, 3, 4].map(step => (
                            <div 
                              key={step}
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold z-10 transition-colors shadow-2xs ${
                                currentStep >= step
                                  ? 'bg-emerald-600 text-white ring-2 ring-emerald-200' 
                                  : 'bg-white border border-slate-300 text-slate-400'
                              }`}
                            >
                              {currentStep > step ? '✓' : step}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* LISTA DE ITENS DO PEDIDO */}
                    <div className="bg-gray-50/70 border border-gray-200/60 rounded-2xl p-3 space-y-1.5 text-xs">
                      <div className="flex justify-between items-center text-[10px] font-mono font-bold uppercase tracking-wider text-gray-400 pb-1 border-b border-gray-200/50">
                        <span>Produtos ({order.items.length})</span>
                        <span>Valor</span>
                      </div>
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center text-gray-800">
                            <span className="truncate pr-2">
                              <strong className="text-emerald-700 font-mono mr-1.5">{item.quantity}x</strong>
                              {item.productName}
                            </span>
                            <span className="font-mono font-medium text-gray-700 shrink-0">
                              R$ {item.totalPrice.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ENDEREÇO & AÇÕES OPERACIONAIS */}
                    <div className="pt-1 border-t border-gray-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 text-xs">
                      <div className="flex items-center gap-1.5 text-gray-600 min-w-0">
                        <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate text-[11px] font-medium">
                          {order.fulfillmentType === 'PICKUP' ? 'Retirada no Balcão do Estabelecimento' : order.deliveryAddress}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => openWhatsAppContact(order.orderNumber)}
                          className="flex-1 sm:flex-initial py-1.5 px-3 rounded-xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/80 text-emerald-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                          <span>WhatsApp</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRepeatOrder(order)}
                          className="flex-1 sm:flex-initial py-1.5 px-3 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Repetir Pedido</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Visualização da Vitrine e Cardápio */
        <div className="max-w-lg mx-auto p-4 space-y-4">
          {/* Banner Principal se configurado */}
          {theme.bannerUrl && (
            <div className="relative rounded-2xl overflow-hidden shadow-xs border border-gray-200/80">
              <img
                src={theme.bannerUrl}
                alt={storeData.tenant.name}
                className="w-full h-36 sm:h-44 object-cover"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent flex flex-col justify-end p-4 text-white">
                <p className="text-xs font-semibold text-emerald-300 drop-shadow-sm">Cardápio Oficial</p>
                <h2 className="text-lg font-extrabold drop-shadow-sm">{storeData.tenant.name}</h2>
                {theme.tagline && <p className="text-xs text-white/90 line-clamp-1">{theme.tagline}</p>}
              </div>
            </div>
          )}

          {/* Carrossel de Ofertas Válidas do Estabelecimento */}
          {storeData.offers.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Ofertas & Promoções em Destaque</span>
              </div>
              <OfferCarousel
                offers={storeData.offers}
                onOfferClick={handleOfferClick}
              />
            </div>
          )}

          {/* Barra de Busca de Produtos */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar produtos, bebidas ou petiscos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9.5 pr-4 py-2.5 rounded-2xl border border-gray-200 text-xs bg-white shadow-2xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Filtro Horizontal de Categorias */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setActiveCategory('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 cursor-pointer transition-all ${
                activeCategory === 'ALL'
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
              style={{
                backgroundColor: activeCategory === 'ALL' ? primaryColor : undefined,
                borderRadius
              }}
            >
              Todos ({storeData.products.length})
            </button>
            {storeData.categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 cursor-pointer transition-all ${
                  activeCategory === c.id
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
                style={{
                  backgroundColor: activeCategory === c.id ? primaryColor : undefined,
                  borderRadius
                }}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* Listagem de Produtos Reais com UUIDs do Banco */}
          <div className="space-y-3 pt-1">
            {filteredProducts.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-2xl border border-gray-200 text-gray-400 space-y-1">
                <p className="font-bold text-gray-600">Nenhum produto encontrado</p>
                <p className="text-xs">Tente selecionar outra categoria ou buscar por outro termo.</p>
              </div>
            ) : (
              filteredProducts.map((p) => {
                const inCart = cart.find(i => i.product.id === p.id);
                const isOutOfStock = p.isAvailable !== undefined ? !p.isAvailable : p.stockQuantity <= 0;

                return (
                  <div
                    key={p.id}
                    id={`product-${p.id}`}
                    onClick={() => handleSelectProduct(p.id)}
                    className={`p-3.5 border bg-white flex items-center justify-between gap-3 shadow-xs hover:border-gray-300 transition-all cursor-pointer ${
                      highlightedProductId === p.id 
                        ? 'ring-2 ring-emerald-500 bg-emerald-50/50 shadow-md border-emerald-400' 
                        : 'border-gray-200/80'
                    } ${
                      isOutOfStock ? 'opacity-70 bg-gray-50/50' : ''
                    }`}
                    style={{ borderRadius }}
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-gray-900 leading-snug truncate">{p.name}</h3>
                        {isOutOfStock ? (
                          <Badge variant="danger" size="sm">Esgotado</Badge>
                        ) : null}
                      </div>

                      <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                        {p.description}
                      </p>

                      <div className="flex items-baseline gap-2 pt-1">
                        {p.promotionalPrice && p.promotionalPrice > 0 ? (
                          <>
                            <span className="font-extrabold text-sm text-emerald-800 font-mono">
                              R$ {p.promotionalPrice.toFixed(2)}
                            </span>
                            <span className="text-xs text-gray-400 line-through font-mono">
                              R$ {p.price.toFixed(2)}
                            </span>
                          </>
                        ) : (
                          <span className="font-extrabold text-sm text-gray-900 font-mono">
                            R$ {p.price.toFixed(2)}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 font-mono uppercase">/{p.unit || 'un'}</span>
                      </div>
                    </div>

                    <div className="relative shrink-0 flex flex-col items-center gap-2">
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt={p.name}
                          className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover border border-gray-100"
                        />
                      ) : (
                        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-gray-100 flex items-center justify-center text-gray-300">
                          <ShoppingBag className="w-8 h-8" />
                        </div>
                      )}

                      {isOutOfStock ? (
                        <span className="text-[10px] font-bold text-gray-400 uppercase py-1">
                          Indisponível
                        </span>
                      ) : inCart ? (
                        <div className="flex items-center gap-1.5 bg-gray-100 rounded-xl p-1 shadow-2xs">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveFromCart(p.id); }}
                            className="w-6 h-6 rounded-lg bg-white flex items-center justify-center text-gray-700 hover:bg-gray-200 cursor-pointer shadow-xs"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-xs font-black font-mono px-1">{inCart.quantity}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAddToCart(p); }}
                            className="w-6 h-6 rounded-lg text-white flex items-center justify-center cursor-pointer shadow-xs"
                            style={{ backgroundColor: buttonColor }}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={(e) => { e.stopPropagation(); handleAddToCart(p); }}
                          className="text-xs py-1 h-7 rounded-xl px-3 cursor-pointer"
                          style={{ backgroundColor: buttonColor }}
                        >
                          Adicionar
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Floating Bottom Cart Bar */}
      {cart.length > 0 && !isCheckoutOpen && navTab === 'home' && (
        <div className="fixed bottom-16 left-0 right-0 z-40 p-4 max-w-lg mx-auto pointer-events-none">
          <div
            onClick={() => setIsCheckoutOpen(true)}
            className="pointer-events-auto p-3.5 rounded-2xl text-white shadow-xl flex items-center justify-between cursor-pointer hover:opacity-95 transition-all"
            style={{ backgroundColor: buttonColor, borderRadius }}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center font-black text-xs font-mono">
                {cartTotalCount}
              </div>
              <div className="text-xs">
                <div className="font-bold">Ver Sacola de Compras</div>
                <div className="text-white/80">
                  {cart.length} {cart.length === 1 ? 'item' : 'itens'} adicionados
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 font-mono font-extrabold text-sm">
              <span>R$ {subtotal.toFixed(2)}</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL DE CHECKOUT & AUTENTICAÇÃO DO CLIENTE */}
      {/* ---------------------------------------------------------------------- */}
      <Modal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        title="Finalizar Pedido"
        size="md"
      >
        <div className="space-y-4">
          {/* BARREIRA OBRIGATÓRIA DE LOGIN: NÃO EXISTE CHECKOUT ANÔNIMO */}
          {!supabaseUser ? (
            <div className="space-y-4 py-2">
              <div className="text-center space-y-1.5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
                  <UserCheck className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-gray-900">Entre na sua Conta para Finalizar</h3>
                <p className="text-xs text-gray-500 max-w-xs mx-auto">
                  Para confirmar seu pedido com segurança e receber atualizações em tempo real, acesse como cliente:
                </p>
              </div>

              {/* Botão de Login com Google */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isAuthenticating}
                className="w-full py-2.5 px-4 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 shadow-xs flex items-center justify-center gap-2.5 cursor-pointer transition-all"
              >
                {isAuthenticating ? (
                  <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                ) : (
                  <>
                    <GoogleIcon />
                    <span>Continuar com Google</span>
                  </>
                )}
              </button>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-gray-200 w-full" />
                <span className="bg-white px-2 text-[10px] text-gray-400 uppercase font-bold shrink-0">
                  ou com seu e-mail
                </span>
              </div>

              {/* Abas Entrar / Criar Conta com E-mail */}
              <div className="grid grid-cols-2 p-1 bg-gray-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setAuthMode('login')}
                  className={`py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                    authMode === 'login' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Já tenho conta
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('signup')}
                  className={`py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                    authMode === 'signup' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  Criar conta
                </button>
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-3">
                {authMode === 'signup' && (
                  <Input
                    label="Seu Nome Completo"
                    placeholder="Ex: João da Silva"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    required
                    className="text-xs"
                  />
                )}
                <Input
                  label="E-mail"
                  type="email"
                  placeholder="seu@email.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                  className="text-xs"
                />
                <Input
                  label="Senha"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  required
                  className="text-xs"
                />

                <Button
                  type="submit"
                  disabled={isAuthenticating}
                  className="w-full text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer"
                  style={{ backgroundColor: buttonColor }}
                >
                  {isAuthenticating ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : authMode === 'login' ? (
                    'Entrar e Continuar Pedido'
                  ) : (
                    'Criar Conta e Continuar Pedido'
                  )}
                </Button>
              </form>
            </div>
          ) : (
            /* CLIENTE AUTENTICADO: FORMULÁRIO OPERACIONAL DO PEDIDO */
            <form onSubmit={handleFinishOrder} className="space-y-4">
              {/* Badge de Cliente Autenticado */}
              <div className="p-2.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold text-[10px]">
                    ✓
                  </div>
                  <div>
                    <span className="font-bold text-emerald-950">Cliente Conectado:</span>{' '}
                    <span className="text-emerald-800">{supabaseUser.email}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="text-[11px] text-emerald-700 hover:text-emerald-900 underline font-semibold cursor-pointer"
                >
                  Trocar
                </button>
              </div>

              {/* Resumo dos Itens da Sacola */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-gray-700 uppercase tracking-wider">
                  <span>Itens Selecionados ({cartTotalCount})</span>
                  <span>Subtotal: R$ {subtotal.toFixed(2)}</span>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1 divide-y divide-gray-100">
                  {cart.map((item) => {
                    const price = item.product.promotionalPrice && item.product.promotionalPrice > 0
                      ? item.product.promotionalPrice
                      : item.product.price;
                    return (
                      <div key={item.product.id} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold font-mono text-emerald-800">{item.quantity}x</span>
                          <span className="text-gray-800 truncate">{item.product.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-bold text-gray-900">
                            R$ {(price * item.quantity).toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveFromCart(item.product.id)}
                            className="text-gray-400 hover:text-rose-600 p-0.5 cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Opção de Retirada vs Entrega */}
              <div className="space-y-1.5 pt-2 border-t border-gray-100">
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Tipo de Atendimento
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFulfillmentType('DELIVERY')}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                      fulfillmentType === 'DELIVERY'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Bike className="w-4 h-4" />
                    Entrega em Domicílio
                  </button>
                  <button
                    type="button"
                    onClick={() => setFulfillmentType('PICKUP')}
                    className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                      fulfillmentType === 'PICKUP'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Store className="w-4 h-4" />
                    Retirada no Balcão
                  </button>
                </div>
              </div>

              {/* Dados Obrigatórios do Cliente */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Dados do Comprador
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    label="Seu Nome Completo *"
                    placeholder="Ex: João Silva"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    required
                    className="text-xs"
                  />
                  <Input
                    label="WhatsApp para Contato *"
                    placeholder="(11) 98765-4321"
                    value={customerPhone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Endereço de Entrega com Google Autocomplete */}
              {fulfillmentType === 'DELIVERY' ? (
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Endereço de Entrega
                  </h4>

                  {/* Autocomplete do Google Places Integrado */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-700 flex items-center justify-between">
                      <span>Buscar Rua / Endereço no Google</span>
                      <span className="text-[10px] text-emerald-700 font-normal">Autocomplete Inteligente</span>
                    </label>
                    <AddressAutocompleteInput
                      value={streetAddress}
                      onChange={(val) => setStreetAddress(val)}
                      onAddressSelect={(parsed: ParsedAddress) => {
                        setStreetAddress(parsed.street || parsed.formattedAddress);
                        if (parsed.number) setAddressNumber(parsed.number);
                        if (parsed.neighborhood) setNeighborhood(parsed.neighborhood);
                        if (parsed.city) setCity(parsed.city);
                        if (parsed.state) setState(parsed.state);
                        if (parsed.postalCode) setPostalCode(parsed.postalCode);
                        setLatitude(parsed.latitude);
                        setLongitude(parsed.longitude);
                        setPlaceId(parsed.placeId);
                        setFormattedAddress(parsed.formattedAddress);
                      }}
                      placeholder="Comece a digitar sua rua ou avenida..."
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1">
                      <Input
                        label="Número *"
                        placeholder="Ex: 120"
                        value={addressNumber}
                        onChange={(e) => setAddressNumber(e.target.value)}
                        required
                        className="text-xs"
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        label="Bairro"
                        placeholder="Ex: Jardins"
                        value={neighborhood}
                        onChange={(e) => setNeighborhood(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      label="Complemento / Apto"
                      placeholder="Ex: Bloco B, Apto 42"
                      value={complement}
                      onChange={(e) => setComplement(e.target.value)}
                      className="text-xs"
                    />
                    <Input
                      label="Ponto de Referência"
                      placeholder="Ex: Próximo à padaria"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs space-y-1">
                  <div className="font-bold text-gray-800 flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-emerald-700" />
                    Retirada no Estabelecimento:
                  </div>
                  <p className="text-gray-600">{storeData.settings.address}</p>
                  <p className="text-[11px] text-emerald-700 font-bold">
                    Taxa de entrega: Grátis (R$ 0,00)
                  </p>
                </div>
              )}

              {/* Forma de Pagamento */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Forma de Pagamento
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'PIX', label: 'PIX Instantâneo', icon: <QrCode className="w-4 h-4" /> },
                    { id: 'CREDIT_CARD', label: 'Cartão de Crédito', icon: <CreditCard className="w-4 h-4" /> },
                    { id: 'DEBIT_CARD', label: 'Cartão de Débito', icon: <CreditCard className="w-4 h-4" /> },
                    { id: 'CASH', label: 'Dinheiro', icon: <Tag className="w-4 h-4" /> },
                  ].map((pm) => (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => setPaymentMethod(pm.id as any)}
                      className={`p-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 cursor-pointer transition-all ${
                        paymentMethod === pm.id
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-2xs'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <span className={paymentMethod === pm.id ? 'text-emerald-700' : 'text-gray-400'}>
                        {pm.icon}
                      </span>
                      <span>{pm.label}</span>
                    </button>
                  ))}
                </div>

                {paymentMethod === 'CASH' && (
                  <Input
                    label="Precisa de troco para quanto? (Deixe em branco se não precisar)"
                    placeholder="Ex: 50,00"
                    value={cashChange}
                    onChange={(e) => setCashChange(e.target.value)}
                    className="text-xs"
                  />
                )}
              </div>

              {/* Observações */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700">Observações para o Pedido (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ex: Não tocar campainha, bebidas bem geladas..."
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-gray-200 text-xs bg-white shadow-2xs"
                />
              </div>

              {/* Valores Totais Oficiais */}
              <div className="p-3 bg-gray-50 rounded-xl space-y-1.5 text-xs">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span className="font-mono">R$ {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Taxa de Entrega</span>
                  <span className="font-mono text-emerald-700 font-bold">
                    {deliveryFee === 0 ? 'Grátis' : `R$ ${deliveryFee.toFixed(2)}`}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-gray-900 border-t border-gray-200 pt-1.5">
                  <span>Total</span>
                  <span className="font-mono text-emerald-800 text-base">R$ {grandTotal.toFixed(2)}</span>
                </div>
              </div>

              {/* Botão de Confirmação do Pedido */}
              <Button
                type="submit"
                disabled={isSubmittingOrder || cart.length === 0}
                className="w-full text-white font-extrabold text-sm py-3 rounded-xl shadow-md cursor-pointer"
                style={{ backgroundColor: buttonColor }}
              >
                {isSubmittingOrder ? (
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processando seu pedido no servidor...</span>
                  </div>
                ) : (
                  `Confirmar Pedido • R$ ${grandTotal.toFixed(2)}`
                )}
              </Button>
            </form>
          )}
        </div>
      </Modal>

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL DE CONFIRMAÇÃO DE SUCESSO DO PEDIDO */}
      {/* ---------------------------------------------------------------------- */}
      <Modal
        isOpen={Boolean(completedOrder)}
        onClose={() => setCompletedOrder(null)}
        title="Pedido Realizado com Sucesso!"
        size="md"
      >
        <div className="space-y-4 text-center py-2">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-xs">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div className="space-y-1">
            <h3 className="text-xl font-black text-gray-900">PEDIDO REALIZADO!</h3>
            <p className="text-sm font-extrabold text-emerald-800 font-mono">
              Pedido #{completedOrder?.orderNumber || completedOrder?.id.slice(0, 6)}
            </p>
            <p className="text-xs text-gray-500">
              Enviado para <strong className="text-gray-900">{storeData.tenant.name}</strong>
            </p>
          </div>

          <div className="p-3.5 bg-gray-50 rounded-2xl text-left text-xs font-mono space-y-1 border border-gray-100">
            <div className="flex justify-between">
              <span className="text-gray-500">Total:</span>
              <span className="font-extrabold text-gray-900">R$ {completedOrder?.totalAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Pagamento:</span>
              <span className="font-bold text-gray-900">{completedOrder?.paymentMethod}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Status:</span>
              <span className="font-bold text-emerald-700">Recebido pelo Estabelecimento</span>
            </div>
          </div>

          {/* Se PIX, exibe código Copia e Cola */}
          {completedOrder?.paymentMethod === 'PIX' && (
            <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-2xl space-y-2 text-left">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-950">
                <QrCode className="w-4 h-4 text-emerald-700" />
                <span>Pagamento via PIX Instantâneo</span>
              </div>
              <p className="text-[11px] text-gray-600">
                Copie o código abaixo e efetue o pagamento no aplicativo do seu banco:
              </p>
              <Button
                size="sm"
                onClick={handleCopyPix}
                className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
              >
                {copiedPix ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                {copiedPix ? 'Código PIX Copiado!' : 'Copiar Código PIX'}
              </Button>
            </div>
          )}

          <div className="pt-2 flex flex-col gap-2">
            <Button
              className="w-full text-white font-bold"
              style={{ backgroundColor: buttonColor }}
              onClick={() => {
                setCompletedOrder(null);
                setNavTab('orders');
              }}
            >
              Acompanhar Meus Pedidos
            </Button>
            <Button
              variant="outline"
              onClick={() => openWhatsAppContact(completedOrder?.orderNumber)}
              className="w-full flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-4 h-4 text-emerald-600" />
              Falar no WhatsApp da Loja
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL DE CONTA DO CLIENTE & INFORMAÇÕES DA LOJA */}
      {/* ---------------------------------------------------------------------- */}
      <Modal
        isOpen={isAccountOpen}
        onClose={() => setIsAccountOpen(false)}
        title="Minha Conta & Contato"
        size="sm"
      >
        <div className="space-y-4 text-xs py-1">
          {supabaseUser ? (
            <div className="p-3 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl space-y-2">
              <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-800">Conta Conectada</span>
                <span className="text-[11px] font-mono font-medium text-emerald-950 truncate max-w-[180px]">{supabaseUser.email}</span>
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <div className="w-8 h-8 rounded-full bg-emerald-700 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  {customerName ? customerName.substring(0, 2).toUpperCase() : 'CL'}
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-gray-900 truncate">{customerName || 'Cliente'}</h4>
                  <p className="text-[11px] text-gray-500 font-mono truncate">{supabaseUser.email}</p>
                </div>
              </div>
              {customerPhone && (
                <p className="text-[11px] text-gray-600">
                  <strong>WhatsApp:</strong> {customerPhone}
                </p>
              )}
              <div className="pt-1 border-t border-emerald-100">
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  Esta é sua conta do AdegaFood. Você pode usá-la para comprar em diferentes estabelecimentos parceiros com total segurança.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await signOut();
                  setIsAccountOpen(false);
                  showToast({ type: 'info', title: 'Sessão encerrada', message: 'Você saiu da sua conta.' });
                }}
                className="w-full text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 mr-1" />
                Sair da Minha Conta
              </Button>
            </div>
          ) : (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-2xl text-center space-y-2">
              <p className="text-gray-600 font-medium">Você ainda não está conectado.</p>
              <Button
                size="sm"
                onClick={() => {
                  setIsAccountOpen(false);
                  setIsAuthModalOpen(true);
                }}
                className="w-full text-white font-bold"
                style={{ backgroundColor: buttonColor }}
              >
                Entrar ou Criar Conta
              </Button>
            </div>
          )}

          <div className="p-3 bg-gray-50 rounded-2xl text-left font-mono text-[11px] space-y-1.5 border border-gray-100">
            <div className="font-bold text-gray-900 text-xs font-sans pb-1 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-emerald-700" />
              <span>{storeData.tenant.name}</span>
            </div>
            <div><strong>Telefone:</strong> {storeData.tenant.phone}</div>
            {storeData.settings.phoneWhatsApp && (
              <div><strong>WhatsApp:</strong> {storeData.settings.phoneWhatsApp}</div>
            )}
            <div><strong>Endereço:</strong> {storeData.settings.address}</div>
            <div><strong>Tempo de Preparo:</strong> {storeData.settings.defaultPrepTimeMinutes ? `${storeData.settings.defaultPrepTimeMinutes} min` : '30 min'}</div>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => openWhatsAppContact()}
            leftIcon={<MessageCircle className="w-4 h-4 text-emerald-600" />}
          >
            Falar no WhatsApp da Loja
          </Button>
        </div>
      </Modal>

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL DIRETO DE AUTENTICAÇÃO */}
      {/* ---------------------------------------------------------------------- */}
      <Modal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        title="Conta do Cliente"
        size="sm"
      >
        <div className="space-y-4 py-1">
          <div className="text-center space-y-1">
            <h4 className="text-sm font-bold text-gray-900">Identificação para Pedidos</h4>
            <p className="text-xs text-gray-500">
              Acesse sua conta para comprar em <strong>{storeData.tenant.name}</strong>:
            </p>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isAuthenticating}
            className="w-full py-2.5 px-4 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 shadow-xs flex items-center justify-center gap-2.5 cursor-pointer transition-all"
          >
            {isAuthenticating ? (
              <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
            ) : (
              <>
                <GoogleIcon />
                <span>Continuar com Google</span>
              </>
            )}
          </button>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-gray-200 w-full" />
            <span className="bg-white px-2 text-[10px] text-gray-400 uppercase font-bold shrink-0">
              ou com e-mail
            </span>
          </div>

          <div className="grid grid-cols-2 p-1 bg-gray-100 rounded-xl">
            <button
              type="button"
              onClick={() => setAuthMode('login')}
              className={`py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                authMode === 'login' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('signup')}
              className={`py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all ${
                authMode === 'signup' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Criar Conta
            </button>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-3">
            {authMode === 'signup' && (
              <Input
                label="Seu Nome Completo"
                placeholder="Ex: Maria Oliveira"
                value={authName}
                onChange={(e) => setAuthName(e.target.value)}
                required
                className="text-xs"
              />
            )}
            <Input
              label="E-mail"
              type="email"
              placeholder="seu@email.com"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              required
              className="text-xs"
            />
            <Input
              label="Senha"
              type="password"
              placeholder="Mínimo 6 caracteres"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              required
              className="text-xs"
            />

            <Button
              type="submit"
              disabled={isAuthenticating}
              className="w-full text-white font-bold text-xs py-2.5 rounded-xl cursor-pointer"
              style={{ backgroundColor: buttonColor }}
            >
              {isAuthenticating ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : authMode === 'login' ? (
                'Entrar'
              ) : (
                'Cadastrar'
              )}
            </Button>
          </form>
        </div>
      </Modal>

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL DE DETALHES DO PRODUTO (OFERTAS & NAVEGAÇÃO INTERNA) */}
      {/* ---------------------------------------------------------------------- */}
      {selectedProductModal && (
        <Modal
          isOpen={Boolean(selectedProductModal)}
          onClose={handleCloseProductModal}
          title={selectedProductModal.name}
          size="md"
        >
          <div className="space-y-4 py-1">
            {/* Imagem do Produto */}
            <div className="w-full h-48 sm:h-56 rounded-2xl overflow-hidden bg-gray-100 relative border border-gray-200/80">
              {selectedProductModal.imageUrl ? (
                <img
                  src={selectedProductModal.imageUrl}
                  alt={selectedProductModal.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300">
                  <ShoppingBag className="w-16 h-16" />
                </div>
              )}
              {selectedProductModal.isFeatured && (
                <div className="absolute top-3 left-3">
                  <Badge variant="warning" size="sm">Destaque da Casa</Badge>
                </div>
              )}
              {selectedProductModal.promotionalPrice && selectedProductModal.promotionalPrice > 0 && (
                <div className="absolute top-3 right-3 bg-emerald-600 text-white text-xs font-black uppercase px-2.5 py-1 rounded-full shadow-sm">
                  {Math.round(((selectedProductModal.price - selectedProductModal.promotionalPrice) / selectedProductModal.price) * 100)}% OFF
                </div>
              )}
            </div>

            {/* Informações de Título e Descrição */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-extrabold text-base text-gray-900 leading-snug">
                  {selectedProductModal.name}
                </h3>
                <span className="text-xs text-gray-500 font-mono uppercase bg-gray-100 px-2 py-0.5 rounded-lg shrink-0">
                  {selectedProductModal.unit || 'un'}
                </span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">
                {selectedProductModal.description}
              </p>
            </div>

            {/* Preços e Disponibilidade */}
            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200/80 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-gray-400 font-bold uppercase block">Preço</span>
                <div className="flex items-baseline gap-2">
                  {selectedProductModal.promotionalPrice && selectedProductModal.promotionalPrice > 0 ? (
                    <>
                      <span className="text-lg font-extrabold text-emerald-800 font-mono">
                        R$ {selectedProductModal.promotionalPrice.toFixed(2)}
                      </span>
                      <span className="text-xs text-gray-400 line-through font-mono">
                        R$ {selectedProductModal.price.toFixed(2)}
                      </span>
                    </>
                  ) : (
                    <span className="text-lg font-extrabold text-gray-900 font-mono">
                      R$ {selectedProductModal.price.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>

              <div>
                {selectedProductModal.isAvailable === false || selectedProductModal.stockQuantity <= 0 ? (
                  <Badge variant="danger" size="sm">Esgotado</Badge>
                ) : (
                  <Badge variant="success" size="sm">Disponível</Badge>
                )}
              </div>
            </div>

            {/* Botão de Ação / Adicionar ao Carrinho */}
            <div className="pt-1 flex items-center gap-3">
              {(() => {
                const inCart = cart.find(i => i.product.id === selectedProductModal.id);
                const isOutOfStock = selectedProductModal.isAvailable === false || selectedProductModal.stockQuantity <= 0;

                if (isOutOfStock) {
                  return (
                    <Button
                      variant="outline"
                      className="w-full text-xs"
                      disabled
                    >
                      Produto Indisponível no Momento
                    </Button>
                  );
                }

                if (inCart) {
                  return (
                    <div className="w-full flex items-center justify-between p-2 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <span className="text-xs font-bold text-emerald-900">
                        No Carrinho: <strong className="font-mono text-sm">{inCart.quantity}</strong> item(s)
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRemoveFromCart(selectedProductModal.id)}
                          className="w-8 h-8 rounded-lg bg-white border border-emerald-300 flex items-center justify-center text-emerald-900 hover:bg-emerald-100 cursor-pointer shadow-xs"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddToCart(selectedProductModal)}
                          className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center hover:bg-emerald-800 cursor-pointer shadow-xs"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <Button
                    className="w-full text-xs font-bold py-2.5 rounded-xl cursor-pointer"
                    onClick={() => handleAddToCart(selectedProductModal)}
                    leftIcon={<Plus className="w-4 h-4" />}
                    style={{ backgroundColor: buttonColor }}
                  >
                    Adicionar à Sacola
                  </Button>
                );
              })()}
            </div>
          </div>
        </Modal>
      )}

      {/* Navegação Inferior Mobile */}
      <MobileNavigation
        type="customer"
        activeTab={navTab}
        onTabChange={(tab) => {
          if (tab === 'home') setNavTab('home');
          if (tab === 'cart') setIsCheckoutOpen(true);
          if (tab === 'orders') setNavTab('orders');
          if (tab === 'account') setIsAccountOpen(true);
        }}
        cartCount={cartTotalCount}
        primaryColor={buttonColor}
      />
    </div>
  );
};
