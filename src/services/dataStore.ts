import { 
  Tenant, 
  Product, 
  Category, 
  Offer, 
  Order, 
  Customer, 
  Driver, 
  AuditLog, 
  AppEvent, 
  Sponsor,
  User,
  TeamMember,
  InventoryMovement,
  InternalNotification,
  PromotionCarousel,
  PromotionCarouselItem,
  Coupon,
  CouponRedemption,
  RedeemCouponResult,
  ValidateCouponResult,
  CardStatus
} from '../types';
import { SecurityContext, validateTenantAccess, validatePermission } from './securityEngine';
import { calculatePromoCardStatus } from '../utils/promoCardDateUtils';

const STORAGE_KEY = 'adegafood_saas_db_v2';

// Tenants iniciais
const INITIAL_TENANTS: Tenant[] = [
  {
    id: 'tenant-adega-01',
    slug: 'adega-premium',
    name: 'Adega Premium Jardins',
    legalName: 'Jardins Vinhos & Bebidas Ltda',
    document: '42.198.345/0001-89',
    phone: '(11) 98765-4321',
    email: 'contato@adegapremium.com.br',
    category: 'ADEGA',
    status: 'ACTIVE',
    planTier: 'PRO',
    createdAt: '2026-01-15T10:00:00Z',
    gmvMonthly: 84320.50,
    activeOrdersToday: 42,
    totalCustomers: 1280,
    isDemo: true,
    theme: {
      primaryColor: '#15803d', // Verde clássico Adega
      secondaryColor: '#166534',
      backgroundColor: '#f8fafc',
      cardColor: '#ffffff',
      buttonColor: '#15803d',
      textColor: '#0f172a',
      borderRadius: '1rem',
      fontFamily: 'Inter',
      storeName: 'Adega Premium Jardins',
      tagline: 'Vinhos nobres, cervejas artesanais e bebidas geladas em minutos.',
      logoUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=160&auto=format&fit=crop&q=80',
      bannerUrl: 'https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?w=1200&auto=format&fit=crop&q=80',
    },
    settings: {
      isOpen: true,
      minOrderValue: 30.00,
      deliveryFee: 7.90,
      freeDeliveryThreshold: 150.00,
      estimatedDeliveryTime: '25-40 min',
      defaultPrepTimeMinutes: 30,
      address: 'Alameda Lorena, 1420 - Jardins, São Paulo - SP',
      city: 'São Paulo',
      phoneWhatsApp: '5511987654321',
      pixKey: 'financeiro@adegapremium.com.br',
    }
  },
  {
    id: 'tenant-burger-02',
    slug: 'burger-craft',
    name: 'Burger Craft & Beers',
    legalName: 'Craft Burgueria e Gastronomia Eireli',
    document: '38.902.114/0001-22',
    phone: '(11) 97654-3210',
    email: 'pedidos@burgercraft.com',
    category: 'BURGER',
    status: 'ACTIVE',
    planTier: 'STANDARD',
    createdAt: '2026-03-01T14:30:00Z',
    gmvMonthly: 52190.00,
    activeOrdersToday: 29,
    totalCustomers: 890,
    isDemo: true,
    theme: {
      primaryColor: '#059669', // Verde esmeralda
      secondaryColor: '#047857',
      backgroundColor: '#fafaf9',
      cardColor: '#ffffff',
      buttonColor: '#059669',
      textColor: '#1c1917',
      borderRadius: '0.85rem',
      fontFamily: 'Inter',
      storeName: 'Burger Craft & Beers',
      tagline: 'Smash burgers autênticos grelhados no fogo alto.',
      logoUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=160&auto=format&fit=crop&q=80',
      bannerUrl: 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=1200&auto=format&fit=crop&q=80',
    },
    settings: {
      isOpen: true,
      minOrderValue: 25.00,
      deliveryFee: 6.50,
      freeDeliveryThreshold: 120.00,
      estimatedDeliveryTime: '30-45 min',
      defaultPrepTimeMinutes: 20,
      address: 'Rua Augusta, 850 - Consolação, São Paulo - SP',
      city: 'São Paulo',
      phoneWhatsApp: '5511976543210',
      pixKey: 'pix@burgercraft.com',
    }
  },
  {
    id: 'tenant-pizza-03',
    slug: 'pizzaria-bella',
    name: 'Pizzaria Bella Forneria',
    legalName: 'Bella Napoli Pizzas Tradicionais Ltda',
    document: '29.331.876/0001-40',
    phone: '(11) 99123-4567',
    email: 'bella@forneriapizza.com.br',
    category: 'PIZZARIA',
    status: 'ACTIVE',
    planTier: 'PRO',
    createdAt: '2026-02-10T12:00:00Z',
    gmvMonthly: 98450.00,
    activeOrdersToday: 51,
    totalCustomers: 1640,
    isDemo: true,
    theme: {
      primaryColor: '#16a34a',
      secondaryColor: '#15803d',
      backgroundColor: '#fefce8',
      cardColor: '#ffffff',
      buttonColor: '#16a34a',
      textColor: '#1e293b',
      borderRadius: '1.25rem',
      fontFamily: 'Inter',
      storeName: 'Pizzaria Bella Forneria',
      tagline: 'Fermentação lenta, molho de tomate san marzano e forno a lenha.',
      logoUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=160&auto=format&fit=crop&q=80',
      bannerUrl: 'https://images.unsplash.com/photo-1590947132387-155cc02f3212?w=1200&auto=format&fit=crop&q=80',
    },
    settings: {
      isOpen: true,
      minOrderValue: 40.00,
      deliveryFee: 8.00,
      freeDeliveryThreshold: 160.00,
      estimatedDeliveryTime: '40-55 min',
      defaultPrepTimeMinutes: 45,
      address: 'Rua dos Pinheiros, 450 - Pinheiros, São Paulo - SP',
      city: 'São Paulo',
      phoneWhatsApp: '5511991234567',
      pixKey: 'pagamento@forneriapizza.com.br',
    }
  }
];

const INITIAL_USERS: User[] = [
  {
    id: 'user-ceo-01',
    name: 'Carlos Mendes',
    email: 'carlos.mendes@adegafood.com',
    role: 'CEO',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
  },
  {
    id: 'user-owner-adega',
    name: 'Roberto Viana',
    email: 'roberto@adegapremium.com.br',
    role: 'OWNER',
    tenantId: 'tenant-adega-01',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80',
  },
  {
    id: 'user-owner-burger',
    name: 'Mariana Duarte',
    email: 'mariana@burgercraft.com',
    role: 'OWNER',
    tenantId: 'tenant-burger-02',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&auto=format&fit=crop&q=80',
  },
  {
    id: 'user-driver-01',
    name: 'Lucas Pereira',
    email: 'lucas.motoboy@gmail.com',
    role: 'DRIVER',
    tenantId: 'tenant-adega-01',
    phone: '(11) 98111-2233',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&auto=format&fit=crop&q=80',
  },
  {
    id: 'user-customer-demo',
    name: 'Fernanda Lima',
    email: 'fernanda.lima@gmail.com',
    role: 'CUSTOMER',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&auto=format&fit=crop&q=80',
  }
];

const INITIAL_CATEGORIES: Category[] = [
  // Categorias Adega
  { id: 'cat-adega-1', tenantId: 'tenant-adega-01', name: 'Vinhos Tintos & Brancos', description: 'Vinhos finos nacionais e importados de safras especiais', order: 1, isActive: true, createdAt: '2026-01-15T10:00:00Z' },
  { id: 'cat-adega-2', tenantId: 'tenant-adega-01', name: 'Cervejas Artesanais', description: 'IPAs, Weisse, Stout e puro malte geladas', order: 2, isActive: true, createdAt: '2026-01-15T10:00:00Z' },
  { id: 'cat-adega-3', tenantId: 'tenant-adega-01', name: 'Destilados & Gins', description: 'Gins botânicos, whiskies e vodkas premium', order: 3, isActive: true, createdAt: '2026-01-15T10:00:00Z' },
  { id: 'cat-adega-4', tenantId: 'tenant-adega-01', name: 'Petiscos & Queijos', description: 'Frios artesanais, queijos curados e castanhas', order: 4, isActive: true, createdAt: '2026-01-15T10:00:00Z' },

  // Categorias Burger
  { id: 'cat-burger-1', tenantId: 'tenant-burger-02', name: 'Smash Burgers', description: 'Burgers prensados na chapa de ferro fundido', order: 1, isActive: true, createdAt: '2026-03-01T14:30:00Z' },
  { id: 'cat-burger-2', tenantId: 'tenant-burger-02', name: 'Acompanhamentos', description: 'Batatas rústicas, nuggets e molhos da casa', order: 2, isActive: true, createdAt: '2026-03-01T14:30:00Z' },
  { id: 'cat-burger-3', tenantId: 'tenant-burger-02', name: 'Bebidas Geladas', description: 'Refrigerantes, chás gelados e cervejas', order: 3, isActive: true, createdAt: '2026-03-01T14:30:00Z' },

  // Categorias Pizzaria
  { id: 'cat-pizza-1', tenantId: 'tenant-pizza-03', name: 'Pizzas Especiais', description: 'Receitas exclusivas com ingredientes importados', order: 1, isActive: true, createdAt: '2026-02-10T12:00:00Z' },
  { id: 'cat-pizza-2', tenantId: 'tenant-pizza-03', name: 'Pizzas Tradicionais', description: 'Os sabores mais amados do Brasil', order: 2, isActive: true, createdAt: '2026-02-10T12:00:00Z' },
  { id: 'cat-pizza-3', tenantId: 'tenant-pizza-03', name: 'Bebidas & Sobremesas', description: 'Para acompanhar seu momento em família', order: 3, isActive: true, createdAt: '2026-02-10T12:00:00Z' },
];

const INITIAL_PRODUCTS: Product[] = [
  // Produtos Adega
  {
    id: 'prod-adega-1',
    tenantId: 'tenant-adega-01',
    categoryId: 'cat-adega-1',
    name: 'Vinho Tinto Cabernet Sauvignon Reserva 750ml',
    description: 'Encorpado, notas de frutas vermelhas maduras, carvalho tostado e taninos aveludados.',
    price: 89.90,
    promotionalPrice: 69.90,
    cost: 42.00,
    sku: 'VIN-CAB-001',
    imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600&auto=format&fit=crop&q=80',
    isAvailable: true,
    isActive: true,
    isFeatured: true,
    stockQuantity: 48,
    minStock: 10,
    unit: 'garrafa',
    createdAt: '2026-01-16T10:00:00Z',
    updatedAt: '2026-09-22T10:15:00Z'
  },
  {
    id: 'prod-adega-2',
    tenantId: 'tenant-adega-01',
    categoryId: 'cat-adega-2',
    name: 'Cerveja Artesanal IPA Puro Malte 500ml',
    description: 'Amargor pronunciado, aromas cítricos de lúpulo americano, teor alcoólico 6.5%.',
    price: 24.50,
    promotionalPrice: 19.90,
    cost: 11.20,
    sku: 'CERV-IPA-002',
    imageUrl: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=600&auto=format&fit=crop&q=80',
    isAvailable: true,
    isActive: true,
    isFeatured: true,
    stockQuantity: 120,
    minStock: 24,
    unit: 'garrafa',
    createdAt: '2026-01-16T11:00:00Z',
    updatedAt: '2026-09-22T10:15:00Z'
  },
  {
    id: 'prod-adega-3',
    tenantId: 'tenant-adega-01',
    categoryId: 'cat-adega-3',
    name: 'Gin London Dry Artesanal Botânico 750ml',
    description: 'Destilado com zimbro, sementes de coentro, cardamomo e casca de limão siciliano.',
    price: 139.00,
    cost: 68.00,
    sku: 'GIN-LON-003',
    imageUrl: 'https://images.unsplash.com/photo-1527061011665-3652c757a4d4?w=600&auto=format&fit=crop&q=80',
    isAvailable: true,
    isActive: true,
    isFeatured: false,
    stockQuantity: 24,
    minStock: 5,
    unit: 'garrafa',
    createdAt: '2026-01-20T14:00:00Z',
    updatedAt: '2026-09-20T14:00:00Z'
  },
  {
    id: 'prod-adega-4',
    tenantId: 'tenant-adega-01',
    categoryId: 'cat-adega-4',
    name: 'Tábua de Queijos Selecionados & Castanhas 250g',
    description: 'Gouda, brie francês, provolone curado, castanha de caju torrada e damascos.',
    price: 49.90,
    cost: 26.50,
    sku: 'TAB-QUEI-004',
    imageUrl: 'https://images.unsplash.com/photo-1631379578550-7038263db699?w=600&auto=format&fit=crop&q=80',
    isAvailable: true,
    isActive: true,
    isFeatured: false,
    stockQuantity: 15,
    minStock: 5,
    unit: 'un',
    createdAt: '2026-02-01T09:00:00Z',
    updatedAt: '2026-09-21T09:00:00Z'
  },

  // Produtos Burger
  {
    id: 'prod-burger-1',
    tenantId: 'tenant-burger-02',
    categoryId: 'cat-burger-1',
    name: 'Double Bacon Smash Burger',
    description: 'Dois blends prensados de 90g, queijo cheddar inglês derretido e fatias crocantes de bacon artesanal.',
    price: 36.90,
    promotionalPrice: 29.90,
    cost: 14.50,
    sku: 'BUR-BAC-001',
    imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80',
    isAvailable: true,
    isActive: true,
    isFeatured: true,
    stockQuantity: 80,
    minStock: 20,
    unit: 'un',
    createdAt: '2026-03-02T12:00:00Z',
    updatedAt: '2026-09-22T11:00:00Z'
  },
  {
    id: 'prod-burger-2',
    tenantId: 'tenant-burger-02',
    categoryId: 'cat-burger-2',
    name: 'Batata Rústica Trufada com Alecrim',
    description: 'Batatas rústicas douradas temperadas com azeite de trufas brancas e alecrim fresco.',
    price: 22.00,
    cost: 7.00,
    sku: 'BAT-TRU-002',
    imageUrl: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop&q=80',
    isAvailable: true,
    isActive: true,
    isFeatured: false,
    stockQuantity: 65,
    minStock: 15,
    unit: 'porção',
    createdAt: '2026-03-02T12:30:00Z',
    updatedAt: '2026-09-20T10:00:00Z'
  },

  // Produtos Pizzaria
  {
    id: 'prod-pizza-1',
    tenantId: 'tenant-pizza-03',
    categoryId: 'cat-pizza-1',
    name: 'Pizza Margherita Di Bufala Especial',
    description: 'Molho de tomate pelado italiano, muçarela de búfala fresca, parmesão e manjericão gigante.',
    price: 74.90,
    cost: 29.00,
    sku: 'PIZ-MAR-001',
    imageUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=80',
    isAvailable: true,
    isActive: true,
    isFeatured: true,
    stockQuantity: 50,
    minStock: 10,
    unit: 'un',
    createdAt: '2026-02-12T15:00:00Z',
    updatedAt: '2026-09-21T16:00:00Z'
  }
];

