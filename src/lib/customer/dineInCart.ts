import type { Product, SelectedProductOption } from '../../types';
import { optionPriceCents } from '../addons';

export interface DineInCartLine {
  key: string;
  product: Product;
  quantity: number;
  options: SelectedProductOption[];
}

/** Formato do servidor (_normalize_product_option_selections): chaves snake_case. */
export interface DineInServerOption {
  group_id: string;
  option_id: string;
  qty: number;
  fraction: number | null;
}

export interface DineInRoundItem {
  productId: string;
  quantity: number;
  notes: string;
  options: DineInServerOption[];
}

function normalizedOptions(options: SelectedProductOption[]): SelectedProductOption[] {
  return [...options].sort((a, b) =>
    `${a.groupId}:${a.optionId}:${a.qty}:${a.fraction ?? ''}`.localeCompare(
      `${b.groupId}:${b.optionId}:${b.qty}:${b.fraction ?? ''}`
    )
  );
}

export function dineInCartLineKey(productId: string, options: SelectedProductOption[]): string {
  const normalized = normalizedOptions(options);
  return `${productId}::${normalized.map(option =>
    `${option.groupId}:${option.optionId}:${option.qty}:${option.fraction ?? ''}`
  ).join('|')}`;
}

export function addDineInCartLine(
  cart: DineInCartLine[],
  product: Product,
  options: SelectedProductOption[] = []
): DineInCartLine[] {
  const stableOptions = normalizedOptions(options);
  const key = dineInCartLineKey(product.id, stableOptions);
  const existing = cart.find(line => line.key === key);
  return existing
    ? cart.map(line => line.key === key ? { ...line, quantity: line.quantity + 1 } : line)
    : [...cart, { key, product, quantity: 1, options: stableOptions }];
}

export function changeDineInCartLineQuantity(
  cart: DineInCartLine[],
  key: string,
  delta: number
): DineInCartLine[] {
  return cart
    .map(line => line.key === key ? { ...line, quantity: line.quantity + delta } : line)
    .filter(line => line.quantity > 0);
}

export function dineInCartLineUnitPriceCents(line: DineInCartLine): number {
  return Math.round(line.product.price * 100) +
    optionPriceCents(line.product.optionGroups || [], line.options);
}

export function dineInRoundItem(
  item: { productId: string; quantity: number } & {
    notes?: string;
    options?: SelectedProductOption[];
  }
): DineInRoundItem {
  return {
    productId: item.productId,
    quantity: item.quantity,
    notes: item.notes || '',
    options: (item.options || []).map(option => ({
      group_id: option.groupId,
      option_id: option.optionId,
      qty: Math.trunc(Number(option.qty)),
      fraction: option.fraction ?? null,
    })),
  };
}

export function dineInRoundItems(cart: DineInCartLine[]): DineInRoundItem[] {
  return cart.map(line => dineInRoundItem({
    productId: line.product.id,
    quantity: line.quantity,
    options: line.options,
  }));
}

export function dineInOptionLabels(product: Product, selections: SelectedProductOption[]): string[] {
  return selections.flatMap(selection => {
    const group = product.optionGroups?.find(item => item.id === selection.groupId);
    const option = group?.options.find(item => item.id === selection.optionId);
    if (!group || !option) return [];
    return [`${group.name}: ${option.name}${selection.qty > 1 ? ` ×${selection.qty}` : ''}`];
  });
}
