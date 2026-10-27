import type { Category, Product } from '../../types';

/** Qualidade do Cardápio: nota por produto ativo, calculada no cliente a partir dos dados existentes. */
export const QUALITY_WEIGHTS = { photo: 35, description: 30, price: 25, category: 10 } as const;
export const MIN_DESCRIPTION_CHARS = 20;

export type QualityKey = keyof typeof QUALITY_WEIGHTS;
export const QUALITY_KEYS: QualityKey[] = ['photo', 'description', 'price', 'category'];
export const QUALITY_LABELS: Record<QualityKey, string> = { photo: 'Foto', description: 'Descrição', price: 'Preço', category: 'Categoria' };

export interface ProductQuality {
  product: Product;
  checks: Record<QualityKey, boolean>;
  /** 0–100, soma dos pesos dos itens que estão ok. */
  score: number;
  /** Itens que faltam, na ordem de peso (foto primeiro). */
  missing: QualityKey[];
}

export type QualityProblemFilter = 'ALL' | 'NO_PHOTO' | 'NO_DESCRIPTION' | 'NO_PRICE' | 'NO_CATEGORY' | 'ANY';
export const PROBLEM_TO_KEY: Record<Exclude<QualityProblemFilter, 'ALL' | 'ANY'>, QualityKey> = {
  NO_PHOTO: 'photo', NO_DESCRIPTION: 'description', NO_PRICE: 'price', NO_CATEGORY: 'category',
};

export const isActiveProduct = (p: Pick<Product, 'isActive'>) => p.isActive !== false;
export const hasPhoto = (p: Pick<Product, 'imageUrl'>) => typeof p.imageUrl === 'string' && p.imageUrl.trim().length > 0;
export const hasDescription = (p: Pick<Product, 'description'>) => typeof p.description === 'string' && p.description.trim().length >= MIN_DESCRIPTION_CHARS;
export const hasValidPrice = (p: Pick<Product, 'price'>) => typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0;

/** Categoria só conta se existir na loja (quando a lista de categorias é conhecida). */
export function hasCategory(p: Pick<Product, 'categoryId'>, categories?: readonly Pick<Category, 'id'>[]) {
  const id = typeof p.categoryId === 'string' ? p.categoryId.trim() : '';
  if (!id) return false;
  return categories ? categories.some(c => c.id === id) : true;
}

export function productQuality(product: Product, categories?: readonly Pick<Category, 'id'>[]): ProductQuality {
  const checks: Record<QualityKey, boolean> = {
    photo: hasPhoto(product), description: hasDescription(product), price: hasValidPrice(product), category: hasCategory(product, categories),
  };
  const score = QUALITY_KEYS.reduce((sum, key) => sum + (checks[key] ? QUALITY_WEIGHTS[key] : 0), 0);
  return { product, checks, score, missing: QUALITY_KEYS.filter(key => !checks[key]) };
}

export interface MenuQuality {
  /** Produtos ativos considerados. */
  total: number;
  /** 0–100; só chega a 100 quando TODOS os produtos ativos estão perfeitos. */
  score: number;
  /** Percentual (0–100) de produtos ativos com cada item. */
  pct: Record<QualityKey, number>;
  counts: Record<QualityKey, number>;
  items: ProductQuality[];
  perfect: number;
}

const pctOf = (count: number, total: number, allOk: boolean) => (total === 0 ? 0 : allOk ? 100 : Math.min(99, Math.round((count / total) * 100)));

export function menuQuality(products: readonly Product[], categories?: readonly Pick<Category, 'id'>[]): MenuQuality {
  const items = products.filter(isActiveProduct).map(p => productQuality(p, categories));
  const total = items.length;
  const counts = Object.fromEntries(QUALITY_KEYS.map(k => [k, items.filter(i => i.checks[k]).length])) as Record<QualityKey, number>;
  const pct = Object.fromEntries(QUALITY_KEYS.map(k => [k, pctOf(counts[k], total, counts[k] === total)])) as Record<QualityKey, number>;
  const sum = items.reduce((s, i) => s + i.score, 0);
  const score = total === 0 ? 0 : sum === total * 100 ? 100 : Math.min(99, Math.round(sum / total));
  return { total, score, pct, counts, items, perfect: items.filter(i => i.score === 100).length };
}

export type QualityTone = 'low' | 'mid' | 'high';
/** Vermelho até 49, âmbar de 50 a 79, verde a partir de 80. */
export const qualityTone = (score: number): QualityTone => (score >= 80 ? 'high' : score >= 50 ? 'mid' : 'low');
export const QUALITY_TONE_COLOR: Record<QualityTone, string> = { low: '#ef4444', mid: '#f59e0b', high: '#16a34a' };
export const qualityColor = (score: number) => QUALITY_TONE_COLOR[qualityTone(score)];

/** Piores primeiro (nota menor), desempate por nome. */
export function sortWorstFirst(items: readonly ProductQuality[]): ProductQuality[] {
  return [...items].sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name, 'pt-BR'));
}

export interface QualityFilters { problem: QualityProblemFilter; categoryId: string; search: string }
export function filterQuality(items: readonly ProductQuality[], f: QualityFilters): ProductQuality[] {
  const q = f.search.trim().toLocaleLowerCase('pt-BR');
  return items.filter(i => {
    if (f.problem === 'ANY' && i.missing.length === 0) return false;
    if (f.problem !== 'ALL' && f.problem !== 'ANY' && i.checks[PROBLEM_TO_KEY[f.problem]]) return false;
    if (f.categoryId !== 'ALL' && i.product.categoryId !== f.categoryId) return false;
    if (q && !`${i.product.name} ${i.product.sku ?? ''}`.toLocaleLowerCase('pt-BR').includes(q)) return false;
    return true;
  });
}

/** Quanto a nota geral sobe se o item `key` do produto for corrigido (em pontos percentuais, 1 casa). */
export function scoreGainIfFixed(item: ProductQuality, key: QualityKey, total: number) {
  if (item.checks[key] || total === 0) return 0;
  return Math.round((QUALITY_WEIGHTS[key] / total) * 10) / 10;
}

export function celebrationMessage(score: number, total: number): string | null {
  if (total === 0) return null;
  if (score === 100) return 'Cardápio 100% otimizado! Seus clientes vão ver tudo com foto, descrição e preço.';
  return null;
}