const INITIAL_OFFERS: Offer[] = [
  // Ofertas Adega
  {
    id: 'off-adega-1',
    tenantId: 'tenant-adega-01',
    title: 'Festival de Vinhos Tinto Seleção',
    subtitle: 'Compre 2 garrafas de Cabernet e ganhe 20% OFF imediato',
    description: 'Válido exclusivamente para compras realizadas pelo app oficial.',
    badge: 'DESTAQUE DA SEMANA',
    cardFormat: 'HORIZONTAL',
    mediaType: 'IMAGE',
    displayMode: 'EDITABLE_CARD',
    mediaUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=1200&auto=format&fit=crop&q=80',
    imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=1200&auto=format&fit=crop&q=80',
    durationSeconds: 5.0,
    detectedWidth: 1200,
    detectedHeight: 675,
    aspectRatio: '16:9',
    discountPercentage: 20,
    originalPrice: 89.90,
    promotionalPrice: 69.90,
    productId: 'prod-adega-1',
    internalLink: '/app/adega-premium?product=prod-adega-1',
    order: 1,
    startDate: '2026-09-01',
    endDate: '2026-12-31',
    backgroundColor: '#15803d',
    accentColor: '#4ade80',
    isActive: true,
    createdAt: '2026-09-01T10:00:00Z'
  },
  {
    id: 'off-adega-2',
    tenantId: 'tenant-adega-01',
    title: 'Happy Hour Cervejas Artesanais',
    subtitle: 'Cerveja IPA Puro Malte gelada na porta da sua casa em 30 min',
    description: 'Arte promocional completa para vitrine.',
    badge: 'SUPER OFERTA',
    cardFormat: 'QUADRADO',
    mediaType: 'IMAGE',
    displayMode: 'FULL_MEDIA',
    mediaUrl: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=1080&auto=format&fit=crop&q=80',
    imageUrl: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=1080&auto=format&fit=crop&q=80',
    durationSeconds: 6.0,
    detectedWidth: 1080,
    detectedHeight: 1080,
    aspectRatio: '1:1',
    discountPercentage: 18,
    originalPrice: 24.50,
    promotionalPrice: 19.90,
    productId: 'prod-adega-2',
    internalLink: '/app/adega-premium?product=prod-adega-2',
    order: 2,
    startDate: '2026-09-01',
    endDate: '2026-12-31',
    backgroundColor: '#0f766e',
    accentColor: '#2dd4bf',
    isActive: true,
    createdAt: '2026-09-01T10:00:00Z'
  },
  {
    id: 'off-adega-3',
    tenantId: 'tenant-adega-01',
    title: 'Vídeo Promocional Gin Botânico',
    subtitle: 'Vídeo animado com reprodução pela duração real do arquivo',
    description: 'Campanha de vídeo animado gerada para redes e vitrine.',
    badge: 'VÍDEO ESPECIAL',
    cardFormat: 'VERTICAL',
    mediaType: 'VIDEO',
    displayMode: 'FULL_MEDIA',
    mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    imageUrl: 'https://images.unsplash.com/photo-1527061011665-3652c757a4d4?w=800&auto=format&fit=crop&q=80',
    durationSeconds: 15.0,
    videoDuration: 15.0,
    detectedWidth: 1080,
    detectedHeight: 1350,
    aspectRatio: '4:5',
    originalPrice: 159.00,
    promotionalPrice: 139.00,
    productId: 'prod-adega-3',
    internalLink: '/app/adega-premium?product=prod-adega-3',
    order: 3,
    startDate: '2026-09-15',
    endDate: '2026-12-31',
    backgroundColor: '#1e3a8a',
    accentColor: '#93c5fd',
    isActive: true,
    createdAt: '2026-09-15T12:00:00Z'
  },

  // Ofertas Burger
  {
    id: 'off-burger-1',
    tenantId: 'tenant-burger-02',
    title: 'Terça do Smash Duplo em Dobro',
    subtitle: 'O segundo hambúrguer com 50% de desconto',
    description: 'Promoção exclusiva de terças e quartas no aplicativo próprio.',
    badge: 'PROMOÇÃO DO DIA',
    cardFormat: 'HORIZONTAL',
    mediaType: 'IMAGE',
    displayMode: 'FULL_MEDIA',
    mediaUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1200&auto=format&fit=crop&q=80',
    imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1200&auto=format&fit=crop&q=80',
    durationSeconds: 5.0,
    detectedWidth: 1200,
    detectedHeight: 675,
    aspectRatio: '16:9',
    discountPercentage: 50,
    originalPrice: 36.90,
    promotionalPrice: 29.90,
    productId: 'prod-burger-1',
    internalLink: '/app/burger-craft?product=prod-burger-1',
    order: 1,
    startDate: '2026-09-01',
    endDate: '2026-12-31',
    backgroundColor: '#047857',
    accentColor: '#a7f3d0',
    isActive: true,
    createdAt: '2026-09-01T10:00:00Z'
  }
];

const INITIAL_PROMOTION_CAROUSELS: PromotionCarousel[] = [
  {
    id: 'carousel-adega-1',
    tenantId: 'tenant-adega-01',
    name: 'Ofertas do Dia',
    description: 'Os melhores preços e rótulos selecionados de hoje',
    imageUrl: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&auto=format&fit=crop&q=80',
    isActive: true,
    showInStore: true,
    displayOrder: 0,
    items: [
      {
        id: 'pci-1',
        carouselId: 'carousel-adega-1',
        productId: 'prod-adega-1',
        tenantId: 'tenant-adega-01',
        discountType: 'PERCENTAGE',
        discountValue: 30,
        promotionalPrice: 62.93,
        calculatedDiscountPercentage: 30,
        showDiscountBadge: true,
        showPromotionalPrice: true,
        isActive: true,
        displayOrder: 0,
      },
      {
        id: 'pci-2',
        carouselId: 'carousel-adega-1',
        productId: 'prod-adega-2',
        tenantId: 'tenant-adega-01',
        discountType: 'PERCENTAGE',
        discountValue: 20,
        promotionalPrice: 19.60,
        calculatedDiscountPercentage: 20,
        showDiscountBadge: true,
        showPromotionalPrice: true,
        isActive: true,
        displayOrder: 1,
      },
      {
        id: 'pci-3',
        carouselId: 'carousel-adega-1',
        productId: 'prod-adega-3',
        tenantId: 'tenant-adega-01',
        discountType: 'PERCENTAGE',
        discountValue: 15,
        promotionalPrice: 101.15,
        calculatedDiscountPercentage: 15,
        showDiscountBadge: true,
        showPromotionalPrice: true,
        isActive: true,
        displayOrder: 2,
      },
      {
        id: 'pci-4',
        carouselId: 'carousel-adega-1',
        productId: 'prod-adega-4',
        tenantId: 'tenant-adega-01',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        promotionalPrice: 19.80,
        calculatedDiscountPercentage: 10,
        showDiscountBadge: true,
        showPromotionalPrice: true,
        isActive: true,
        displayOrder: 3,
      },
    ],
  },
  {
    id: 'carousel-adega-2',
    tenantId: 'tenant-adega-01',
    name: 'Festival de Cervejas Artesanais',
    description: 'Lúpulos nobres e receitas premiadas',
    imageUrl: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=800&auto=format&fit=crop&q=80',
    isActive: true,
    showInStore: true,
    displayOrder: 1,
    items: [
      {
        id: 'pci-21',
        carouselId: 'carousel-adega-2',
        productId: 'prod-adega-2',
        tenantId: 'tenant-adega-01',
        discountType: 'PROMOTIONAL_PRICE',
        discountValue: 18.50,
        promotionalPrice: 18.50,
        calculatedDiscountPercentage: 24,
        showDiscountBadge: true,
        showPromotionalPrice: true,
        isActive: true,
        displayOrder: 0,
      },
      {
        id: 'pci-22',
        carouselId: 'carousel-adega-2',
        productId: 'prod-adega-4',
        tenantId: 'tenant-adega-01',
        discountType: 'PERCENTAGE',
        discountValue: 15,
        promotionalPrice: 18.70,
        calculatedDiscountPercentage: 15,
        showDiscountBadge: true,
        showPromotionalPrice: true,
        isActive: true,
        displayOrder: 1,
      },
    ],
  },
  {
    id: 'carousel-burger-1',
    tenantId: 'tenant-burger-02',
    name: 'Combos Especiais Burger',
    description: 'Smash burgers com desconto especial',
    imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format&fit=crop&q=80',
    isActive: true,
    showInStore: true,
    displayOrder: 0,
    items: [
      {
        id: 'pci-b-1',
        carouselId: 'carousel-burger-1',
        productId: 'prod-burger-1',
        tenantId: 'tenant-burger-02',
        discountType: 'PERCENTAGE',
        discountValue: 20,
        promotionalPrice: 27.92,
        calculatedDiscountPercentage: 20,
        showDiscountBadge: true,
        showPromotionalPrice: true,
        isActive: true,
        displayOrder: 0,
      }
    ]
  }
];

const INITIAL_COUPONS: Coupon[] = [
  {
    id: 'coup-1',
    tenantId: 'tenant-adega-01',
    code: 'PRIMEIRACOMPRA',
    discountType: 'PERCENTAGE',
    discountValue: 10,
    minOrderValue: 50,
    usageLimit: 100,
    usageLimitPerCustomer: 1,
    timesUsed: 14,
    isActive: true,
    createdAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'coup-2',
    tenantId: 'tenant-adega-01',
    code: 'VOLTA15',
    discountType: 'FIXED_AMOUNT',
    discountValue: 15,
    minOrderValue: 80,
    usageLimit: 50,
    usageLimitPerCustomer: 1,
    timesUsed: 8,
    isActive: true,
    createdAt: '2026-03-10T10:00:00Z',
  },
  {
    id: 'coup-4',
    tenantId: 'tenant-adega-01',
    code: 'PRIMEIRA20',
    discountType: 'PERCENTAGE',
    discountValue: 20,
    minOrderValue: 40,
    usageLimit: 20,
    usageLimitPerCustomer: 1,
    timesUsed: 16,
    isActive: true,
    createdAt: '2026-03-20T10:00:00Z',
  },
  {
    id: 'coup-3',
    tenantId: 'tenant-burger-02',
    code: 'BURGER10',
    discountType: 'PERCENTAGE',
    discountValue: 10,
    minOrderValue: 30,
    usageLimit: 100,
    usageLimitPerCustomer: 1,
    timesUsed: 5,
    isActive: true,
    createdAt: '2026-03-01T10:00:00Z',
  }
];

