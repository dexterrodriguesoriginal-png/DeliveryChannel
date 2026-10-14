import type { CardDestination, Offer } from '../types';

export type PromoFulfillment = 'DELIVERY' | 'PICKUP';
const BOTH: PromoFulfillment[] = ['DELIVERY', 'PICKUP'];

/**
 * Compatibilidade do campo LEGADO `promoFulfillmentTypes` (coluna offers.promo_fulfillment_types).
 * O formulário não exibe mais os checkboxes Delivery/Retirada; a escolha é do cliente no checkout,
 * conforme as Configurações da Loja. Regras:
 *  - Card novo: grava ['DELIVERY','PICKUP'] (= sem restrição).
 *  - Card existente: o valor gravado é preservado intacto ao reabrir e salvar (nada é apagado).
 *  - O checkout usa (config da loja) ∩ (valor gravado), ver resolveAvailableModes.
 */
export function initialPromoFulfillmentTypes(card?: Pick<Offer, 'promoFulfillmentTypes'> | null): PromoFulfillment[] {
  const v = card?.promoFulfillmentTypes;
  return v && v.length > 0 ? [...v] : [...BOTH];
}

export function promoFulfillmentTypesForSave(
  destinationType: CardDestination,
  formValue: PromoFulfillment[],
  editingCard?: Pick<Offer, 'promoFulfillmentTypes'> | null,
): PromoFulfillment[] {
  if (destinationType === 'CUSTOM_OFFER') return formValue.length > 0 ? [...formValue] : [...BOTH];
  const existing = editingCard?.promoFulfillmentTypes;
  return existing && existing.length > 0 ? [...existing] : [...BOTH];
}
