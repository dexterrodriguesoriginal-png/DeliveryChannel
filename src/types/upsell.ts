import type { Product } from './index';

export type UpsellChannel = 'DELIVERY' | 'DINE_IN' | 'TOTEM';
export interface UpsellCartItem { productId: string; quantity: number }
export interface UpsellRecommendation { productId: string; reason?: string }
export interface UpsellResponse { offerToken: string | null; suggestions: UpsellRecommendation[] }
export interface UpsellSuggestion { product: Product; reason?: string }
export interface UpsellOffer { offerToken: string; suggestions: UpsellSuggestion[] }
export interface UpsellSettings { enabled: boolean }
export interface UpsellPairStats {
  sourceProductId: string;
  suggestedProductId: string;
  itemsSold: number;
  revenue: number;
  accepts: number;
}
export interface UpsellStats {
  itemsSold: number;
  revenue: number;
  impressions: number;
  accepts: number;
  /** Ratio in [0, 1], not a percentage. */
  acceptanceRate: number;
  topPairs: UpsellPairStats[];
}
