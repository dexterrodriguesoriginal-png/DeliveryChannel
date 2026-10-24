import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUSINESS_TYPES } from '../modules';
import {
  DEMO_PACKS,
  DEMO_SEGMENT_BY_BUSINESS_TYPE,
  getDemoPack,
} from '../demoPacks';

const EXPECTED_SEGMENTS = [
  'adega', 'pizzaria', 'padaria', 'mercado', 'barbearia', 'salao-beleza',
  'perfumaria', 'hot-dog', 'espetinho', 'tabacaria', 'hamburgueria', 'acai',
  'japonesa', 'farmacia', 'pet', 'cafe-doceria', 'escritorio-servicos', 'generico',
];

describe('pacotes de demonstração por segmento', () => {
  it('disponibiliza os 18 segmentos e uma sugestão para todo tipo do onboarding', () => {
    expect(DEMO_PACKS.map(pack => pack.segment).sort()).toEqual([...EXPECTED_SEGMENTS].sort());
    for (const { key } of BUSINESS_TYPES) {
      const segment = DEMO_SEGMENT_BY_BUSINESS_TYPE[key];
      expect(segment, key).toBeTruthy();
      expect(getDemoPack(segment), key).toBeDefined();
    }
    expect(getDemoPack('segmento-inexistente')).toBeUndefined();
  });

  it('mantém os identificadores únicos entre todos os pacotes e tipos de item', () => {
    const ids = DEMO_PACKS.flatMap(pack => [...pack.categories, ...pack.products, ...pack.offers].map(item => item.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const pack of DEMO_PACKS) {
    it(`${pack.label}: oferece categorias, produtos com preços positivos e ofertas vinculadas`, () => {
      expect(pack.categories.length).toBeGreaterThanOrEqual(4);
      expect(pack.categories.length).toBeLessThanOrEqual(8);
      expect(pack.products.length).toBeGreaterThanOrEqual(8);
      expect(pack.products.length).toBeLessThanOrEqual(20);
      expect(pack.offers.length).toBeGreaterThanOrEqual(2);
      expect(pack.offers.length).toBeLessThanOrEqual(3);
      const categories = new Set(pack.categories.map(category => category.id));
      const products = new Map(pack.products.map(product => [product.id, product]));
      for (const category of pack.categories) {
        expect(category.name.trim()).not.toBe('');
        expect(category.description.trim()).not.toBe('');
        expect(pack.products.some(product => product.categoryId === category.id)).toBe(true);
      }
      for (const product of pack.products) {
        expect(product.name.trim()).not.toBe('');
        expect(product.description.trim()).not.toBe('');
        expect(Number.isFinite(product.price)).toBe(true);
        expect(product.price).toBeGreaterThan(0);
        expect(categories.has(product.categoryId), product.id).toBe(true);
      }
      for (const offer of pack.offers) {
        const product = products.get(offer.productId);
        expect(product, offer.id).toBeDefined();
        expect(offer.title.trim()).not.toBe('');
        expect(offer.description.trim()).not.toBe('');
        expect(offer.originalPrice).toBe(product?.price);
        expect(offer.promotionalPrice).toBeGreaterThan(0);
        expect(offer.promotionalPrice).toBeLessThan(offer.originalPrice);
      }
    });

    it(`${pack.label}: usa imagens locais disponíveis no diretório do segmento`, () => {
      for (const item of [...pack.categories, ...pack.products, ...pack.offers]) {
        expect(item.image.startsWith(`/demo/${pack.segment}/`)).toBe(true);
        const assetPath = resolve(process.cwd(), 'public', item.image.slice(1));
        expect(existsSync(assetPath), item.image).toBe(true);
        expect(readFileSync(assetPath, 'utf8')).toContain('Imagem demonstrativa');
      }
    });
  }

  it('mantém o catálogo de pizzaria limitado ao seu segmento', () => {
    const pack = getDemoPack('pizzaria')!;
    expect(pack.products.some(product => product.name.includes('Pizza'))).toBe(true);
    expect(pack.products.some(product => /cerveja|vinho|whisky|gin /i.test(product.name))).toBe(false);
    expect(pack.products.every(product => product.id.startsWith('pizzaria-'))).toBe(true);
    expect(pack.offers.every(offer => pack.products.some(product => product.id === offer.productId))).toBe(true);
  });
});
