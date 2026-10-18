import type { Category, Product } from '../../types';

/** Minúsculas, sem acento e com espaços normalizados ("Açaí" → "acai"). */
export function normalizeText(v: string | null | undefined): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca de produtos da loja: todos os termos precisam aparecer no nome, descrição ou nome da categoria.
 * Sem acento/maiúsculas. Ordena: nome que começa com o termo > nome contém > só descrição/categoria.
 */
export function searchProducts<P extends Pick<Product, 'id' | 'name' | 'description' | 'categoryId'>>(
  products: P[],
  categories: Pick<Category, 'id' | 'name'>[],
  term: string
): P[] {
  const q = normalizeText(term);
  if (!q) return [];
  const terms = q.split(' ').filter(Boolean);
  const catName = new Map(categories.map(c => [c.id, normalizeText(c.name)]));
  const scored: Array<{ p: P; score: number; i: number }> = [];
  products.forEach((p, i) => {
    const name = normalizeText(p.name);
    const hay = `${name} ${normalizeText(p.description)} ${catName.get(p.categoryId) || ''}`;
    if (!terms.every(t => hay.includes(t))) return;
    const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : terms.every(t => name.includes(t)) ? 2 : 3;
    scored.push({ p, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map(s => s.p);
}
