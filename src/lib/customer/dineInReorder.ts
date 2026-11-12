import type { Product, SelectedProductOption } from '../../types';
import { validateOptionSelection } from '../addons';
import { addDineInCartLine, type DineInCartLine } from './dineInCart';

export interface ReorderItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  notes: string;
  options: SelectedProductOption[];
  optionLabels?: string[];
}

/** Recebe o catálogo atual; o checkout continua responsável pelo preço final. */
export function repeatItem(cart: DineInCartLine[], item: ReorderItem, product?: Product): DineInCartLine[] {
  const inCart = cart.filter(line => line.product.id === product?.id)
    .reduce((quantity, line) => quantity + line.quantity, 0);
  if (!product || !product.isActive || !product.isAvailable || product.stockQuantity < item.quantity + inCart) {
    throw new Error('Este item não está mais disponível na quantidade solicitada.');
  }
  const groups = product.optionGroups || [];
  const unavailableOption = item.options.some(selection => {
    const group = groups.find(candidate => candidate.id === selection.groupId && candidate.active);
    return !group?.options.some(option => option.id === selection.optionId && option.active && !option.soldOut);
  });
  if (!validateOptionSelection(groups, item.options).valid || unavailableOption) {
    throw new Error('Os adicionais deste item não estão mais disponíveis.');
  }
  // Observações distintas permanecem em linhas distintas, inclusive nas repetições.
  const key = `${product.id}::reorder:${item.id}:${crypto.randomUUID()}`;
  const line = addDineInCartLine([], product, item.options, item.quantity)[0];
  return [...cart, { ...line, key, notes: item.notes }];
}
