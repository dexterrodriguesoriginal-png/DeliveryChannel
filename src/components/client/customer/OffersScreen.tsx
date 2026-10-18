import React, { useMemo } from 'react';
import { Tag } from 'lucide-react';
import type { Offer, Product, PromotionCarousel } from '../../../types';
import { buildOfferList, OfferListItem } from '../../../lib/customer/offers';
import { couponCountdownLabel } from '../../../lib/customer/couponCountdown';
import { OfferCarousel } from '../../common/OfferCarousel';
import { ProductRow } from './ProductRow';
import { EmptyBlock } from './ui';

/** Aba Ofertas: cards de campanha + todos os produtos em oferta válidos, com preço riscado e % de desconto. */
export const OffersScreen: React.FC<{
  products: Product[];
  carousels: PromotionCarousel[];
  tenantId: string;
  storefrontCards: Offer[];
  clockOffsetMs: number;
  nowMs: number;
  color: string;
  qtyOf: (item: OfferListItem) => number;
  onAdd: (item: OfferListItem) => void;
  onRemove: (item: OfferListItem) => void;
  onOpen: (item: OfferListItem) => void;
  onCardClick: (o: Offer) => void;
}> = ({ products, carousels, tenantId, storefrontCards, clockOffsetMs, nowMs, color, qtyOf, onAdd, onRemove, onOpen, onCardClick }) => {
  const list = useMemo(() => buildOfferList({ products, carousels, tenantId, now: new Date(nowMs) }), [products, carousels, tenantId, nowMs]);
  return (
    <div className="max-w-lg mx-auto p-4 space-y-4" data-testid="offers-screen">
      <div>
        <h2 className="text-xl font-extrabold text-gray-900">Ofertas</h2>
        <p className="text-xs text-gray-500">Preços promocionais válidos agora nesta loja.</p>
      </div>
      {storefrontCards.length > 0 && <OfferCarousel offers={storefrontCards} onOfferClick={onCardClick} clockOffsetMs={clockOffsetMs} />}
      {list.length === 0 ? (
        <EmptyBlock testId="offers-empty" icon={<Tag className="w-7 h-7" />} title="Nenhuma oferta no momento" text="Volte mais tarde: a loja publica promoções por aqui." />
      ) : (
        <div className="space-y-3" data-testid="offers-list">
          {list.map(it => {
            const cd = couponCountdownLabel(it.endsAt, nowMs);
            const badge = cd?.urgent ? cd.label : it.campaignName;
            return (
              <ProductRow key={it.key} testId="offer-row" product={it.product} price={it.offerPrice} originalPrice={it.originalPrice} badge={badge}
                qty={qtyOf(it)} color={color} onOpen={() => onOpen(it)} onAdd={() => onAdd(it)} onRemove={() => onRemove(it)} />
            );
          })}
        </div>
      )}
    </div>
  );
};
