import { describe, it, expect } from 'vitest';
import { normalizeText, searchProducts } from '../search';

const cats = [{ id: 'c1', name: 'Bebidas' }, { id: 'c2', name: 'Açaí e Sobremesas' }];
const P = (id: string, name: string, description = '', categoryId = 'c1') => ({ id, name, description, categoryId });
const products = [
  P('1', 'Cerveja Heineken Lata', 'Cerveja puro malte 350ml'),
  P('2', 'Açaí 500ml', 'Com granola e banana', 'c2'),
  P('3', 'Água com gás', 'Garrafa 500ml'),
  P('4', 'Combo Petisco', 'Batata e calabresa acompanha cerveja'),
];

describe('busca de produtos', () => {
  it('normaliza acentos e maiúsculas', () => {
    expect(normalizeText('  AÇAÍ  com   Gás ')).toBe('acai com gas');
  });
  it('encontra sem acento, por nome, descrição e categoria', () => {
    expect(searchProducts(products, cats, 'acai').map(p => p.id)).toEqual(['2']);
    expect(searchProducts(products, cats, 'agua').map(p => p.id)).toEqual(['3']);
    expect(searchProducts(products, cats, 'granola').map(p => p.id)).toEqual(['2']);
    expect(searchProducts(products, cats, 'sobremesas').map(p => p.id)).toEqual(['2']);
    expect(searchProducts(products, cats, 'bebidas').map(p => p.id)).toEqual(['1', '3', '4']);
  });
  it('prioriza nome que começa com o termo e exige todos os termos', () => {
    expect(searchProducts(products, cats, 'cerveja').map(p => p.id)).toEqual(['1', '4']);
    expect(searchProducts(products, cats, 'cerveja lata').map(p => p.id)).toEqual(['1']);
  });
  it('termo vazio ou sem resultado → lista vazia', () => {
    expect(searchProducts(products, cats, '   ')).toEqual([]);
    expect(searchProducts(products, cats, 'pizza')).toEqual([]);
  });
});
