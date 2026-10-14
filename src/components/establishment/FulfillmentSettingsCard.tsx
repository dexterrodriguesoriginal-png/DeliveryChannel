import React, { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Bike, Store, Percent } from 'lucide-react';
import { Offer, Product, TenantSettings } from '../../types';
import { productRepository } from '../../repositories/productRepository';
import { offerRepository } from '../../repositories/offerRepository';
import { SecurityContext } from '../../services/securityEngine';
import { PICKUP_DISCOUNT_MAX, PICKUP_DISCOUNT_MIN, isValidPickupDiscountPercent } from '../../lib/pricing/fulfillmentPricing';

interface Props {
  form: TenantSettings;
  setForm: (next: TenantSettings) => void;
  canEdit: boolean;
  tenantId: string;
  securityContext: SecurityContext;
}

/** Seção "Modalidades de Atendimento & Desconto para Retirada" dentro de Configurações da Loja. */
export const FulfillmentSettingsCard: React.FC<Props> = ({ form, setForm, canEdit, tenantId, securityContext }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [productFilter, setProductFilter] = useState('');

  useEffect(() => {
    let alive = true;
    productRepository.getProducts(securityContext, tenantId).then((p) => alive && setProducts(p)).catch(() => {});
    offerRepository.getOffers(securityContext, tenantId)
      .then((o) => alive && setOffers(o.filter((x) => x.destinationType === 'CUSTOM_OFFER')))
      .catch(() => {});
    return () => { alive = false; };
  }, [tenantId]);

  const deliveryEnabled = form.deliveryEnabled ?? true;
  const pickupEnabled = form.pickupEnabled ?? true;
  const discountEnabled = form.pickupDiscountEnabled ?? false;
  const pct = form.pickupDiscountPercent ?? 0;
  const excludedProducts = form.pickupDiscountExcludedProductIds ?? [];
  const excludedOffers = form.pickupDiscountExcludedOfferIds ?? [];
  const pctInvalid = discountEnabled && (!isValidPickupDiscountPercent(pct) || pct <= 0);

  const toggleId = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const visibleProducts = products.filter((p) => p.name.toLowerCase().includes(productFilter.toLowerCase()));

  return (
    <Card className="p-5 space-y-4" data-testid="fulfillment-settings-card">
      <h3 className="text-sm font-bold text-gray-900 pb-2 border-b border-gray-100 flex items-center gap-2">
        <Store className="w-4 h-4 text-emerald-700" />
        Modalidades de Atendimento & Desconto para Retirada
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex items-start gap-2 p-3 rounded-xl border border-gray-200 cursor-pointer">
          <input type="checkbox" disabled={!canEdit} checked={deliveryEnabled}
            onChange={(e) => setForm({ ...form, deliveryEnabled: e.target.checked })} className="mt-0.5" />
          <span className="text-xs">
            <span className="font-bold text-gray-900 flex items-center gap-1"><Bike className="w-3.5 h-3.5" /> Receber em casa (Delivery)</span>
            <span className="text-gray-500 block">Usa a taxa de entrega e o frete grátis definidos acima.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 p-3 rounded-xl border border-gray-200 cursor-pointer">
          <input type="checkbox" disabled={!canEdit} checked={pickupEnabled}
            onChange={(e) => setForm({ ...form, pickupEnabled: e.target.checked })} className="mt-0.5" />
          <span className="text-xs">
            <span className="font-bold text-gray-900 flex items-center gap-1"><Store className="w-3.5 h-3.5" /> Retirar na loja</span>
            <span className="text-gray-500 block">Sem taxa de entrega.</span>
          </span>
        </label>
      </div>

      {!deliveryEnabled && !pickupEnabled && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">
          Com as duas modalidades desativadas, os clientes não conseguirão finalizar pedidos.
        </p>
      )}

      {pickupEnabled && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700 block">Instruções de retirada (opcional)</label>
            <textarea
              disabled={!canEdit}
              rows={2}
              maxLength={500}
              value={form.pickupInstructions || ''}
              onChange={(e) => setForm({ ...form, pickupInstructions: e.target.value })}
              placeholder="Ex: Retire no balcão lateral, apresente o número do pedido."
              className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white"
            />
          </div>

          <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-3">
            <label className="flex items-center gap-2 text-xs font-bold text-gray-900 cursor-pointer">
              <input type="checkbox" disabled={!canEdit} checked={discountEnabled}
                onChange={(e) => setForm({ ...form, pickupDiscountEnabled: e.target.checked })} />
              <Percent className="w-3.5 h-3.5 text-emerald-700" />
              Dar desconto para quem retirar na loja
            </label>

            {discountEnabled && (
              <>
                <Input
                  label={`Percentual de desconto (${PICKUP_DISCOUNT_MIN}% a ${PICKUP_DISCOUNT_MAX}%)`}
                  type="number"
                  step="0.01"
                  min={PICKUP_DISCOUNT_MIN}
                  max={PICKUP_DISCOUNT_MAX}
                  disabled={!canEdit}
                  value={pct === 0 ? '' : String(pct)}
                  onChange={(e) => setForm({ ...form, pickupDiscountPercent: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                  placeholder="Ex: 10"
                  error={pctInvalid ? 'Informe um valor maior que 0 e até 50%.' : undefined}
                />

                <p className="text-[11px] text-gray-600">
                  Regra: o desconto vale para <strong>todos os itens</strong> do pedido de retirada, exceto as exceções abaixo.
                  É aplicado uma única vez, antes do cupom.
                </p>

                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" disabled={!canEdit} checked={form.pickupDiscountExcludePromotional ?? false}
                    onChange={(e) => setForm({ ...form, pickupDiscountExcludePromotional: e.target.checked })} />
                  Não aplicar em itens que já estão em promoção (produtos com preço promocional e ofertas promocionais)
                </label>

                <div className="space-y-1">
                  <span className="text-xs font-semibold text-gray-700 block">Produtos fora do desconto ({excludedProducts.length})</span>
                  <input
                    type="text"
                    placeholder="Filtrar produtos..."
                    value={productFilter}
                    onChange={(e) => setProductFilter(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-lg bg-white"
                  />
                  <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
                    {visibleProducts.length === 0 && <p className="text-[11px] text-gray-500 p-2">Nenhum produto.</p>}
                    {visibleProducts.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer">
                        <input type="checkbox" disabled={!canEdit} checked={excludedProducts.includes(p.id)}
                          onChange={() => setForm({ ...form, pickupDiscountExcludedProductIds: toggleId(excludedProducts, p.id) })} />
                        <span className="flex-1">{p.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-semibold text-gray-700 block">Ofertas promocionais (checkout próprio) fora do desconto ({excludedOffers.length})</span>
                  <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
                    {offers.length === 0 && <p className="text-[11px] text-gray-500 p-2">Nenhuma oferta com checkout próprio.</p>}
                    {offers.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer">
                        <input type="checkbox" disabled={!canEdit} checked={excludedOffers.includes(o.id)}
                          onChange={() => setForm({ ...form, pickupDiscountExcludedOfferIds: toggleId(excludedOffers, o.id) })} />
                        <span className="flex-1">{o.promoTitle || o.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
};
