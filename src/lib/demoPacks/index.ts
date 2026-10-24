import packs from './packs.json';
import type { BusinessType } from '../../types';

export type DemoSegment =
  | 'adega' | 'pizzaria' | 'padaria' | 'mercado' | 'barbearia'
  | 'salao-beleza' | 'perfumaria' | 'hot-dog' | 'espetinho' | 'tabacaria'
  | 'hamburgueria' | 'acai' | 'japonesa' | 'farmacia' | 'pet'
  | 'cafe-doceria' | 'escritorio-servicos' | 'generico';

export interface DemoCategory {
  id: string;
  name: string;
  description: string;
  image: string;
}

export interface DemoProduct {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  image: string;
}

export interface DemoOffer {
  id: string;
  productId: string;
  title: string;
  subtitle: string;
  description: string;
  badge: string;
  originalPrice: number;
  promotionalPrice: number;
  image: string;
}

export interface DemoPack {
  segment: DemoSegment;
  label: string;
  categories: DemoCategory[];
  products: DemoProduct[];
  offers: DemoOffer[];
}

/** Catálogo canônico compartilhado com a migration de demonstração. */
export const DEMO_PACKS = packs as DemoPack[];

/** Sugestão inicial; o dono pode escolher um segmento mais específico no cadastro. */
export const DEMO_SEGMENT_BY_BUSINESS_TYPE: Record<BusinessType, DemoSegment> = {
  RESTAURANTE: 'generico',
  BAR: 'adega',
  LANCHONETE_CAFE: 'cafe-doceria',
  PIZZARIA: 'pizzaria',
  MERCADO: 'mercado',
  ADEGA: 'adega',
  ROUPAS: 'generico',
  PERFUMARIA: 'perfumaria',
  SALAO_BARBEARIA: 'barbearia',
  CONSTRUCAO: 'generico',
  AMBULANTE: 'generico',
  OUTRO: 'generico',
};

export function getDemoPack(segment: string): DemoPack | undefined {
  return DEMO_PACKS.find(pack => pack.segment === segment);
}
