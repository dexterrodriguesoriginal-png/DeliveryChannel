import type { Product, SelectedProductOption } from '../../types';
import { addDineInCartLine, type DineInCartLine } from './dineInCart';

export const dineInCartStorageKey = (token: string) => `dc_dinein_cart:${token}`;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Only product IDs/options/quantities; no customer identity or cached prices. Scoped to this QR. */
export function saveDineInCart(storage: StorageAccess | null, token: string, cart: DineInCartLine[], checkoutPending: boolean, now = Date.now()) {
  try {
    if (!cart.length) { storage?.removeItem(dineInCartStorageKey(token)); return; }
    storage?.setItem(dineInCartStorageKey(token), JSON.stringify({ at: now, checkoutPending, lines: cart.map(line => ({
      productId: line.product.id, quantity: line.quantity, options: line.options, notes: line.notes,
    })) }));
  } catch { /* unavailable or full storage must not stop ordering */ }
}

export function restoreDineInCart(storage: StorageAccess | null, token: string, products: Product[], now = Date.now()): { cart: DineInCartLine[]; checkoutPending: boolean } {
  const empty = { cart: [], checkoutPending: false };
  try {
    const saved = JSON.parse(storage?.getItem(dineInCartStorageKey(token)) || 'null');
    if (!saved || !Number.isFinite(saved.at) || now - saved.at > MAX_AGE_MS || !Array.isArray(saved.lines)) return empty;
    let cart: DineInCartLine[] = [];
    for (const line of saved.lines.slice(0, 100)) {
      const product = products.find(product => product.id === line.productId);
      if (!product || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) continue;
      const options: SelectedProductOption[] = Array.isArray(line.options) ? line.options.filter((option: any) => option && typeof option.groupId === 'string' && typeof option.optionId === 'string' && Number.isFinite(option.qty) && option.qty > 0).slice(0, 100) : [];
      const next = addDineInCartLine([], product, options)[0];
      cart.push({ ...next, quantity: line.quantity, notes: typeof line.notes === 'string' ? line.notes.slice(0, 500) : '' });
    }
    return { cart, checkoutPending: saved.checkoutPending === true && cart.length > 0 };
  } catch { return empty; }
}

