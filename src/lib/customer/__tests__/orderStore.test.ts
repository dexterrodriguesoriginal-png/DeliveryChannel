import { describe, it, expect } from 'vitest';
import { customerOrdersTitle, storeDisplayName, CUSTOMER_ORDERS_SCOPE_HINT } from '../orderStore';

describe('orderStore: loja explícita na aba Pedidos do cliente', () => {
  it('título "Pedidos em <Loja>"', () => {
    expect(customerOrdersTitle('Bar do Beto')).toBe('Pedidos em Bar do Beto');
    expect(customerOrdersTitle('  ')).toBe('Seus pedidos');
    expect(customerOrdersTitle(storeDisplayName('', ''))).toBe('Seus pedidos');
  });
  it('nome do tema tem prioridade; cai para o nome do tenant', () => {
    expect(storeDisplayName('Espeto do Bahia', 'espeto')).toBe('Espeto do Bahia');
    expect(storeDisplayName('', 'Bar do Beto')).toBe('Bar do Beto');
    expect(storeDisplayName(null, null)).toBe('esta loja');
  });
  it('avisa que a lista é só desta loja', () => {
    expect(CUSTOMER_ORDERS_SCOPE_HINT).toContain('só os pedidos feitos nesta loja');
  });
});
