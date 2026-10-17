import { describe, it, expect } from 'vitest';
import { storeDeliveryLabel, parseBRMoney } from '../deliveryLabel';

describe('storeDeliveryLabel', () => {
  it('mostra a taxa configurada mesmo com carrinho vazio', () => {
    expect(storeDeliveryLabel({ deliveryFee: 7 })).toBe('Entrega R$ 7,00');
  });
  it('grátis só quando a taxa é zero', () => {
    expect(storeDeliveryLabel({ deliveryFee: 0 })).toBe('Entrega Grátis');
    expect(storeDeliveryLabel({})).toBe('Entrega Grátis');
  });
  it('informa o limite de frete grátis', () => {
    expect(storeDeliveryLabel({ deliveryFee: 7, freeDeliveryThreshold: 100 })).toBe('Entrega R$ 7,00 (grátis acima de R$ 100,00)');
    expect(storeDeliveryLabel({ deliveryFee: 7, freeDeliveryThreshold: 0 })).toBe('Entrega R$ 7,00');
  });
});

describe('parseBRMoney', () => {
  it('aceita vírgula decimal', () => {
    expect(parseBRMoney('7,00')).toBe(7);
    expect(parseBRMoney('7,50')).toBe(7.5);
    expect(parseBRMoney('1.234,56')).toBe(1234.56);
    expect(parseBRMoney('R$ 3,5')).toBe(3.5);
  });
  it('aceita ponto decimal e número', () => {
    expect(parseBRMoney('7.5')).toBe(7.5);
    expect(parseBRMoney(7)).toBe(7);
  });
  it('inválido → NaN', () => {
    expect(parseBRMoney('')).toBeNaN();
    expect(parseBRMoney('abc')).toBeNaN();
  });
});
