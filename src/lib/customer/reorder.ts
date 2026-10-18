import type { OrderItem, Product } from '../../types';
import { CATALOG_ORIGIN, PurchaseOrigin, cartLineKey, catalogUnitPrice } from '../pricing/purchaseOrigin';

export interface ReorderLine {
  key: string;
  product: Product;
  quantity: number;
  notes?: string;
  origin: PurchaseOrigin;
}

export interface ReorderResult {
  lines: ReorderLine[];
  /** Itens que não voltaram para a sacola (produto removido, inativo ou esgotado). */
  unavailable: string[];
  /** Itens que voltaram com preço diferente do pedido original. */
  priceChanged: Array<{ name: string; before: number; now: number }>;
}

/**
 * "Peça de novo": monta a sacola com o catálogo ATUAL da loja (preço vigente, nunca o preço antigo).
 * Itens de campanha voltam como catálogo (a oferta pode ter acabado). Produto ausente/inativo/esgotado fica de fora.
 * Mesmo produto repetido no pedido soma quantidades numa linha só.
 */
export function buildReorderCart(items: OrderItem[], products: Product[], tenantId: string): ReorderResult {
  const res: ReorderResult = { lines: [], unavailable: [], priceChanged: [] };
  for (const it of items || []) {
    const p = products.find(x => x.id === it.productId && x.tenantId === tenantId);
    const available = p && p.isActive !== false && (p.isAvailable !== undefined ? p.isAvailable : (p.stockQuantity ?? 1) > 0);
    if (!p || !available) {
      if (!res.unavailable.includes(it.productName)) res.unavailable.push(it.productName);
      continue;
    }
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
    const key = cartLineKey(p.id, CATALOG_ORIGIN);
    const existing = res.lines.find(l => l.key === key);
    if (existing) existing.quantity += qty;
    else res.lines.push({ key, product: p, quantity: qty, notes: it.notes || undefined, origin: CATALOG_ORIGIN });
    const now = catalogUnitPrice(p).unitPrice;
    const before = Number(it.unitPrice);
    if (Number.isFinite(before) && Math.abs(before - now) >= 0.01 && !res.priceChanged.some(c => c.name === p.name)) {
      res.priceChanged.push({ name: p.name, before, now });
    }
  }
  return res;
}