const INITIAL_ORDERS: Order[] = [
  {
    id: 'ord-1001',
    tenantId: 'tenant-adega-01',
    customerId: 'cust-adega-1',
    orderNumber: 1001,
    customerName: 'Renato Sampaio',
    customerPhone: '(11) 99876-1122',
    deliveryAddress: 'Rua Bela Cintra, 1100 - Apto 82, Consolação',
    items: [
      {
        productId: 'prod-adega-1',
        productName: 'Vinho Tinto Cabernet Sauvignon Reserva 750ml',
        quantity: 2,
        unitPrice: 69.90,
        totalPrice: 139.80,
        unit: 'garrafa'
      },
      {
        productId: 'prod-adega-4',
        productName: 'Tábua de Queijos Selecionados & Castanhas 250g',
        quantity: 1,
        unitPrice: 49.90,
        totalPrice: 49.90,
        unit: 'porção'
      }
    ],
    subtotal: 189.70,
    deliveryFee: 0.00, // Frete grátis (> 150)
    discount: 0.00,
    totalAmount: 189.70,
    paymentMethod: 'PIX',
    paymentStatus: 'PAID',
    fulfillmentType: 'DELIVERY',
    notes: 'Favor interfonar no 82.',
    status: 'PREPARING',
    statusHistory: [
      { status: 'PENDING', timestamp: '2026-09-22T12:45:00Z', note: 'Pedido recebido via Cardápio Web', changedBy: 'Renato Sampaio' },
      { status: 'CONFIRMED', timestamp: '2026-09-22T12:47:00Z', note: 'Pagamento Pix verificado', changedBy: 'Roberto Viana' },
      { status: 'PREPARING', timestamp: '2026-09-22T12:48:00Z', note: 'Em separação na adega', changedBy: 'Roberto Viana' }
    ],
    createdAt: '2026-09-22T12:45:00Z',
    updatedAt: '2026-09-22T12:48:00Z',
    origin: 'qr_code'
  },
  {
    id: 'ord-1002',
    tenantId: 'tenant-adega-01',
    customerId: 'cust-adega-2',
    orderNumber: 1002,
    customerName: 'Beatriz Vasconcelos',
    customerPhone: '(11) 98888-4455',
    deliveryAddress: 'Av. Paulista, 2000 - Conjunto 1401',
    items: [
      {
        productId: 'prod-adega-2',
        productName: 'Cerveja Artesanal IPA Puro Malte 500ml',
        quantity: 4,
        unitPrice: 19.90,
        totalPrice: 79.60,
        unit: 'garrafa'
      }
    ],
    subtotal: 79.60,
    deliveryFee: 7.90,
    discount: 0.00,
    totalAmount: 87.50,
    paymentMethod: 'CREDIT_CARD',
    paymentStatus: 'PAYMENT_ON_DELIVERY',
    fulfillmentType: 'DELIVERY',
    status: 'OUT_FOR_DELIVERY',
    statusHistory: [
      { status: 'PENDING', timestamp: '2026-09-22T12:20:00Z', note: 'Pedido recebido', changedBy: 'Beatriz Vasconcelos' },
      { status: 'CONFIRMED', timestamp: '2026-09-22T12:22:00Z', note: 'Pedido aceito', changedBy: 'Roberto Viana' },
      { status: 'PREPARING', timestamp: '2026-09-22T12:25:00Z', note: 'Bebidas embaladas na bolsa térmica', changedBy: 'Diego Santos' },
      { status: 'READY', timestamp: '2026-09-22T12:35:00Z', note: 'Pronto para despacho', changedBy: 'Diego Santos' },
      { status: 'OUT_FOR_DELIVERY', timestamp: '2026-09-22T12:38:00Z', note: 'Entregador em rota', changedBy: 'Lucas Pereira' }
    ],
    createdAt: '2026-09-22T12:20:00Z',
    updatedAt: '2026-09-22T12:38:00Z',
    driverId: 'drv-01',
    driverName: 'Lucas Pereira (Moto Honda CG 160)',
    origin: 'whatsapp'
  },
  {
    id: 'ord-1003',
    tenantId: 'tenant-adega-01',
    orderNumber: 1003,
    customerName: 'Guilherme Toledo',
    customerPhone: '(11) 97777-6633',
    deliveryAddress: 'Rua Oscar Freire, 320 - Cerqueira César',
    items: [
      {
        productId: 'prod-adega-3',
        productName: 'Gin London Dry Artesanal Botânico 750ml',
        quantity: 1,
        unitPrice: 139.00,
        totalPrice: 139.00,
        unit: 'garrafa'
      }
    ],
    subtotal: 139.00,
    deliveryFee: 7.90,
    discount: 0.00,
    totalAmount: 146.90,
    paymentMethod: 'PIX',
    paymentStatus: 'PENDING',
    fulfillmentType: 'DELIVERY',
    status: 'PENDING',
    statusHistory: [
      { status: 'PENDING', timestamp: '2026-09-22T13:05:00Z', note: 'Aguardando confirmação da loja', changedBy: 'Guilherme Toledo' }
    ],
    createdAt: '2026-09-22T13:05:00Z',
    updatedAt: '2026-09-22T13:05:00Z',
    origin: 'instagram'
  },

  // Pedido do Burger (Tenant 2) - NUNCA deve ser visto pelo Roberto da Adega
  {
    id: 'ord-2001',
    tenantId: 'tenant-burger-02',
    customerId: 'cust-burger-1',
    orderNumber: 2001,
    customerName: 'Felipe Alcantara',
    customerPhone: '(11) 91122-3344',
    deliveryAddress: 'Rua Frei Caneca, 560 - Bela Vista',
    items: [
      {
        productId: 'prod-burger-1',
        productName: 'Double Bacon Smash Burger',
        quantity: 2,
        unitPrice: 29.90,
        totalPrice: 59.80,
        unit: 'un'
      }
    ],
    subtotal: 59.80,
    deliveryFee: 6.50,
    discount: 0.00,
    totalAmount: 66.30,
    paymentMethod: 'PIX',
    paymentStatus: 'PAID',
    fulfillmentType: 'DELIVERY',
    status: 'PREPARING',
    statusHistory: [
      { status: 'PENDING', timestamp: '2026-09-22T12:50:00Z', note: 'Pedido recebido', changedBy: 'Felipe Alcantara' },
      { status: 'CONFIRMED', timestamp: '2026-09-22T12:52:00Z', note: 'Na chapa quente', changedBy: 'Carlos Burguer' }
    ],
    createdAt: '2026-09-22T12:50:00Z',
    updatedAt: '2026-09-22T12:52:00Z',
    origin: 'marketplace'
  }
];

const INITIAL_INVENTORY_MOVEMENTS: InventoryMovement[] = [
  {
    id: 'mov-001',
    tenantId: 'tenant-adega-01',
    productId: 'prod-adega-1',
    productName: 'Vinho Tinto Cabernet Sauvignon Reserva 750ml',
    quantity: 50,
    type: 'ENTRADA',
    reason: 'Entrada de lote fornecedor Vinícola Serra Gaúcha',
    previousStock: 0,
    newStock: 50,
    timestamp: '2026-09-01T08:00:00Z',
    createdByName: 'Roberto Viana',
  },
  {
    id: 'mov-002',
    tenantId: 'tenant-adega-01',
    productId: 'prod-adega-1',
    productName: 'Vinho Tinto Cabernet Sauvignon Reserva 750ml',
    quantity: -2,
    type: 'VENDA',
    referenceId: 'ord-1001',
    reason: 'Baixa por venda via Cardápio Web - Pedido #1001',
    previousStock: 50,
    newStock: 48,
    timestamp: '2026-09-22T12:45:00Z',
    createdByName: 'Sistema (Checkout)',
  },
  {
    id: 'mov-003',
    tenantId: 'tenant-adega-01',
    productId: 'prod-adega-2',
    productName: 'Cerveja Artesanal IPA Puro Malte 500ml',
    quantity: -4,
    type: 'VENDA',
    referenceId: 'ord-1002',
    reason: 'Baixa por venda via Cardápio Web - Pedido #1002',
    previousStock: 90,
    newStock: 86,
    timestamp: '2026-09-22T12:20:00Z',
    createdByName: 'Sistema (Checkout)',
  }
];

const INITIAL_NOTIFICATIONS: InternalNotification[] = [
  {
    id: 'notif-001',
    tenantId: 'tenant-adega-01',
    title: 'Novo Pedido #1003 Recebido',
    message: 'Guilherme Toledo realizou um pedido no valor de R$ 146,90.',
    type: 'ORDER_NEW',
    orderId: 'ord-1003',
    read: false,
    createdAt: '2026-09-22T13:05:00Z',
  }
];

const INITIAL_CUSTOMERS: Customer[] = [
  // Clientes Adega
  {
    id: 'cust-adega-1',
    tenantId: 'tenant-adega-01',
    name: 'Renato Sampaio',
    phone: '(11) 99876-1122',
    email: 'renato.sampaio@uol.com.br',
    origin: 'qr_code',
    totalOrders: 6,
    ltvAmount: 890.40,
    firstOrderDate: '2026-04-10',
    lastOrderDate: '2026-09-22',
    consentLgpd: true
  },
  {
    id: 'cust-adega-2',
    tenantId: 'tenant-adega-01',
    name: 'Beatriz Vasconcelos',
    phone: '(11) 98888-4455',
    email: 'beatriz.v@gmail.com',
    origin: 'whatsapp',
    totalOrders: 3,
    ltvAmount: 310.20,
    firstOrderDate: '2026-06-18',
    lastOrderDate: '2026-09-22',
    consentLgpd: true
  },
  {
    id: 'cust-adega-3',
    tenantId: 'tenant-adega-01',
    name: 'Camila Rossi',
    phone: '(11) 97123-9988',
    email: 'camila.rossi@outlook.com',
    origin: 'marketplace', // Veio do iFood/Rappi e migrou para canal próprio via cupom na sacola!
    totalOrders: 11,
    ltvAmount: 1740.00,
    firstOrderDate: '2026-02-05',
    lastOrderDate: '2026-09-18',
    consentLgpd: true
  },

  // Cliente Burger - Dados privados do Tenant 02
  {
    id: 'cust-burger-1',
    tenantId: 'tenant-burger-02',
    name: 'Felipe Alcantara',
    phone: '(11) 91122-3344',
    email: 'felipe.a@empresa.com.br',
    origin: 'marketplace',
    totalOrders: 2,
    ltvAmount: 132.60,
    firstOrderDate: '2026-08-12',
    lastOrderDate: '2026-09-22',
    consentLgpd: true
  }
];

const INITIAL_DRIVERS: Driver[] = [
  {
    id: 'drv-01',
    tenantId: 'tenant-adega-01',
    name: 'Lucas Pereira',
    phone: '(11) 98111-2233',
    vehicle: 'Moto Honda CG 160 Fan',
    plate: 'SP-ABC1D23',
    status: 'AVAILABLE',
    isOnline: true,
    activeOrderId: 'ord-1002',
    completedDeliveriesToday: 9
  },
  {
    id: 'drv-02',
    tenantId: 'tenant-adega-01',
    name: 'Marcos Vinicius',
    phone: '(11) 97222-4455',
    vehicle: 'Moto Yamaha Fazer 250',
    plate: 'SP-XYZ9A87',
    status: 'AVAILABLE',
    isOnline: true,
    completedDeliveriesToday: 7
  }
];

const INITIAL_TEAM: TeamMember[] = [
  {
    id: 'team-01',
    tenantId: 'tenant-adega-01',
    userId: 'user-owner-adega',
    name: 'Roberto Viana',
    email: 'roberto@adegapremium.com.br',
    role: 'OWNER',
    phone: '(11) 98765-4321',
    status: 'ACTIVE',
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'team-02',
    tenantId: 'tenant-adega-01',
    userId: 'user-manager-01',
    name: 'Juliana Silva',
    email: 'juliana.gerente@adegapremium.com.br',
    role: 'MANAGER',
    phone: '(11) 98444-1122',
    status: 'ACTIVE',
    createdAt: '2026-02-01T08:30:00Z',
  },
  {
    id: 'team-03',
    tenantId: 'tenant-adega-01',
    userId: 'user-cashier-01',
    name: 'Diego Santos',
    email: 'diego.caixa@adegapremium.com.br',
    role: 'CASHIER',
    phone: '(11) 98333-5566',
    status: 'ACTIVE',
    createdAt: '2026-03-10T14:00:00Z',
  }
];

const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'aud-001',
    userId: 'user-ceo-01',
    userName: 'Carlos Mendes (CEO)',
    userRole: 'CEO',
    action: 'SYSTEM_BOOTSTRAP',
    resource: 'INFRASTRUCTURE',
    details: 'Fundação oficial do sistema ADEGAFOOD inicializada com isolamento Zero-Trust e RLS.',
    ipAddress: '192.168.1.1 (HQ)',
    isCeoSupport: false,
    timestamp: '2026-09-22T08:00:00Z'
  },
  {
    id: 'aud-002',
    userId: 'user-owner-adega',
    userName: 'Roberto Viana',
    userRole: 'OWNER',
    tenantId: 'tenant-adega-01',
    tenantName: 'Adega Premium Jardins',
    action: 'THEME_CUSTOMIZATION',
    resource: 'TENANT_THEME',
    details: 'Tema da loja atualizado: cor primária #15803d e raio de curvatura 1rem.',
    previousValue: 'primaryColor: #166534',
    newValue: 'primaryColor: #15803d',
    ipAddress: '189.45.12.90',
    isCeoSupport: false,
    timestamp: '2026-09-22T09:30:00Z'
  },
  {
    id: 'aud-003',
    userId: 'user-owner-adega',
    userName: 'Roberto Viana',
    userRole: 'OWNER',
    tenantId: 'tenant-adega-01',
    tenantName: 'Adega Premium Jardins',
    action: 'PRODUCT_PRICE_UPDATE',
    resource: 'PRODUCT',
    resourceId: 'prod-adega-1',
    details: 'Preço promocional do Vinho Cabernet ajustado para R$ 69,90.',
    previousValue: 'price: 89.90',
    newValue: 'promotionalPrice: 69.90',
    ipAddress: '189.45.12.90',
    isCeoSupport: false,
    timestamp: '2026-09-22T10:15:00Z'
  }
];

const INITIAL_SPONSORS: Sponsor[] = [
  {
    id: 'sp-01',
    brandName: 'Heineken Brasil',
    campaignTitle: 'Chop Heineken Zero em Casa',
    bannerUrl: 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=800&auto=format&fit=crop&q=80',
    targetCategory: 'ADEGA',
    cpcValue: 0.85,
    totalClicks: 1420,
    budgetAllocated: 5000.00,
    status: 'ACTIVE'
  },
  {
    id: 'sp-02',
    brandName: 'Coca-Cola Zero Sugar',
    campaignTitle: 'Refresque seu Pedido de Sexta',
    bannerUrl: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=800&auto=format&fit=crop&q=80',
    targetCategory: 'BURGER',
    cpcValue: 0.60,
    totalClicks: 2890,
    budgetAllocated: 4000.00,
    status: 'ACTIVE'
  }
];

