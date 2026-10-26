/**
 * Layouts de Vitrine Pré-Configurados para o DeliveryChannel
 * Cobre todos os modos de exibição de produtos, proporções de fotos,
 * cabeçalhos, categorias e densidades visuais.
 */

import { LayoutConfig } from '../../../types/theme';

export const DEFAULT_LAYOUT: LayoutConfig = {
  productLayout: 'grid-2',
  photoSize: 'medium',
  photoRatio: 'square',
  headerStyle: 'classic',
  categoryStyle: 'pill',
  density: 'standard',
};

export interface NamedLayout {
  id: string;
  name: string;
  description: string;
  config: LayoutConfig;
}

export const STORE_LAYOUTS: NamedLayout[] = [
  // 1. Padrão Clássico Delivery (Grid 2 colunas equilibrado)
  {
    id: 'grid-classic',
    name: 'Grade Clássica Delivery',
    description: 'Dois produtos por linha com fotos quadradas e navegação por pílulas.',
    config: {
      productLayout: 'grid-2',
      photoSize: 'medium',
      photoRatio: 'square',
      headerStyle: 'classic',
      categoryStyle: 'pill',
      density: 'standard',
    },
  },
  // 2. Vitrine Imersiva Gastronômica (Destaque Principal + Grade)
  {
    id: 'featured-hero',
    name: 'Destaque Gastronômico Imersivo',
    description: 'Primeiro produto em banner panorâmico com cabeçalho de foto sobreposta.',
    config: {
      productLayout: 'featured-first',
      photoSize: 'large',
      photoRatio: 'landscape',
      headerStyle: 'banner-overlay',
      categoryStyle: 'tabs-underline',
      density: 'airy',
    },
  },
  // 3. Cardápio Lista Rápida (Restaurantes, Marmitas e Lanches)
  {
    id: 'list-fast',
    name: 'Cardápio Lista Ágil',
    description: 'Linhas horizontais compactas com foto lateral para leitura ultra rápida.',
    config: {
      productLayout: 'list',
      photoSize: 'small',
      photoRatio: 'square',
      headerStyle: 'compact',
      categoryStyle: 'pill',
      density: 'compact',
    },
  },
  // 4. Revista Visual com Fotos Grandes
  {
    id: 'list-magazine',
    name: 'Revista Visual Gourmet',
    description: 'Lista editorial com grandes fotos horizontais e descrição detalhada.',
    config: {
      productLayout: 'list-large-photo',
      photoSize: 'large',
      photoRatio: 'landscape',
      headerStyle: 'banner-overlay',
      categoryStyle: 'chip-outline',
      density: 'airy',
    },
  },
  // 5. Grade Compacta de Alta Densidade (Mercado, Empório e Distribuidora)
  {
    id: 'grid-compact-3',
    name: 'Grade Alta Densidade (3 colunas)',
    description: 'Três produtos por linha para visualização rápida de grande variedade.',
    config: {
      productLayout: 'grid-3',
      photoSize: 'small',
      photoRatio: 'square',
      headerStyle: 'compact',
      categoryStyle: 'chip-outline',
      density: 'compact',
    },
  },
  // 6. Boutique Elegante com Logo Centralizada (Vinhos, Cafés e Cosméticos)
  {
    id: 'boutique-centered',
    name: 'Boutique Logo Central',
    description: 'Cabeçalho focado na marca com produtos em retrato e abas discretas.',
    config: {
      productLayout: 'grid-2',
      photoSize: 'medium',
      photoRatio: 'portrait',
      headerStyle: 'centered-logo',
      categoryStyle: 'tabs-underline',
      density: 'standard',
    },
  },
  // 7. Navegação Visual com Ícones de Categoria
  {
    id: 'icon-cards-showcase',
    name: 'Vitrine Cards com Ícones',
    description: 'Categorias em cartões com ícones gráficos e produtos em grade equilibrada.',
    config: {
      productLayout: 'grid-2',
      photoSize: 'medium',
      photoRatio: 'square',
      headerStyle: 'classic',
      categoryStyle: 'icon-cards',
      density: 'standard',
    },
  },
  // 8. Editorial Fotográfico Retrato (Adega, Perfumaria e Salão)
  {
    id: 'editorial-portrait',
    name: 'Editorial Retrato Premium',
    description: 'Fotos verticais para garrafas, cosméticos e cortes com acabamento arejado.',
    config: {
      productLayout: 'featured-first',
      photoSize: 'large',
      photoRatio: 'portrait',
      headerStyle: 'centered-logo',
      categoryStyle: 'icon-cards',
      density: 'airy',
    },
  },
  // 9. Mercado Expresso Lista Limpa
  {
    id: 'market-express',
    name: 'Mercado Expresso Limpo',
    description: 'Lista em alta densidade com chip outline e fotos nítidas.',
    config: {
      productLayout: 'list',
      photoSize: 'medium',
      photoRatio: 'square',
      headerStyle: 'classic',
      categoryStyle: 'chip-outline',
      density: 'compact',
    },
  },
  // 10. Panorama Amplo Moderno
  {
    id: 'modern-panorama',
    name: 'Panorama Amplo Moderno',
    description: 'Layout em 3 colunas com fotos panorâmicas e cabeçalho expansivo.',
    config: {
      productLayout: 'grid-3',
      photoSize: 'medium',
      photoRatio: 'landscape',
      headerStyle: 'banner-overlay',
      categoryStyle: 'pill',
      density: 'standard',
    },
  },
];
