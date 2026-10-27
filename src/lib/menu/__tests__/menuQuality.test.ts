import { describe, expect, it } from 'vitest';
import type { Product } from '../../../types';
import { filterQuality, hasCategory, menuQuality, productQuality, qualityTone, scoreGainIfFixed, sortWorstFirst, QUALITY_WEIGHTS } from '../menuQuality';

const DESC = 'Hambúrguer artesanal com queijo e molho da casa.'; // > 20 chars
const p = (id: string, over: Partial<Product> = {}): Product => ({
  id, tenantId: 't', categoryId: 'c1', name: `Item ${id}`, description: DESC, price: 10, imageUrl: 'https://x/y.webp',
  isAvailable: true, isActive: true, stockQuantity: 1, unit: 'un', ...over,
} as Product);
const cats = [{ id: 'c1' }, { id: 'c2' }];

describe('pesos', () => {
  it('somam 100: foto 35, descrição 30, preço 25, categoria 10', () => {
    expect(QUALITY_WEIGHTS).toEqual({ photo: 35, description: 30, price: 25, category: 10 });
    expect(Object.values(QUALITY_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('nota por produto', () => {
  it('produto completo vale 100', () => expect(productQuality(p('1'), cats).score).toBe(100));
  it.each([
    ['sem foto', { imageUrl: '' }, 65], ['foto só espaços', { imageUrl: '   ' }, 65],
    ['sem descrição', { description: '' }, 70], ['descrição curta (19 chars)', { description: 'a'.repeat(19) }, 70],
    ['sem preço', { price: 0 }, 75], ['preço negativo', { price: -1 }, 75], ['preço NaN', { price: NaN }, 75],
    ['sem categoria', { categoryId: '' }, 90], ['categoria inexistente na loja', { categoryId: 'zzz' }, 90],
  ] as const)('%s', (_n, over, score) => {
    expect(productQuality(p('1', over as Partial<Product>), cats).score).toBe(score);
  });
  it('descrição com exatamente 20 caracteres (sem contar espaços nas pontas) conta', () => {
    expect(productQuality(p('1', { description: `  ${'a'.repeat(20)}  ` }), cats).checks.description).toBe(true);
    expect(productQuality(p('1', { description: 'a'.repeat(20) }), cats).checks.description).toBe(true);
  });
  it('sem lista de categorias, basta ter categoryId', () => {
    expect(hasCategory({ categoryId: 'qualquer' })).toBe(true);
    expect(hasCategory({ categoryId: '' })).toBe(false);
  });
  it('lista o que falta por ordem de peso', () => {
    expect(productQuality(p('1', { imageUrl: '', price: 0, categoryId: '' }), cats).missing).toEqual(['photo', 'price', 'category']);
  });
});

describe('nota do cardápio', () => {
  it('só conta produtos ativos e faz a média ponderada', () => {
    const q = menuQuality([p('1'), p('2', { imageUrl: '' }), p('3', { isActive: false, imageUrl: '', description: '', price: 0 })], cats);
    expect(q.total).toBe(2);
    expect(q.score).toBe(83); // (100 + 65) / 2 = 82,5 → 83
    expect(q.pct).toEqual({ photo: 50, description: 100, price: 100, category: 100 });
    expect(q.perfect).toBe(1);
  });
  it('100% só quando todos estão perfeitos: 99,6% não arredonda para 100', () => {
    const many = Array.from({ length: 300 }, (_, i) => p(String(i)));
    many[0] = p('x', { categoryId: '' });
    const q = menuQuality(many, cats);
    expect(q.score).toBe(99);
    expect(q.pct.category).toBe(99);
    expect(menuQuality(many.slice(1), cats).score).toBe(100);
  });
  it('sem produtos ativos: nota 0 e total 0 (não é 100%)', () => {
    expect(menuQuality([], cats)).toMatchObject({ total: 0, score: 0 });
    expect(menuQuality([p('1', { isActive: false })], cats).total).toBe(0);
  });
  it('tudo vazio dá 0', () => {
    expect(menuQuality([p('1', { imageUrl: '', description: '', price: 0, categoryId: '' })], cats).score).toBe(0);
  });
  it('cores: vermelho < 50, âmbar 50–79, verde ≥ 80', () => {
    expect([0, 49, 50, 79, 80, 100].map(qualityTone)).toEqual(['low', 'low', 'mid', 'mid', 'high', 'high']);
  });
});

describe('lista', () => {
  const items = menuQuality([
    p('a', { name: 'Zebra' }), p('b', { name: 'Batata', imageUrl: '' }), p('c', { name: 'Anel', imageUrl: '', price: 0, categoryId: 'c2' }),
    p('d', { name: 'Coxinha', description: '' }),
  ], cats).items;
  it('piores primeiro, desempate por nome', () => {
    expect(sortWorstFirst(items).map(i => i.product.name)).toEqual(['Anel', 'Batata', 'Coxinha', 'Zebra']);
  });
  it('filtra por problema, categoria e busca', () => {
    const f = (o: object) => filterQuality(items, { problem: 'ALL', categoryId: 'ALL', search: '', ...o }).map(i => i.product.name).sort();
    expect(f({ problem: 'NO_PHOTO' })).toEqual(['Anel', 'Batata']);
    expect(f({ problem: 'NO_DESCRIPTION' })).toEqual(['Coxinha']);
    expect(f({ problem: 'NO_PRICE' })).toEqual(['Anel']);
    expect(f({ problem: 'NO_CATEGORY' })).toEqual([]);
    expect(f({ problem: 'ANY' })).toEqual(['Anel', 'Batata', 'Coxinha']);
    expect(f({ categoryId: 'c2' })).toEqual(['Anel']);
    expect(f({ search: ' bata ' })).toEqual(['Batata']);
    expect(f({ problem: 'NO_PHOTO', search: 'anel' })).toEqual(['Anel']);
  });
  it('ganho de nota ao corrigir um item', () => {
    const anel = items.find(i => i.product.name === 'Anel')!;
    expect(scoreGainIfFixed(anel, 'photo', 4)).toBe(8.8);
    expect(scoreGainIfFixed(anel, 'category', 4)).toBe(0); // já ok
  });
});