export class DataStore {
  private tenants: Tenant[];
  private users: User[];
  private categories: Category[];
  private products: Product[];
  private offers: Offer[];
  private orders: Order[];
  private customers: Customer[];
  private drivers: Driver[];
  private teamMembers: TeamMember[];
  private auditLogs: AuditLog[];
  private appEvents: AppEvent[];
  private sponsors: Sponsor[];
  private inventoryMovements: InventoryMovement[];
  private notifications: InternalNotification[];
  private promotionCarousels: PromotionCarousel[];
  private coupons: Coupon[];
  private couponRedemptions: CouponRedemption[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.tenants = INITIAL_TENANTS.map(t => ({ ...t, isDemo: t.isDemo ?? true }));
    this.users = INITIAL_USERS;
    this.categories = INITIAL_CATEGORIES.map(c => ({ ...c, isDemo: c.isDemo ?? true }));
    this.products = INITIAL_PRODUCTS.map(p => ({ ...p, isDemo: p.isDemo ?? true }));
    this.offers = INITIAL_OFFERS.map(o => ({ ...o, isDemo: o.isDemo ?? true }));
    this.promotionCarousels = INITIAL_PROMOTION_CAROUSELS;
    this.coupons = INITIAL_COUPONS;
    this.orders = INITIAL_ORDERS.map(ord => ({ ...ord, isDemo: ord.isDemo ?? true }));
    this.customers = INITIAL_CUSTOMERS.map(cust => ({ ...cust, isDemo: cust.isDemo ?? true }));
    this.drivers = INITIAL_DRIVERS;
    this.teamMembers = INITIAL_TEAM;
    this.auditLogs = INITIAL_AUDIT_LOGS;
    this.appEvents = [];
    this.sponsors = INITIAL_SPONSORS;
    this.inventoryMovements = INITIAL_INVENTORY_MOVEMENTS;
    this.notifications = INITIAL_NOTIFICATIONS;

    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.tenants) this.tenants = parsed.tenants;
        if (parsed.categories) this.categories = parsed.categories;
        if (parsed.products) this.products = parsed.products;
        if (parsed.offers) this.offers = parsed.offers;
        if (parsed.promotionCarousels) this.promotionCarousels = parsed.promotionCarousels;
        if (parsed.coupons) this.coupons = parsed.coupons;
        if (parsed.couponRedemptions) this.couponRedemptions = parsed.couponRedemptions;
        if (parsed.orders) this.orders = parsed.orders;
        if (parsed.customers) this.customers = parsed.customers;
        if (parsed.drivers) this.drivers = parsed.drivers;
        if (parsed.teamMembers) this.teamMembers = parsed.teamMembers;
        if (parsed.auditLogs) this.auditLogs = parsed.auditLogs;
        if (parsed.appEvents) this.appEvents = parsed.appEvents;
        if (parsed.inventoryMovements) this.inventoryMovements = parsed.inventoryMovements;
        if (parsed.notifications) this.notifications = parsed.notifications;
      }
    } catch {
      // fallback to initial in-memory
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tenants: this.tenants,
        categories: this.categories,
        products: this.products,
        offers: this.offers,
        promotionCarousels: this.promotionCarousels,
        coupons: this.coupons,
        couponRedemptions: this.couponRedemptions,
        orders: this.orders,
        customers: this.customers,
        drivers: this.drivers,
        teamMembers: this.teamMembers,
        auditLogs: this.auditLogs,
        appEvents: this.appEvents,
        inventoryMovements: this.inventoryMovements,
        notifications: this.notifications,
      }));
    } catch {
      // storage unavailable
    }
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  // --- INFRAESTRUTURA & AUDITORIA DE PERSISTÊNCIA (COMANDO 04) ---
  public getStorageEngineInfo() {
    const demoTenantsCount = this.tenants.filter(t => t.isDemo).length;
    const realTenantsCount = this.tenants.filter(t => !t.isDemo).length;
    const demoOrdersCount = this.orders.filter(o => o.isDemo).length;
    const realOrdersCount = this.orders.filter(o => !o.isDemo).length;
    const demoProductsCount = this.products.filter(p => p.isDemo).length;
    const realProductsCount = this.products.filter(p => !p.isDemo).length;

    return {
      storageEngine: 'LOCAL_STORAGE_PROTOTYPE' as const,
      storageKey: STORAGE_KEY,
      isSupabaseConnected: false,
      isRlsInDatabase: false,
      isRlsInMemory: true,
      counts: {
        tenants: { total: this.tenants.length, demo: demoTenantsCount, real: realTenantsCount },
        products: { total: this.products.length, demo: demoProductsCount, real: realProductsCount },
        orders: { total: this.orders.length, demo: demoOrdersCount, real: realOrdersCount },
        customers: { total: this.customers.length, demo: this.customers.filter(c => c.isDemo).length, real: this.customers.filter(c => !c.isDemo).length },
        inventoryMovements: this.inventoryMovements.length,
        auditLogs: this.auditLogs.length,
      }
    };
  }

  public clearDemoOrders(tenantId?: string): void {
    if (tenantId) {
      this.orders = this.orders.filter(o => !(o.tenantId === tenantId && o.isDemo));
    } else {
      this.orders = this.orders.filter(o => !o.isDemo);
    }
    this.persist();
  }

  // --- TENANTS & CEO ---
  public getTenants(context: SecurityContext): Tenant[] {
    if (context.userRole === 'CEO' || context.userRole === 'SUPER_ADMIN') {
      return [...this.tenants];
    }
    return this.tenants.filter(t => t.id === context.tenantId);
  }

  public getTenantById(context: SecurityContext, tenantId: string): Tenant | undefined {
    validateTenantAccess(context, tenantId, 'GET_TENANT', this.addAuditViolation.bind(this));
    return this.tenants.find(t => t.id === tenantId);
  }

  public getTenantBySlug(slug: string): Tenant | undefined {
    // Público para o app do cliente: suporta slug ou ID para máxima resiliência
    return this.tenants.find(t => t.slug === slug || t.id === slug);
  }

  public updateTenantTheme(context: SecurityContext, tenantId: string, theme: Partial<Tenant['theme']>): void {
    validateTenantAccess(context, tenantId, 'UPDATE_THEME', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    const index = this.tenants.findIndex(t => t.id === tenantId);
    if (index !== -1) {
      const oldTheme = JSON.stringify(this.tenants[index].theme);
      this.tenants[index].theme = { ...this.tenants[index].theme, ...theme };
      const newTheme = JSON.stringify(this.tenants[index].theme);
      
      this.addAuditLog({
        userId: context.userId,
        userName: context.userName,
        userRole: context.userRole,
        tenantId,
        tenantName: this.tenants[index].name,
        action: 'UPDATE_TENANT_THEME',
        resource: 'THEME',
        resourceId: tenantId,
        details: `Cores e estilo visual do tenant ${this.tenants[index].name} alterados.`,
        previousValue: oldTheme,
        newValue: newTheme,
        ipAddress: '189.45.12.90',
        isCeoSupport: !!context.isCeoSupportMode,
      });

      this.persist();
    }
  }

  public updateTenantSettings(context: SecurityContext, tenantId: string, settings: Partial<Tenant['settings']>): void {
    validateTenantAccess(context, tenantId, 'UPDATE_SETTINGS', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    const index = this.tenants.findIndex(t => t.id === tenantId);
    if (index !== -1) {
      const oldVal = JSON.stringify(this.tenants[index].settings);
      this.tenants[index].settings = { ...this.tenants[index].settings, ...settings };
      const newVal = JSON.stringify(this.tenants[index].settings);

      this.addAuditLog({
        userId: context.userId,
        userName: context.userName,
        userRole: context.userRole,
        tenantId,
        tenantName: this.tenants[index].name,
        action: 'UPDATE_TENANT_SETTINGS',
        resource: 'SETTINGS',
        resourceId: tenantId,
        details: `Configurações operacionais do tenant atualizadas.`,
        previousValue: oldVal,
        newValue: newVal,
        ipAddress: '189.45.12.90',
        isCeoSupport: !!context.isCeoSupportMode,
      });
      this.persist();
    }
  }

  // --- CRUD REAL: PRODUTOS (PARTE 4) ---
  public getProducts(context: SecurityContext, tenantId: string): Product[] {
    validateTenantAccess(context, tenantId, 'GET_PRODUCTS', this.addAuditViolation.bind(this));
    return this.products.filter(p => p.tenantId === tenantId);
  }

  public getProductById(context: SecurityContext, tenantId: string, productId: string): Product | undefined {
    validateTenantAccess(context, tenantId, 'GET_PRODUCT_BY_ID', this.addAuditViolation.bind(this));
    return this.products.find(p => p.id === productId && p.tenantId === tenantId);
  }

  public createProduct(context: SecurityContext, tenantId: string, data: Omit<Product, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>): Product {
    validateTenantAccess(context, tenantId, 'CREATE_PRODUCT', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_products');

    const now = new Date().toISOString();
    const newProduct: Product = {
      ...data,
      id: `prod-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId,
      isActive: data.isActive !== undefined ? data.isActive : true,
      isAvailable: data.isAvailable !== undefined ? data.isAvailable : true,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    };

    this.products.unshift(newProduct);

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'CREATE_PRODUCT',
      resource: 'PRODUCT',
      resourceId: newProduct.id,
      details: `Produto "${newProduct.name}" criado com preço R$ ${newProduct.price.toFixed(2)}.`,
      newValue: JSON.stringify({ name: newProduct.name, price: newProduct.price, sku: newProduct.sku }),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return newProduct;
  }

  public updateProduct(context: SecurityContext, tenantId: string, productId: string, updates: Partial<Product>): Product {
    validateTenantAccess(context, tenantId, 'UPDATE_PRODUCT', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_products');

    const index = this.products.findIndex(p => p.id === productId && p.tenantId === tenantId);
    if (index === -1) {
      throw new Error(`Produto não encontrado ou acesso negado ao tenant.`);
    }

    const previousValue = JSON.stringify(this.products[index]);
    const updated: Product = {
      ...this.products[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.products[index] = updated;

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'UPDATE_PRODUCT',
      resource: 'PRODUCT',
      resourceId: productId,
      details: `Produto "${updated.name}" atualizado.`,
      previousValue,
      newValue: JSON.stringify(updated),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return updated;
  }

  public deleteProduct(context: SecurityContext, tenantId: string, productId: string): void {
    validateTenantAccess(context, tenantId, 'DELETE_PRODUCT', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_products');

    const product = this.products.find(p => p.id === productId && p.tenantId === tenantId);
    if (!product) {
      throw new Error('Produto não encontrado no tenant.');
    }

    this.products = this.products.filter(p => !(p.id === productId && p.tenantId === tenantId));

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'DELETE_PRODUCT',
      resource: 'PRODUCT',
      resourceId: productId,
      details: `Produto "${product.name}" excluído.`,
      previousValue: JSON.stringify(product),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
  }

  public duplicateProduct(context: SecurityContext, tenantId: string, productId: string): Product {
    validateTenantAccess(context, tenantId, 'DUPLICATE_PRODUCT', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_products');

    const existing = this.products.find(p => p.id === productId && p.tenantId === tenantId);
    if (!existing) {
      throw new Error('Produto original não encontrado.');
    }

    const now = new Date().toISOString();
    const duplicated: Product = {
      ...existing,
      id: `prod-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: `${existing.name} (Cópia)`,
      sku: existing.sku ? `${existing.sku}-COP` : undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.products.unshift(duplicated);

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'DUPLICATE_PRODUCT',
      resource: 'PRODUCT',
      resourceId: duplicated.id,
      details: `Produto duplicado a partir de "${existing.name}". Novo ID: ${duplicated.id}`,
      newValue: JSON.stringify(duplicated),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return duplicated;
  }

  public toggleProductStatus(context: SecurityContext, tenantId: string, productId: string): boolean {
    validateTenantAccess(context, tenantId, 'TOGGLE_PRODUCT_STATUS', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_products');

    const product = this.products.find(p => p.id === productId && p.tenantId === tenantId);
    if (!product) throw new Error('Produto não encontrado.');

    product.isActive = !product.isActive;
    product.updatedAt = new Date().toISOString();

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: product.isActive ? 'ACTIVATE_PRODUCT' : 'DEACTIVATE_PRODUCT',
      resource: 'PRODUCT',
      resourceId: productId,
      details: `Produto "${product.name}" marcado como ${product.isActive ? 'ATIVO' : 'DESATIVADO'}.`,
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return product.isActive;
  }

  public getPublicProducts(slug: string): Product[] {
    const tenant = this.getTenantBySlug(slug);
    if (!tenant) return [];
    return this.products.filter(p => p.tenantId === tenant.id && p.isAvailable && p.isActive !== false);
  }

  // --- CRUD REAL: CATEGORIAS (PARTE 5) ---
  public getCategories(context: SecurityContext, tenantId: string): Category[] {
    validateTenantAccess(context, tenantId, 'GET_CATEGORIES', this.addAuditViolation.bind(this));
    return this.categories
      .filter(c => c.tenantId === tenantId)
      .sort((a, b) => a.order - b.order);
  }

  public createCategory(context: SecurityContext, tenantId: string, data: Omit<Category, 'id' | 'tenantId' | 'createdAt'>): Category {
    validateTenantAccess(context, tenantId, 'CREATE_CATEGORY', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_categories');

    const newCategory: Category = {
      ...data,
      id: `cat-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId,
      isActive: data.isActive !== undefined ? data.isActive : true,
      createdAt: new Date().toISOString(),
    };

    this.categories.push(newCategory);

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'CREATE_CATEGORY',
      resource: 'CATEGORY',
      resourceId: newCategory.id,
      details: `Categoria "${newCategory.name}" criada.`,
      newValue: JSON.stringify(newCategory),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return newCategory;
  }

  public updateCategory(context: SecurityContext, tenantId: string, categoryId: string, updates: Partial<Category>): Category {
    validateTenantAccess(context, tenantId, 'UPDATE_CATEGORY', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_categories');

    const index = this.categories.findIndex(c => c.id === categoryId && c.tenantId === tenantId);
    if (index === -1) throw new Error('Categoria não encontrada.');

    const previousValue = JSON.stringify(this.categories[index]);
    this.categories[index] = { ...this.categories[index], ...updates };

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'UPDATE_CATEGORY',
      resource: 'CATEGORY',
      resourceId: categoryId,
      details: `Categoria "${this.categories[index].name}" atualizada.`,
      previousValue,
      newValue: JSON.stringify(this.categories[index]),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return this.categories[index];
  }

  public deleteCategory(context: SecurityContext, tenantId: string, categoryId: string): void {
    validateTenantAccess(context, tenantId, 'DELETE_CATEGORY', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_categories');

    const category = this.categories.find(c => c.id === categoryId && c.tenantId === tenantId);
    if (!category) throw new Error('Categoria não encontrada.');

    this.categories = this.categories.filter(c => !(c.id === categoryId && c.tenantId === tenantId));

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'DELETE_CATEGORY',
      resource: 'CATEGORY',
      resourceId: categoryId,
      details: `Categoria "${category.name}" excluída.`,
      previousValue: JSON.stringify(category),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
  }

  public toggleCategoryStatus(context: SecurityContext, tenantId: string, categoryId: string): boolean {
    validateTenantAccess(context, tenantId, 'TOGGLE_CATEGORY_STATUS', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_categories');

    const category = this.categories.find(c => c.id === categoryId && c.tenantId === tenantId);
    if (!category) throw new Error('Categoria não encontrada.');

    category.isActive = !category.isActive;

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: category.isActive ? 'ACTIVATE_CATEGORY' : 'DEACTIVATE_CATEGORY',
      resource: 'CATEGORY',
      resourceId: categoryId,
      details: `Categoria "${category.name}" agora está ${category.isActive ? 'ATIVA' : 'DESATIVADA'}.`,
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return category.isActive;
  }

  public reorderCategories(context: SecurityContext, tenantId: string, orderedIds: string[]): void {
    validateTenantAccess(context, tenantId, 'REORDER_CATEGORIES', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_categories');

    orderedIds.forEach((id, index) => {
      const cat = this.categories.find(c => c.id === id && c.tenantId === tenantId);
      if (cat) cat.order = index + 1;
    });

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'REORDER_CATEGORIES',
      resource: 'CATEGORY',
      details: `Ordem das categorias reordenada no catálogo.`,
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
  }

  public getPublicCategories(slug: string): Category[] {
    const tenant = this.getTenantBySlug(slug);
    if (!tenant) return [];
    return this.categories
      .filter(c => c.tenantId === tenant.id && c.isActive)
      .sort((a, b) => a.order - b.order);
  }

  // --- CRUD REAL: CRIATIVOS PROMOCIONAIS & OFERTAS (COMANDO 139) ---
  public calculateCardStatus(card: { isActive: boolean; startDate?: string; endDate?: string; startAt?: string; endAt?: string }): CardStatus {
    return calculatePromoCardStatus(card);
  }

  public getOffers(context: SecurityContext, tenantId: string): Offer[] {
    validateTenantAccess(context, tenantId, 'GET_OFFERS', this.addAuditViolation.bind(this));
    return this.offers
      .filter(o => o.tenantId === tenantId)
      .map(o => ({
        ...o,
        computedStatus: this.calculateCardStatus(o),
        mediaUrl: o.mediaUrl || o.imageUrl,
        imageUrl: o.imageUrl || o.mediaUrl,
        cardFormat: o.cardFormat || 'HORIZONTAL',
        mediaType: o.mediaType || 'IMAGE',
        displayMode: o.displayMode || 'EDITABLE_CARD',
        durationSeconds: Number(o.durationSeconds ?? 5),
      }))
      .sort((a, b) => a.order - b.order);
  }

  public createOffer(context: SecurityContext, tenantId: string, data: Omit<Offer, 'id' | 'tenantId' | 'createdAt'>): Offer {
    validateTenantAccess(context, tenantId, 'CREATE_OFFER', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_offers');

    const mediaUrl = data.mediaUrl || data.imageUrl || '';
    const imageUrl = data.imageUrl || data.mediaUrl || '';
    const cardFormat = data.cardFormat || 'HORIZONTAL';
    const mediaType = data.mediaType || 'IMAGE';
    const displayMode = data.displayMode || 'EDITABLE_CARD';
    const durationSeconds = Number(data.durationSeconds ?? 5);

    const newOffer: Offer = {
      ...data,
      mediaUrl,
      imageUrl,
      cardFormat,
      mediaType,
      displayMode,
      durationSeconds,
      id: `off-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId,
      isActive: data.isActive !== undefined ? data.isActive : true,
      order: data.order || (this.offers.filter(o => o.tenantId === tenantId).length + 1),
      createdAt: new Date().toISOString(),
    };
    newOffer.computedStatus = this.calculateCardStatus(newOffer);

    this.offers.push(newOffer);

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'CREATE_OFFER',
      resource: 'OFFER',
      resourceId: newOffer.id,
      details: `Card Promocional "${newOffer.title}" (${newOffer.cardFormat}, ${newOffer.mediaType}, ${newOffer.displayMode}) criado.`,
      newValue: JSON.stringify(newOffer),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return newOffer;
  }

  public updateOffer(context: SecurityContext, tenantId: string, offerId: string, updates: Partial<Offer>): Offer {
    validateTenantAccess(context, tenantId, 'UPDATE_OFFER', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_offers');

    const index = this.offers.findIndex(o => o.id === offerId && o.tenantId === tenantId);
    if (index === -1) throw new Error('Oferta não encontrada.');

    const previousValue = JSON.stringify(this.offers[index]);
    const updatedMediaUrl = updates.mediaUrl || (updates.imageUrl ? updates.imageUrl : this.offers[index].mediaUrl);
    const updatedImageUrl = updates.imageUrl || (updates.mediaUrl ? updates.mediaUrl : this.offers[index].imageUrl);
    const updatedDisplayMode = updates.displayMode !== undefined ? updates.displayMode : this.offers[index].displayMode;

    this.offers[index] = { 
      ...this.offers[index], 
      ...updates,
      mediaUrl: updatedMediaUrl || this.offers[index].mediaUrl,
      imageUrl: updatedImageUrl || this.offers[index].imageUrl,
      displayMode: updatedDisplayMode || 'EDITABLE_CARD',
      updatedAt: new Date().toISOString()
    };
    this.offers[index].computedStatus = this.calculateCardStatus(this.offers[index]);

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'UPDATE_OFFER',
      resource: 'OFFER',
      resourceId: offerId,
      details: `Card Promocional "${this.offers[index].title}" atualizado.`,
      previousValue,
      newValue: JSON.stringify(this.offers[index]),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return this.offers[index];
  }

  public duplicateOffer(context: SecurityContext, tenantId: string, offerId: string): Offer {
    validateTenantAccess(context, tenantId, 'DUPLICATE_OFFER', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_offers');

    const source = this.offers.find(o => o.id === offerId && o.tenantId === tenantId);
    if (!source) throw new Error('Card original não encontrado para duplicação.');

    const { id: _, createdAt: __, updatedAt: ___, ...data } = source;
    return this.createOffer(context, tenantId, {
      ...data,
      title: `${source.title} (Cópia)`,
      order: this.offers.filter(o => o.tenantId === tenantId).length + 1,
    });
  }

  public reorderOffers(context: SecurityContext, tenantId: string, offerIds: string[]): Offer[] {
    validateTenantAccess(context, tenantId, 'REORDER_OFFERS', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_offers');

    offerIds.forEach((id, idx) => {
      const off = this.offers.find(o => o.id === id && o.tenantId === tenantId);
      if (off) {
        off.order = idx + 1;
      }
    });

    this.persist();
    return this.getOffers(context, tenantId);
  }

  public deleteOffer(context: SecurityContext, tenantId: string, offerId: string): void {
    validateTenantAccess(context, tenantId, 'DELETE_OFFER', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_offers');

    const offer = this.offers.find(o => o.id === offerId && o.tenantId === tenantId);
    if (!offer) throw new Error('Oferta não encontrada.');

    this.offers = this.offers.filter(o => !(o.id === offerId && o.tenantId === tenantId));

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'DELETE_OFFER',
      resource: 'OFFER',
      resourceId: offerId,
      details: `Oferta "${offer.title}" removida do carrossel.`,
      previousValue: JSON.stringify(offer),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
  }

  public toggleOfferStatus(context: SecurityContext, tenantId: string, offerId: string): boolean {
    validateTenantAccess(context, tenantId, 'TOGGLE_OFFER_STATUS', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_offers');

    const offer = this.offers.find(o => o.id === offerId && o.tenantId === tenantId);
    if (!offer) throw new Error('Oferta não encontrada.');

    offer.isActive = !offer.isActive;
    offer.computedStatus = this.calculateCardStatus(offer);

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: offer.isActive ? 'ACTIVATE_OFFER' : 'DEACTIVATE_OFFER',
      resource: 'OFFER',
      resourceId: offerId,
      details: `Oferta "${offer.title}" agora está ${offer.isActive ? 'ATIVA' : 'PAUSADA'}.`,
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return offer.isActive;
  }

  public getPublicOffers(slug: string): Offer[] {
    const tenant = this.getTenantBySlug(slug);
    if (!tenant) return [];
    return this.offers
      .filter(o => {
        if (o.tenantId !== tenant.id) return false;
        const status = this.calculateCardStatus(o);
        return status === 'ACTIVE';
      })
      .map(o => ({
        ...o,
        computedStatus: 'ACTIVE' as CardStatus,
        mediaUrl: o.mediaUrl || o.imageUrl,
        imageUrl: o.imageUrl || o.mediaUrl,
        cardFormat: o.cardFormat || 'HORIZONTAL',
        mediaType: o.mediaType || 'IMAGE',
        displayMode: o.displayMode || 'EDITABLE_CARD',
        durationSeconds: Number(o.durationSeconds ?? 5),
        isExhausted: Boolean(o.promoUsageLimit && Number(o.promoTimesUsed || 0) >= o.promoUsageLimit),
        remainingUses: o.promoUsageLimit ? Math.max(0, o.promoUsageLimit - Number(o.promoTimesUsed || 0)) : null,
      }))
      .sort((a, b) => a.order - b.order);
  }

  public processPromotionalCheckout(
    slug: string,
    payload: {
      offerId: string;
      quantity: number;
      customerName: string;
      customerPhone: string;
      customerEmail?: string;
      deliveryAddress?: string;
      addressDetails?: any;
      paymentMethod: string;
      fulfillmentType?: 'DELIVERY' | 'PICKUP';
      notes?: string;
      couponCode?: string;
    }
  ): {
    orderId: string;
    redemptionNumber?: number;
    celebrationMessage?: string;
    totalAmount: number;
    isExhausted?: boolean;
  } {
    const tenant = this.getTenantBySlug(slug);
    if (!tenant) throw new Error('Estabelecimento não encontrado.');

    const offer = this.offers.find(o => o.id === payload.offerId && o.tenantId === tenant.id);
    if (!offer) throw new Error('Card promocional não encontrado.');

    if (!offer.isActive) throw new Error('Esta promoção está desativada.');

    const status = this.calculateCardStatus(offer);
    if (status === 'SCHEDULED') throw new Error('Esta promoção ainda não iniciou.');
    if (status === 'EXPIRED') throw new Error('Esta promoção já expirou.');

    if (offer.promoUsageLimit && offer.promoUsageLimit > 0) {
      if ((offer.promoTimesUsed || 0) >= offer.promoUsageLimit) {
        throw new Error(`Esta promoção atingiu o limite de ${offer.promoUsageLimit} usos e está esgotada.`);
      }
    }

    if (offer.promoMaxQuantityPerCustomer && payload.quantity > offer.promoMaxQuantityPerCustomer) {
      throw new Error(`Quantidade máxima permitida por cliente nesta promoção: ${offer.promoMaxQuantityPerCustomer} un.`);
    }

    const unitPrice = offer.promoPrice || offer.promotionalPrice || offer.originalPrice || 0;
    if (unitPrice <= 0) throw new Error('Preço promocional inválido.');

    const origPrice = offer.promoOriginalPrice || offer.originalPrice || unitPrice;
    const subtotal = unitPrice * payload.quantity;

    let deliveryFee = payload.fulfillmentType === 'PICKUP' ? 0 : (tenant.settings.deliveryFee || 0);
    if (tenant.settings.freeDeliveryThreshold && subtotal >= tenant.settings.freeDeliveryThreshold) {
      deliveryFee = 0;
    }

    let couponDiscount = 0;
    if (payload.couponCode) {
      const cRes = this.validatePublicCoupon(tenant.id, payload.couponCode, subtotal);
      if (cRes.isValid && cRes.discountAmount) {
        couponDiscount = cRes.discountAmount;
      }
    }

    const totalAmount = Math.max(0, subtotal + deliveryFee - couponDiscount);
    const newTimesUsed = (offer.promoTimesUsed || 0) + 1;
    offer.promoTimesUsed = newTimesUsed;

    const celebrationMessage = (offer.promoUsageLimit && offer.promoUsageLimit > 0)
      ? `🎉 Parabéns! Você foi o cliente nº ${newTimesUsed} a aproveitar esta promoção!`
      : undefined;

    const orderId = `ord-promo-${Date.now()}`;
    const orderNumber = (this.orders.filter(o => o.tenantId === tenant.id).length + 1).toString().padStart(4, '0');

    const newOrder: any = {
      id: orderId,
      orderNumber,
      tenantId: tenant.id,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      customerEmail: payload.customerEmail,
      deliveryAddress: payload.deliveryAddress || (payload.fulfillmentType === 'PICKUP' ? 'Retirada no Balcão' : ''),
      addressDetails: payload.addressDetails,
      subtotal,
      deliveryFee,
      discount: couponDiscount,
      totalAmount,
      paymentMethod: payload.paymentMethod,
      paymentStatus: 'PENDING',
      fulfillmentType: payload.fulfillmentType || 'DELIVERY',
      status: 'PENDING',
      notes: payload.notes || '',
      origin: 'promotional_checkout',
      prepTimeMinutes: tenant.settings.defaultPrepTimeMinutes || 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [
        {
          id: `item-${Date.now()}`,
          orderId,
          productId: offer.productId || `promo-${offer.id}`,
          productName: offer.promoTitle || offer.title,
          quantity: payload.quantity,
          unitPrice,
          totalPrice: subtotal,
          unit: offer.promoUnit || 'un',
          notes: payload.notes,
        },
      ],
      statusHistory: [
        {
          id: `hist-${Date.now()}`,
          orderId,
          status: 'PENDING',
          note: 'Pedido confirmado via Checkout Promocional',
          changedBy: 'Checkout Promocional',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    this.orders.unshift(newOrder);

    // Se vinculado a produto real, decrementa estoque se houver produto
    if (offer.productId) {
      const prod = this.products.find(p => p.id === offer.productId && p.tenantId === tenant.id);
      if (prod && prod.stockQuantity !== undefined) {
        prod.stockQuantity = Math.max(0, prod.stockQuantity - payload.quantity);
      }
    }

    this.persist();

    return {
      orderId,
      redemptionNumber: newTimesUsed,
      celebrationMessage,
      totalAmount,
      isExhausted: Boolean(offer.promoUsageLimit && newTimesUsed >= offer.promoUsageLimit),
    };
  }

  // --- CARROSSÉIS DE PROMOÇÃO (COMANDO 138) ---
  public getPromotionCarousels(context: SecurityContext, tenantId: string): PromotionCarousel[] {
    validateTenantAccess(context, tenantId, 'GET_PROMOTION_CAROUSELS', this.addAuditViolation.bind(this));
    return this.promotionCarousels
      .filter(c => c.tenantId === tenantId)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(c => ({
        ...c,
        items: (c.items || []).map(item => {
          const product = this.products.find(p => p.id === item.productId && p.tenantId === tenantId);
          return {
            ...item,
            product,
          };
        }).sort((a, b) => a.displayOrder - b.displayOrder),
      }));
  }

  public getPublicPromotionCarousels(slugOrTenantId: string): PromotionCarousel[] {
    const tenant = this.getTenantBySlug(slugOrTenantId);
    if (!tenant) return [];

    const now = new Date();
    return this.promotionCarousels
      .filter(c => c.tenantId === tenant.id && c.isActive && c.showInStore)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(c => {
        const validItems = (c.items || [])
          .filter(item => {
            if (!item.isActive) return false;
            const product = this.products.find(p => p.id === item.productId && p.tenantId === tenant.id);
            if (!product || !product.isActive || product.stockQuantity <= 0) return false;
            if (item.startDate && new Date(item.startDate) > now) return false;
            if (item.endDate && new Date(item.endDate) < now) return false;
            if (item.promotionalPrice >= product.price || item.promotionalPrice <= 0) return false;
            return true;
          })
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map(item => {
            const product = this.products.find(p => p.id === item.productId)!;
            const calculatedDiscountPercentage = Math.round(((product.price - item.promotionalPrice) / product.price) * 100);
            return {
              ...item,
              product,
              calculatedDiscountPercentage,
            };
          });

        return {
          ...c,
          items: validItems,
        };
      })
      .filter(c => c.items.length > 0);
  }

  public createPromotionCarousel(
    context: SecurityContext, 
    tenantId: string, 
    data: { name: string; description?: string; imageUrl?: string; showInStore?: boolean }
  ): PromotionCarousel {
    validateTenantAccess(context, tenantId, 'CREATE_PROMOTION_CAROUSEL', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    const newCarousel: PromotionCarousel = {
      id: `carousel-${Date.now()}`,
      tenantId,
      name: data.name.trim(),
      description: data.description?.trim(),
      imageUrl: data.imageUrl,
      isActive: true,
      showInStore: data.showInStore ?? true,
      displayOrder: this.promotionCarousels.filter(c => c.tenantId === tenantId).length,
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.promotionCarousels.push(newCarousel);
    this.persist();
    return newCarousel;
  }

  public updatePromotionCarousel(
    context: SecurityContext, 
    tenantId: string, 
    carouselId: string, 
    updates: Partial<PromotionCarousel>
  ): PromotionCarousel {
    validateTenantAccess(context, tenantId, 'UPDATE_PROMOTION_CAROUSEL', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    const carousel = this.promotionCarousels.find(c => c.id === carouselId && c.tenantId === tenantId);
    if (!carousel) throw new Error('Carrossel de promoção não encontrado.');

    if (updates.name !== undefined) carousel.name = updates.name.trim();
    if (updates.description !== undefined) carousel.description = updates.description?.trim();
    if (updates.imageUrl !== undefined) carousel.imageUrl = updates.imageUrl;
    if (updates.isActive !== undefined) carousel.isActive = updates.isActive;
    if (updates.showInStore !== undefined) carousel.showInStore = updates.showInStore;
    if (updates.displayOrder !== undefined) carousel.displayOrder = updates.displayOrder;
    carousel.updatedAt = new Date().toISOString();

    this.persist();
    return carousel;
  }

  public deletePromotionCarousel(context: SecurityContext, tenantId: string, carouselId: string): void {
    validateTenantAccess(context, tenantId, 'DELETE_PROMOTION_CAROUSEL', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    const index = this.promotionCarousels.findIndex(c => c.id === carouselId && c.tenantId === tenantId);
    if (index !== -1) {
      this.promotionCarousels.splice(index, 1);
      this.persist();
    }
  }

  public addProductsToCarousel(
    context: SecurityContext, 
    tenantId: string, 
    carouselId: string, 
    productIds: string[]
  ): PromotionCarousel {
    validateTenantAccess(context, tenantId, 'ADD_PRODUCTS_TO_CAROUSEL', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    const carousel = this.promotionCarousels.find(c => c.id === carouselId && c.tenantId === tenantId);
    if (!carousel) throw new Error('Carrossel não encontrado.');

    if (!carousel.items) carousel.items = [];

    for (const pId of productIds) {
      // Evita duplicar o mesmo produto no mesmo carrossel
      if (carousel.items.some(i => i.productId === pId)) continue;

      const product = this.products.find(p => p.id === pId && p.tenantId === tenantId);
      if (!product) continue;

      // Desconto inicial sugerido de 10%
      const discountValue = 10;
      const promotionalPrice = Math.max(0.01, Number((product.price * 0.9).toFixed(2)));

      const newItem: PromotionCarouselItem = {
        id: `pci-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        carouselId,
        productId: pId,
        tenantId,
        discountType: 'PERCENTAGE',
        discountValue,
        promotionalPrice,
        calculatedDiscountPercentage: 10,
        showDiscountBadge: true,
        showPromotionalPrice: true,
        isActive: true,
        displayOrder: carousel.items.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      carousel.items.push(newItem);
    }

    carousel.updatedAt = new Date().toISOString();
    this.persist();
    return carousel;
  }

  public updateCarouselItemPromotion(
    context: SecurityContext, 
    tenantId: string, 
    carouselId: string, 
    itemId: string, 
    promotionData: Partial<PromotionCarouselItem>
  ): PromotionCarousel {
    validateTenantAccess(context, tenantId, 'UPDATE_CAROUSEL_ITEM', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    const carousel = this.promotionCarousels.find(c => c.id === carouselId && c.tenantId === tenantId);
    if (!carousel) throw new Error('Carrossel não encontrado.');

    const item = carousel.items.find(i => i.id === itemId);
    if (!item) throw new Error('Item promocional não encontrado.');

    const product = this.products.find(p => p.id === item.productId && p.tenantId === tenantId);
    if (!product) throw new Error('Produto não encontrado.');

    if (promotionData.discountType !== undefined) item.discountType = promotionData.discountType;
    if (promotionData.discountValue !== undefined) item.discountValue = Number(promotionData.discountValue);
    if (promotionData.promotionalPrice !== undefined) {
      const pPrice = Number(promotionData.promotionalPrice);
      if (pPrice >= product.price) {
        throw new Error('O preço promocional deve ser menor que o preço original do produto.');
      }
      if (pPrice <= 0) {
        throw new Error('O preço promocional deve ser maior que zero.');
      }
      item.promotionalPrice = pPrice;
    }
    if (promotionData.showDiscountBadge !== undefined) item.showDiscountBadge = promotionData.showDiscountBadge;
    if (promotionData.showPromotionalPrice !== undefined) item.showPromotionalPrice = promotionData.showPromotionalPrice;
    if (promotionData.startDate !== undefined) item.startDate = promotionData.startDate;
    if (promotionData.endDate !== undefined) item.endDate = promotionData.endDate;
    if (promotionData.isActive !== undefined) item.isActive = promotionData.isActive;

    item.calculatedDiscountPercentage = Math.round(((product.price - item.promotionalPrice) / product.price) * 100);
    item.updatedAt = new Date().toISOString();
    carousel.updatedAt = new Date().toISOString();

    this.persist();
    return carousel;
  }

  public removeProductFromCarousel(
    context: SecurityContext, 
    tenantId: string, 
    carouselId: string, 
    itemId: string
  ): PromotionCarousel {
    validateTenantAccess(context, tenantId, 'REMOVE_PRODUCT_FROM_CAROUSEL', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    const carousel = this.promotionCarousels.find(c => c.id === carouselId && c.tenantId === tenantId);
    if (!carousel) throw new Error('Carrossel não encontrado.');

    carousel.items = carousel.items.filter(i => i.id !== itemId);
    carousel.items.forEach((item, index) => {
      item.displayOrder = index;
    });

    carousel.updatedAt = new Date().toISOString();
    this.persist();
    return carousel;
  }

  public reorderCarouselItems(
    context: SecurityContext, 
    tenantId: string, 
    carouselId: string, 
    itemIds: string[]
  ): PromotionCarousel {
    validateTenantAccess(context, tenantId, 'REORDER_CAROUSEL_ITEMS', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    const carousel = this.promotionCarousels.find(c => c.id === carouselId && c.tenantId === tenantId);
    if (!carousel) throw new Error('Carrossel não encontrado.');

    const reordered: PromotionCarouselItem[] = [];
    itemIds.forEach((id, index) => {
      const item = carousel.items.find(i => i.id === id);
      if (item) {
        item.displayOrder = index;
        reordered.push(item);
      }
    });

    carousel.items = reordered;
    carousel.updatedAt = new Date().toISOString();
    this.persist();
    return carousel;
  }

  public reorderCarousels(context: SecurityContext, tenantId: string, carouselIds: string[]): void {
    validateTenantAccess(context, tenantId, 'REORDER_CAROUSELS', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    carouselIds.forEach((id, index) => {
      const c = this.promotionCarousels.find(item => item.id === id && item.tenantId === tenantId);
      if (c) {
        c.displayOrder = index;
      }
    });

    this.persist();
  }

  // --- CUPONS (COMANDO 138) ---
  public getCoupons(context: SecurityContext, tenantId: string): Coupon[] {
    validateTenantAccess(context, tenantId, 'GET_COUPONS', this.addAuditViolation.bind(this));
    return this.coupons
      .filter(c => c.tenantId === tenantId)
      .map(c => {
        const customer = c.customerId ? this.customers.find(cust => cust.id === c.customerId) : undefined;
        return {
          ...c,
          customerName: customer?.name,
        };
      })
      .sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
  }

  public createCoupon(context: SecurityContext, tenantId: string, data: Partial<Coupon>): Coupon {
    validateTenantAccess(context, tenantId, 'CREATE_COUPON', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    if (!data.code || !data.code.trim()) {
      throw new Error('Código do cupom é obrigatório.');
    }

    const cleanCode = data.code.trim().toUpperCase();
    const existing = this.coupons.find(c => c.tenantId === tenantId && c.code === cleanCode);
    if (existing) {
      throw new Error(`O cupom "${cleanCode}" já existe neste estabelecimento.`);
    }

    const newCoupon: Coupon = {
      id: `coup-${Date.now()}`,
      tenantId,
      code: cleanCode,
      discountType: data.discountType || 'PERCENTAGE',
      discountValue: Number(data.discountValue || 10),
      minOrderValue: data.minOrderValue ? Number(data.minOrderValue) : 0,
      usageLimit: data.usageLimit ? Number(data.usageLimit) : undefined,
      usageLimitPerCustomer: data.usageLimitPerCustomer ? Number(data.usageLimitPerCustomer) : 1,
      timesUsed: 0,
      customerId: data.customerId || undefined,
      startDate: data.startDate,
      endDate: data.endDate,
      isActive: data.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.coupons.push(newCoupon);
    this.persist();
    return newCoupon;
  }

  public updateCoupon(context: SecurityContext, tenantId: string, couponId: string, updates: Partial<Coupon>): Coupon {
    validateTenantAccess(context, tenantId, 'UPDATE_COUPON', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    const coupon = this.coupons.find(c => c.id === couponId && c.tenantId === tenantId);
    if (!coupon) throw new Error('Cupom não encontrado.');

    if (updates.code) coupon.code = updates.code.trim().toUpperCase();
    if (updates.discountType) coupon.discountType = updates.discountType;
    if (updates.discountValue !== undefined) coupon.discountValue = Number(updates.discountValue);
    if (updates.minOrderValue !== undefined) coupon.minOrderValue = Number(updates.minOrderValue);
    if (updates.usageLimit !== undefined) coupon.usageLimit = updates.usageLimit ? Number(updates.usageLimit) : undefined;
    if (updates.usageLimitPerCustomer !== undefined) coupon.usageLimitPerCustomer = Number(updates.usageLimitPerCustomer);
    if (updates.customerId !== undefined) coupon.customerId = updates.customerId || undefined;
    if (updates.startDate !== undefined) coupon.startDate = updates.startDate;
    if (updates.endDate !== undefined) coupon.endDate = updates.endDate;
    if (updates.isActive !== undefined) coupon.isActive = updates.isActive;
    coupon.updatedAt = new Date().toISOString();

    this.persist();
    return coupon;
  }

  public deleteCoupon(context: SecurityContext, tenantId: string, couponId: string): void {
    validateTenantAccess(context, tenantId, 'DELETE_COUPON', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_theme');

    const index = this.coupons.findIndex(c => c.id === couponId && c.tenantId === tenantId);
    if (index !== -1) {
      this.coupons.splice(index, 1);
      this.persist();
    }
  }

  public validatePublicCoupon(slugOrTenantId: string, couponCode: string, orderSubtotal: number): ValidateCouponResult {
    const tenant = this.getTenantBySlug(slugOrTenantId) || this.tenants.find(t => t.id === slugOrTenantId);
    if (!tenant) {
      return { isValid: false, discountAmount: 0, message: 'Estabelecimento não encontrado.' };
    }

    const clean = couponCode.trim().toUpperCase();
    if (!clean) {
      return { isValid: false, discountAmount: 0, message: 'Digite o código do cupom.' };
    }

    const coupon = this.coupons.find(c => c.tenantId === tenant.id && c.code === clean);
    if (!coupon) {
      return { isValid: false, discountAmount: 0, message: 'Cupom inválido ou inexistente para esta loja.' };
    }

    if (!coupon.isActive) {
      return { isValid: false, discountAmount: 0, message: 'Este cupom foi desativado.' };
    }

    const now = new Date();
    if (coupon.startDate && new Date(coupon.startDate) > now) {
      return { isValid: false, discountAmount: 0, message: 'Este cupom ainda não é válido.' };
    }

    if (coupon.endDate && new Date(coupon.endDate) < now) {
      return { isValid: false, discountAmount: 0, message: 'Este cupom já expirou.' };
    }

    const remainingUses = coupon.usageLimit !== undefined 
      ? Math.max(0, coupon.usageLimit - (coupon.timesUsed || 0)) 
      : null;

    if (coupon.usageLimit && (coupon.timesUsed || 0) >= coupon.usageLimit) {
      return { 
        isValid: false, 
        discountAmount: 0, 
        remainingUses: 0,
        message: 'Cupom esgotado! Todas as utilizações já foram resgatadas.' 
      };
    }

    if (coupon.minOrderValue && orderSubtotal < coupon.minOrderValue) {
      return {
        isValid: false,
        discountAmount: 0,
        remainingUses,
        message: `Pedido mínimo de R$ ${coupon.minOrderValue.toFixed(2)} necessário para este cupom.`,
      };
    }

    let discountAmount = 0;
    if (coupon.discountType === 'PERCENTAGE') {
      discountAmount = Number(((orderSubtotal * coupon.discountValue) / 100).toFixed(2));
    } else {
      discountAmount = Math.min(orderSubtotal, Number(coupon.discountValue.toFixed(2)));
    }

    const urgencyNote = remainingUses !== null && remainingUses <= 10
      ? ` Restam apenas ${remainingUses} utilizações!`
      : '';

    return {
      isValid: true,
      coupon,
      discountAmount,
      remainingUses,
      message: `Cupom "${coupon.code}" aplicado com sucesso!${urgencyNote}`,
    };
  }

  public redeemCoupon(
    tenantId: string, 
    couponCode: string, 
    orderId?: string, 
    customerId?: string, 
    discountApplied?: number
  ): RedeemCouponResult {
    const clean = couponCode.trim().toUpperCase();
    const coupon = this.coupons.find(c => c.tenantId === tenantId && c.code === clean);
    if (!coupon) {
      return { success: false, message: 'Cupom não encontrado.' };
    }

    if (!coupon.isActive) {
      return { success: false, message: 'Cupom inativo.' };
    }

    if (coupon.usageLimit && (coupon.timesUsed || 0) >= coupon.usageLimit) {
      return {
        success: false,
        isExhausted: true,
        couponId: coupon.id,
        couponCode: coupon.code,
        remainingUses: 0,
        message: 'Cupom esgotado! Limite de utilizações atingido.'
      };
    }

    // Atomic increment
    coupon.timesUsed = (coupon.timesUsed || 0) + 1;
    coupon.updatedAt = new Date().toISOString();

    const redemptionNumber = coupon.timesUsed;
    const remaining = coupon.usageLimit ? Math.max(0, coupon.usageLimit - coupon.timesUsed) : null;

    const redemp: CouponRedemption = {
      id: `redemp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId,
      couponId: coupon.id,
      customerId,
      orderId,
      redemptionNumber,
      discountApplied: discountApplied || 0,
      createdAt: new Date().toISOString()
    };

    this.couponRedemptions.push(redemp);
    this.persist();

    return {
      success: true,
      isExhausted: remaining !== null && remaining <= 0,
      couponId: coupon.id,
      couponCode: coupon.code,
      redemptionNumber,
      discountAmount: discountApplied,
      remainingUses: remaining,
      message: `Você garantiu a oferta como comprador nº ${redemptionNumber}!`,
    };
  }

  // --- ORDERS (ISOLAMENTO ESTRITO & CICLO DE VIDA) ---
  public getOrders(context: SecurityContext, tenantId: string): Order[] {
    validateTenantAccess(context, tenantId, 'GET_ORDERS', this.addAuditViolation.bind(this));
    validatePermission(context, 'view_orders');
    return this.orders.filter(o => o.tenantId === tenantId);
  }

  public getOrderById(context: SecurityContext, tenantId: string, orderId: string): Order | undefined {
    validateTenantAccess(context, tenantId, 'GET_ORDER_BY_ID', this.addAuditViolation.bind(this));
    validatePermission(context, 'view_orders');
    return this.orders.find(o => o.id === orderId && o.tenantId === tenantId);
  }

  public updateOrderStatus(
    context: SecurityContext, 
    tenantId: string, 
    orderId: string, 
    newStatus: Order['status'],
    note?: string
  ): Order {
    validateTenantAccess(context, tenantId, 'UPDATE_ORDER_STATUS', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_orders');

    const order = this.orders.find(o => o.id === orderId && o.tenantId === tenantId);
    if (!order) throw new Error('Pedido não encontrado.');

    const oldStatus = order.status;
    order.status = newStatus;
    order.updatedAt = new Date().toISOString();

    if (!order.statusHistory) {
      order.statusHistory = [];
    }
    
    order.statusHistory.push({
      status: newStatus,
      timestamp: new Date().toISOString(),
      note: note || `Status alterado de ${oldStatus} para ${newStatus}.`,
      changedBy: context.userName,
    });

    // Se entregue, marcar pagamento como concluído se ainda estava pendente na entrega
    if (newStatus === 'DELIVERED' && order.paymentStatus === 'PAYMENT_ON_DELIVERY') {
      order.paymentStatus = 'PAID';
    }

    // REGRA DE CANCELAMENTO & REVERSÃO DE ESTOQUE (FASE 3 - REQUISITO 18)
    if (newStatus === 'CANCELLED' && oldStatus !== 'CANCELLED') {
      order.items.forEach(item => {
        const prod = this.products.find(p => p.id === item.productId && p.tenantId === tenantId);
        if (prod) {
          const prev = prod.stockQuantity;
          prod.stockQuantity += item.quantity;
          prod.updatedAt = new Date().toISOString();

          this.inventoryMovements.unshift({
            id: `mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            tenantId,
            productId: prod.id,
            productName: prod.name,
            quantity: item.quantity,
            type: 'ESTORNO',
            referenceId: order.id,
            reason: `Estorno de estoque por cancelamento do Pedido #${order.orderNumber}`,
            previousStock: prev,
            newStock: prod.stockQuantity,
            timestamp: new Date().toISOString(),
            createdByName: context.userName,
          });
        }
      });
    }

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'UPDATE_ORDER_STATUS',
      resource: 'ORDER',
      resourceId: orderId,
      details: `Pedido #${order.orderNumber} teve status alterado de ${oldStatus} para ${newStatus}.`,
      previousValue: `status: ${oldStatus}`,
      newValue: `status: ${newStatus}`,
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.addNotification(tenantId, {
      title: `Pedido #${order.orderNumber}: ${newStatus}`,
      message: `Status atualizado para "${newStatus}" por ${context.userName}.`,
      type: 'ORDER_STATUS',
      orderId: order.id,
    });

    this.persist();
    return order;
  }

  // --- CUSTOMERS (DADOS PESSOAIS / LGPD) ---
  public getCustomers(context: SecurityContext, tenantId: string): Customer[] {
    validateTenantAccess(context, tenantId, 'GET_CUSTOMERS', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_customers');
    return this.customers.filter(c => c.tenantId === tenantId);
  }

  // --- DRIVERS ---
  public getDrivers(context: SecurityContext, tenantId: string): Driver[] {
    validateTenantAccess(context, tenantId, 'GET_DRIVERS', this.addAuditViolation.bind(this));
    return this.drivers.filter(d => d.tenantId === tenantId);
  }

  // --- EQUIPE (TEAM MEMBERS) ---
  public getTeamMembers(context: SecurityContext, tenantId: string): TeamMember[] {
    validateTenantAccess(context, tenantId, 'GET_TEAM', this.addAuditViolation.bind(this));
    return this.teamMembers.filter(m => m.tenantId === tenantId);
  }

  public inviteTeamMember(context: SecurityContext, tenantId: string, data: Omit<TeamMember, 'id' | 'tenantId' | 'createdAt'>): TeamMember {
    validateTenantAccess(context, tenantId, 'INVITE_TEAM_MEMBER', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_settings');

    const newMember: TeamMember = {
      ...data,
      id: `team-${Date.now()}`,
      tenantId,
      createdAt: new Date().toISOString(),
    };

    this.teamMembers.push(newMember);

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'INVITE_TEAM_MEMBER',
      resource: 'TEAM',
      resourceId: newMember.id,
      details: `Colaborador ${newMember.name} convidado com papel ${newMember.role}.`,
      newValue: JSON.stringify(newMember),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return newMember;
  }

  public removeTeamMember(context: SecurityContext, tenantId: string, memberId: string): void {
    validateTenantAccess(context, tenantId, 'REMOVE_TEAM_MEMBER', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_settings');

    const member = this.teamMembers.find(m => m.id === memberId && m.tenantId === tenantId);
    if (!member) throw new Error('Membro da equipe não encontrado.');

    this.teamMembers = this.teamMembers.filter(m => !(m.id === memberId && m.tenantId === tenantId));

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'REMOVE_TEAM_MEMBER',
      resource: 'TEAM',
      resourceId: memberId,
      details: `Colaborador ${member.name} removido da equipe.`,
      previousValue: JSON.stringify(member),
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
  }

  // --- INVENTORY MANAGEMENT (FASE 3 - CONTROLE REAL & HISTÓRICO) ---
  public getInventoryMovements(context: SecurityContext, tenantId: string): InventoryMovement[] {
    validateTenantAccess(context, tenantId, 'GET_INVENTORY_MOVEMENTS', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_products');
    return this.inventoryMovements.filter(m => m.tenantId === tenantId);
  }

  public adjustProductStock(
    context: SecurityContext, 
    tenantId: string, 
    productId: string, 
    delta: number, 
    reason: string
  ): Product {
    validateTenantAccess(context, tenantId, 'ADJUST_STOCK', this.addAuditViolation.bind(this));
    validatePermission(context, 'manage_products');

    const prod = this.products.find(p => p.id === productId && p.tenantId === tenantId);
    if (!prod) throw new Error('Produto não encontrado.');

    if (prod.stockQuantity + delta < 0) {
      throw new Error(`Estoque não pode ficar negativo. Saldo atual: ${prod.stockQuantity}, ajuste: ${delta}.`);
    }

    const prev = prod.stockQuantity;
    prod.stockQuantity += delta;
    prod.updatedAt = new Date().toISOString();

    this.inventoryMovements.unshift({
      id: `mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId,
      productId: prod.id,
      productName: prod.name,
      quantity: delta,
      type: delta > 0 ? 'ENTRADA' : 'SAIDA',
      reason,
      previousStock: prev,
      newStock: prod.stockQuantity,
      timestamp: new Date().toISOString(),
      createdByName: context.userName,
    });

    this.addAuditLog({
      userId: context.userId,
      userName: context.userName,
      userRole: context.userRole,
      tenantId,
      action: 'STOCK_ADJUSTMENT',
      resource: 'PRODUCT',
      resourceId: productId,
      details: `Estoque de "${prod.name}" ajustado em ${delta > 0 ? '+' : ''}${delta}. Novo saldo: ${prod.stockQuantity}. Motivo: ${reason}`,
      previousValue: `stock: ${prev}`,
      newValue: `stock: ${prod.stockQuantity}`,
      ipAddress: '189.45.12.90',
      isCeoSupport: !!context.isCeoSupportMode,
    });

    this.persist();
    return prod;
  }

  // --- INTERNAL NOTIFICATIONS ---
  public getNotifications(tenantId: string): InternalNotification[] {
    return this.notifications.filter(n => n.tenantId === tenantId);
  }

  public addNotification(tenantId: string, notif: Omit<InternalNotification, 'id' | 'createdAt' | 'tenantId' | 'read'>): void {
    const newN: InternalNotification = {
      ...notif,
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tenantId,
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.notifications.unshift(newN);
    if (this.notifications.length > 100) this.notifications.pop();
  }

  public markNotificationAsRead(tenantId: string, id: string): void {
    const n = this.notifications.find(item => item.id === id && item.tenantId === tenantId);
    if (n) {
      n.read = true;
      this.persist();
    }
  }

  public markAllNotificationsAsRead(tenantId: string): void {
    this.notifications.forEach(n => {
      if (n.tenantId === tenantId) n.read = true;
    });
    this.persist();
  }

  // --- PUBLIC CLIENT ORDER CREATION & TRACKING (FASE 3) ---
  public createPublicOrder(slugOrTenantId: string, orderData: {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    deliveryAddress?: string;
    addressDetails?: Order['addressDetails'];
    items: Array<{ productId: string; quantity: number; notes?: string }>;
    paymentMethod: Order['paymentMethod'];
    fulfillmentType?: Order['fulfillmentType'];
    notes?: string;
    origin: Order['origin'];
  }): Order {
    const tenant = this.getTenantBySlug(slugOrTenantId);
    if (!tenant) {
      throw new Error(`Estabelecimento não encontrado.`);
    }

    if (!orderData.items || orderData.items.length === 0) {
      throw new Error('O carrinho está vazio.');
    }

    // 1. RECALCULAÇÃO SEGURA NO SERVIDOR & VALIDAÇÃO DE ESTOQUE ATÔMICA (REQUISITO 17 & 19)
    // Nunca confiar em preços enviados pelo frontend
    const validatedItems: Order['items'] = [];
    
    for (const itemReq of orderData.items) {
      if (itemReq.quantity <= 0) {
        throw new Error(`Quantidade inválida para o item.`);
      }

      const product = this.products.find(p => p.id === itemReq.productId && p.tenantId === tenant.id);
      if (!product) {
        throw new Error(`Produto não encontrado ou não pertence a este estabelecimento.`);
      }

      if (!product.isActive) {
        throw new Error(`O produto "${product.name}" está temporariamente indisponível.`);
      }

      // Validação de estoque anti-overselling
      if (product.stockQuantity < itemReq.quantity) {
        throw new Error(
          `Estoque insuficiente para o produto "${product.name}". Saldo disponível: ${product.stockQuantity}, solicitado: ${itemReq.quantity}.`
        );
      }

      // Verifica se o produto possui desconto ativo em algum carrossel promocional da loja
      let promoPrice: number | null = null;
      const activeCarousels = this.getPublicPromotionCarousels(tenant.id);
      for (const carousel of activeCarousels) {
        const itemPromo = carousel.items.find(ci => ci.productId === product.id);
        if (itemPromo && itemPromo.promotionalPrice > 0 && itemPromo.promotionalPrice < product.price) {
          if (promoPrice === null || itemPromo.promotionalPrice < promoPrice) {
            promoPrice = itemPromo.promotionalPrice;
          }
        }
      }

      const unitPrice = (promoPrice !== null)
        ? promoPrice
        : (product.promotionalPrice && product.promotionalPrice > 0 && product.promotionalPrice < product.price 
            ? product.promotionalPrice 
            : product.price);

      validatedItems.push({
        productId: product.id,
        productName: product.name,
        quantity: itemReq.quantity,
        unitPrice,
        totalPrice: Number((unitPrice * itemReq.quantity).toFixed(2)),
        notes: itemReq.notes,
        unit: product.unit,
      });
    }

    const subtotal = Number(validatedItems.reduce((acc, item) => acc + item.totalPrice, 0).toFixed(2));
    
    // Taxa de entrega calculada pelo servidor
    const fulfillmentType = orderData.fulfillmentType || 'DELIVERY';
    let deliveryFee = 0;
    
    if (fulfillmentType === 'DELIVERY') {
      const isFreeDelivery = tenant.settings.freeDeliveryThreshold && subtotal >= tenant.settings.freeDeliveryThreshold;
      deliveryFee = isFreeDelivery ? 0 : Number((tenant.settings.deliveryFee || 0).toFixed(2));
    }

    const discount = 0;
    const totalAmount = Number((subtotal + deliveryFee - discount).toFixed(2));

    // 2. BAIXA DE ESTOQUE REAL & REGISTRO DE MOVIMENTAÇÃO (REQUISITO 17)
    for (const item of validatedItems) {
      const prod = this.products.find(p => p.id === item.productId && p.tenantId === tenant.id)!;
      const prevStock = prod.stockQuantity;
      prod.stockQuantity -= item.quantity;
      prod.updatedAt = new Date().toISOString();

      this.inventoryMovements.unshift({
        id: `mov-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        tenantId: tenant.id,
        productId: prod.id,
        productName: prod.name,
        quantity: -item.quantity,
        type: 'VENDA',
        referenceId: `pend-${Date.now()}`, // Será atualizado para o orderId
        reason: `Venda via Web App (${orderData.customerName})`,
        previousStock: prevStock,
        newStock: prod.stockQuantity,
        timestamp: new Date().toISOString(),
        createdByName: 'Sistema (Checkout Real)',
      });
    }

    // 3. IDENTIFICAÇÃO E CADASTRO DO CLIENTE
    let customer = this.customers.find(c => c.tenantId === tenant.id && c.phone === orderData.customerPhone);
    if (customer) {
      customer.totalOrders += 1;
      customer.ltvAmount += totalAmount;
      customer.lastOrderDate = new Date().toISOString().split('T')[0];
      if (orderData.customerName) customer.name = orderData.customerName;
      if (orderData.customerEmail) customer.email = orderData.customerEmail;
    } else {
      customer = {
        id: `cust-${Date.now()}`,
        tenantId: tenant.id,
        name: orderData.customerName,
        phone: orderData.customerPhone,
        email: orderData.customerEmail,
        origin: orderData.origin,
        totalOrders: 1,
        ltvAmount: totalAmount,
        firstOrderDate: new Date().toISOString().split('T')[0],
        lastOrderDate: new Date().toISOString().split('T')[0],
        consentLgpd: true,
        isDemo: false,
      };
      this.customers.push(customer);
    }

    const orderId = `ord-${Date.now()}`;
    const orderNumber = 1000 + this.orders.filter(o => o.tenantId === tenant.id).length + 1;

    // Atualiza o referenceId nos movimentos recém-criados
    this.inventoryMovements.slice(0, validatedItems.length).forEach(m => {
      m.referenceId = orderId;
      m.reason = `Baixa de estoque por Venda - Pedido #${orderNumber}`;
    });

    const deliveryAddress = fulfillmentType === 'PICKUP' 
      ? `Retirada no Estabelecimento: ${tenant.settings.address}` 
      : (orderData.deliveryAddress || 'Endereço não informado');

    const paymentStatus: Order['paymentStatus'] = orderData.paymentMethod === 'PIX' ? 'PENDING' : 'PAYMENT_ON_DELIVERY';

    const newOrder: Order = {
      id: orderId,
      tenantId: tenant.id,
      customerId: customer.id,
      orderNumber,
      customerName: orderData.customerName,
      customerPhone: orderData.customerPhone,
      customerEmail: orderData.customerEmail,
      deliveryAddress,
      addressDetails: orderData.addressDetails,
      items: validatedItems,
      subtotal,
      deliveryFee,
      discount,
      totalAmount,
      paymentMethod: orderData.paymentMethod,
      paymentStatus,
      fulfillmentType,
      notes: orderData.notes,
      prepTimeMinutes: tenant.settings?.defaultPrepTimeMinutes ?? 30,
      status: 'PENDING',
      isDemo: false,
      statusHistory: [
        {
          status: 'PENDING',
          timestamp: new Date().toISOString(),
          note: 'Pedido recebido com sucesso no sistema',
          changedBy: orderData.customerName,
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      origin: orderData.origin,
    };

    this.orders.unshift(newOrder);

    // 4. NOTIFICAÇÃO INTERNA PARA A EQUIPE DA LOJA
    this.addNotification(tenant.id, {
      title: `Novo Pedido #${newOrder.orderNumber} Recebido!`,
      message: `${orderData.customerName} fez um pedido de R$ ${totalAmount.toFixed(2)} via ${fulfillmentType === 'PICKUP' ? 'Retirada' : 'Entrega'}.`,
      type: 'ORDER_NEW',
      orderId: newOrder.id,
    });

    this.logAppEvent({
      eventName: 'purchase_completed',
      tenantId: tenant.id,
      metadata: {
        orderId: newOrder.id,
        orderNumber: newOrder.orderNumber,
        totalAmount,
        origin: orderData.origin,
        fulfillmentType,
      }
    });

    this.persist();
    return newOrder;
  }

  // --- CHECKOUT PROMOCIONAL PRÓPRIO (MODO 3 - ATÔMICO E REAL) ---
  public processPromotionalCheckout(slugOrTenantId: string, orderData: {
    offerId: string;
    quantity: number;
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    deliveryAddress?: string;
    addressDetails?: Order['addressDetails'];
    paymentMethod: Order['paymentMethod'];
    fulfillmentType?: Order['fulfillmentType'];
    notes?: string;
    couponCode?: string;
  }): { order: Order; celebrationMessage?: string; redemptionNumber?: number; isExhausted?: boolean } {
    const tenant = this.getTenantBySlug(slugOrTenantId);
    if (!tenant) {
      throw new Error(`Estabelecimento não encontrado.`);
    }

    if (!orderData.quantity || orderData.quantity <= 0) {
      throw new Error('A quantidade deve ser de pelo menos 1 unidade.');
    }

    const offer = this.offers.find(o => o.id === orderData.offerId && o.tenantId === tenant.id);
    if (!offer) {
      throw new Error('Oferta promocional não encontrada neste estabelecimento.');
    }

    if (!offer.isActive) {
      throw new Error('Esta promoção foi desativada pelo estabelecimento.');
    }

    const now = Date.now();
    const startIso = offer.startAt || offer.startDate;
    const endIso = offer.endAt || offer.endDate;
    if (startIso && new Date(startIso).getTime() > now) {
      throw new Error('Esta promoção ainda não iniciou.');
    }
    if (endIso && new Date(endIso).getTime() < now) {
      throw new Error('Esta promoção expirou.');
    }

    const currentTimesUsed = offer.promoTimesUsed || 0;
    if (offer.promoUsageLimit && offer.promoUsageLimit > 0) {
      if (currentTimesUsed >= offer.promoUsageLimit) {
        throw new Error(`Esta promoção atingiu o limite máximo de ${offer.promoUsageLimit} compras e está esgotada.`);
      }
    }

    const maxQty = offer.promoMaxQuantityPerCustomer || 10;
    if (orderData.quantity > maxQty) {
      throw new Error(`A quantidade máxima permitida por cliente nesta promoção é de ${maxQty} unidades.`);
    }

    // Preço e dados oficiais do servidor (impossível fraudar pelo front)
    const unitPrice = offer.promoPrice || offer.promotionalPrice || offer.originalPrice || 0;
    const origPrice = offer.promoOriginalPrice || offer.originalPrice || unitPrice;
    const itemName = offer.promoTitle || offer.title;
    const itemUnit = offer.promoUnit || 'un';

    if (unitPrice <= 0) {
      throw new Error('Preço promocional inválido.');
    }

    const subtotal = Number((unitPrice * orderData.quantity).toFixed(2));

    // Abate de estoque se houver produto de catálogo vinculado
    if (offer.productId) {
      const prod = this.products.find(p => p.id === offer.productId && p.tenantId === tenant.id);
      if (prod) {
        if (prod.stockQuantity < orderData.quantity) {
          throw new Error(`Estoque insuficiente para o produto da promoção. Disponível: ${prod.stockQuantity}`);
        }
        prod.stockQuantity -= orderData.quantity;
        prod.updatedAt = new Date().toISOString();
      }
    }

    // Entrega e taxa
    const fulfillmentType = orderData.fulfillmentType || 'DELIVERY';
    let deliveryFee = 0;
    if (fulfillmentType === 'DELIVERY') {
      const isFreeDelivery = tenant.settings.freeDeliveryThreshold && subtotal >= tenant.settings.freeDeliveryThreshold;
      deliveryFee = isFreeDelivery ? 0 : Number((tenant.settings.deliveryFee || 0).toFixed(2));
    }

    const discount = 0;
    const totalAmount = Number((subtotal + deliveryFee - discount).toFixed(2));

    // Atualiza contador de usos da promoção
    const newTimesUsed = currentTimesUsed + 1;
    offer.promoTimesUsed = newTimesUsed;
    if (offer.promoUsageLimit && newTimesUsed >= offer.promoUsageLimit) {
      offer.isExhausted = true;
    }

    // Cliente
    const cleanPhone = orderData.customerPhone.replace(/\D/g, '');
    let customer = this.customers.find(c => c.tenantId === tenant.id && c.phone.replace(/\D/g, '') === cleanPhone);
    if (customer) {
      customer.totalOrders += 1;
      customer.ltvAmount += totalAmount;
      customer.lastOrderDate = new Date().toISOString().split('T')[0];
      if (orderData.customerName) customer.name = orderData.customerName;
    } else {
      customer = {
        id: `cust-${Date.now()}`,
        tenantId: tenant.id,
        name: orderData.customerName,
        phone: orderData.customerPhone,
        email: orderData.customerEmail,
        origin: 'promotional_checkout',
        totalOrders: 1,
        ltvAmount: totalAmount,
        firstOrderDate: new Date().toISOString().split('T')[0],
        lastOrderDate: new Date().toISOString().split('T')[0],
        consentLgpd: true,
        isDemo: false,
      };
      this.customers.push(customer);
    }

    const orderId = `ord-${Date.now()}`;
    const orderNumber = 1000 + this.orders.filter(o => o.tenantId === tenant.id).length + 1;
    const deliveryAddress = fulfillmentType === 'PICKUP' 
      ? `Retirada no Estabelecimento: ${tenant.settings.address}` 
      : (orderData.deliveryAddress || 'Endereço não informado');

    const paymentStatus: Order['paymentStatus'] = orderData.paymentMethod === 'PIX' ? 'PENDING' : 'PAYMENT_ON_DELIVERY';

    const newOrder: Order = {
      id: orderId,
      tenantId: tenant.id,
      customerId: customer.id,
      orderNumber,
      customerName: orderData.customerName,
      customerPhone: orderData.customerPhone,
      customerEmail: orderData.customerEmail,
      deliveryAddress,
      addressDetails: orderData.addressDetails,
      items: [
        {
          productId: offer.productId || `promo-${offer.id}`,
          productName: itemName,
          quantity: orderData.quantity,
          unitPrice,
          totalPrice: subtotal,
          notes: orderData.notes || 'Oferta Promocional Exclusiva',
          unit: itemUnit,
        }
      ],
      subtotal,
      deliveryFee,
      discount,
      totalAmount,
      paymentMethod: orderData.paymentMethod,
      paymentStatus,
      fulfillmentType,
      notes: orderData.notes,
      prepTimeMinutes: tenant.settings?.defaultPrepTimeMinutes ?? 30,
      status: 'PENDING',
      isDemo: false,
      statusHistory: [
        {
          status: 'PENDING',
          timestamp: new Date().toISOString(),
          note: 'Pedido recebido via Checkout Promocional com sucesso',
          changedBy: orderData.customerName,
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      origin: 'promotional_checkout',
    };

    this.orders.unshift(newOrder);

    this.addNotification(tenant.id, {
      title: `⚡ Pedido Promocional #${newOrder.orderNumber} Recebido!`,
      message: `${orderData.customerName} aproveitou a oferta "${itemName}" (${orderData.quantity}x) - Total R$ ${totalAmount.toFixed(2)}.`,
      type: 'ORDER_NEW',
      orderId: newOrder.id,
    });

    this.persist();

    const celebrationMessage = offer.promoUsageLimit && offer.promoUsageLimit > 0
      ? `🎉 Parabéns! Você foi o cliente nº ${newTimesUsed} a aproveitar esta promoção!`
      : undefined;

    return {
      order: newOrder,
      celebrationMessage,
      redemptionNumber: newTimesUsed,
      isExhausted: Boolean(offer.promoUsageLimit && newTimesUsed >= offer.promoUsageLimit),
    };
  }

  // --- CONSULTA PÚBLICA DE PEDIDOS DO CLIENTE (FASE 3 - MEUS PEDIDOS & RASTREIO) ---
  public getPublicOrdersByCustomer(slugOrTenantId: string, phone: string): Order[] {
    const tenant = this.getTenantBySlug(slugOrTenantId);
    if (!tenant) return [];
    
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone) return [];

    return this.orders
      .filter(o => o.tenantId === tenant.id && o.customerPhone.replace(/\D/g, '') === cleanPhone)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public getPublicOrderById(slugOrTenantId: string, orderId: string, phone?: string): Order | undefined {
    const tenant = this.getTenantBySlug(slugOrTenantId);
    if (!tenant) return undefined;

    const order = this.orders.find(o => o.id === orderId && o.tenantId === tenant.id);
    if (!order) return undefined;

    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      const orderPhone = order.customerPhone.replace(/\D/g, '');
      if (cleanPhone && orderPhone && cleanPhone !== orderPhone) {
        throw new Error('Acesso não autorizado a este pedido.');
      }
    }

    return order;
  }

  // --- AUDIT LOGS ---
  public getAuditLogs(context: SecurityContext, tenantIdFilter?: string): AuditLog[] {
    if (context.userRole === 'CEO' || context.userRole === 'SUPER_ADMIN') {
      if (tenantIdFilter) {
        return this.auditLogs.filter(l => l.tenantId === tenantIdFilter);
      }
      return [...this.auditLogs];
    }

    // Lojista comum só vê auditoria do seu próprio tenant
    if (!context.tenantId) return [];
    return this.auditLogs.filter(l => l.tenantId === context.tenantId);
  }

  public addAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): void {
    const newLog: AuditLog = {
      ...log,
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(newLog);
    this.persist();
  }

  public addAuditViolation(log: Omit<AuditLog, 'id' | 'timestamp'>): void {
    this.addAuditLog({
      ...log,
      details: `[TENTATIVA DE INVASÃO / IDOR REJEITADA]: ${log.details}`,
    });
  }

  // --- TELEMETRY / EVENTS (NO AI) ---
  public logAppEvent(event: Omit<AppEvent, 'id' | 'timestamp'>): void {
    const newEvent: AppEvent = {
      ...event,
      id: `ev-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    this.appEvents.unshift(newEvent);
    if (this.appEvents.length > 200) {
      this.appEvents.pop();
    }
  }

  public getAppEvents(context: SecurityContext, tenantId: string): AppEvent[] {
    validateTenantAccess(context, tenantId, 'GET_APP_EVENTS', this.addAuditViolation.bind(this));
    return this.appEvents.filter(e => e.tenantId === tenantId);
  }

  // --- SPONSORS (CEO) ---
  public getSponsors(): Sponsor[] {
    return [...this.sponsors];
  }

  public getUsers(): User[] {
    return [...this.users];
  }
}

export const dataStore = new DataStore();
