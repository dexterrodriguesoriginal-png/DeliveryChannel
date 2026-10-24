import React from 'react';
import { Edit3 } from 'lucide-react';
import type { Offer } from '../../types';
import { DemoBadge } from '../common/DemoBadge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { formatBRL } from '../../lib/pricing/money';

export function CatalogOffersSection({
  offers,
  canManage,
  onEdit,
}: {
  offers: Offer[];
  canManage: boolean;
  onEdit: (offer: Offer) => void;
}) {
  if (offers.length === 0) return null;

  return (
    <section aria-labelledby="catalog-offers-title" className="space-y-3">
      <h3 id="catalog-offers-title" className="text-sm font-bold text-gray-900">Cards de oferta da vitrine</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {offers.map(offer => (
          <Card key={offer.id} className="overflow-hidden p-0">
            {offer.imageUrl && <img src={offer.imageUrl} alt={offer.title} className="w-full h-28 object-cover" />}
            <div className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-gray-900">{offer.title}</h4>
                <DemoBadge isDemo={offer.isDemo} />
              </div>
              {offer.subtitle && <p className="text-xs font-medium text-gray-600">{offer.subtitle}</p>}
              {offer.description && <p className="text-xs text-gray-500">{offer.description}</p>}
              {offer.promotionalPrice !== undefined && <p className="text-sm font-bold text-emerald-800">{formatBRL(offer.promotionalPrice)}</p>}
              {canManage && (
                <Button type="button" variant="outline" size="sm" onClick={() => onEdit(offer)} leftIcon={<Edit3 className="w-3.5 h-3.5" />}>
                  Editar oferta
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
