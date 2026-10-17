import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ownerOrderStatusLabel, ownerStatusToastMessage } from '../labels';
import { applyOrderUpdate } from '../applyOrderUpdate';
import { orderMoneyBreakdown } from '../orderTotals';

describe('toasts de status do dono em pt-BR', () => {
  it('rótulos de todos os status', () => {
    expect(ownerOrderStatusLabel('PENDING')).toBe('NOVO');
    expect(ownerOrderStatusLabel('CONFIRMED')).toBe('CONFIRMADO');
    expect(ownerOrderStatusLabel('PREPARING')).toBe('EM PREPARO');
    expect(ownerOrderStatusLabel('READY')).toBe('PRONTO');
    expect(ownerOrderStatusLabel('WAITING_FOR_DRIVER')).toBe('AGUARDANDO MOTOBOY');
    expect(ownerOrderStatusLabel('OUT_FOR_DELIVERY')).toBe('SAIU PARA ENTREGA');
    expect(ownerOrderStatusLabel('DELIVERED')).toBe('ENTREGUE');
    expect(ownerOrderStatusLabel('CANCELLED')).toBe('CANCELADO');
    expect(ownerOrderStatusLabel('ALGO_NOVO')).toBe('ATUALIZADO');
  });

  it('mensagem do toast nunca mostra o enum cru', () => {
    expect(ownerStatusToastMessage('PREPARING', 1042)).toBe('Pedido #1042 atualizado para "EM PREPARO".');
    expect(ownerStatusToastMessage('READY')).toBe('Pedido atualizado para "PRONTO".');
    for (const st of ['CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']) {
      expect(ownerStatusToastMessage(st, 7)).not.toContain(st);
    }
  });

  it('telas do dono não interpolam o status cru no toast', () => {
    for (const f of ['src/pages/establishment/OrdersPage.tsx', 'src/pages/establishment/EstablishmentDashboard.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/atualizado para "\$\{newStatus\}"/);
      expect(src).not.toMatch(/avançou para "\$\{nextStatus\}"/);
    }
  });
});

describe('atualização otimista do card', () => {
  const base = [
    { id: 'a', status: 'CONFIRMED', totalAmount: 10 },
    { id: 'b', status: 'PENDING', totalAmount: 5 },
  ] as any[];

  it('troca só o pedido alterado, na hora', () => {
    const next = applyOrderUpdate(base, { id: 'a', status: 'PREPARING', totalAmount: 10 } as any)!;
    expect(next[0].status).toBe('PREPARING');
    expect(next[1]).toBe(base[1]);
    expect(base[0].status).toBe('CONFIRMED');
  });

  it('lista vazia/pedido ausente não muda nada', () => {
    expect(applyOrderUpdate(null, { id: 'a' } as any)).toBeNull();
    expect(applyOrderUpdate(base, { id: 'z', status: 'READY' } as any)).toBe(base);
    expect(applyOrderUpdate(base, null)).toBe(base);
  });
});

describe('resumo financeiro do pedido (painel do dono e cupom)', () => {
  const items = [{ totalPrice: 10 }, { totalPrice: 5 }] as any[];

  it('entrega: Subtotal 15, Taxa de entrega 7, Total 22', () => {
    const b = orderMoneyBreakdown({ subtotal: 15, discount: 0, deliveryFee: 7, totalAmount: 22, fulfillmentType: 'DELIVERY', items } as any);
    expect(b).toEqual({ subtotal: 15, discount: 0, deliveryFee: 7, total: 22, showDeliveryFee: true });
  });

  it('taxa não veio no registro mas o total inclui: mostra a diferença', () => {
    const b = orderMoneyBreakdown({ subtotal: 0, discount: 0, deliveryFee: 0, totalAmount: 22, fulfillmentType: 'DELIVERY', items } as any);
    expect(b.subtotal).toBe(15);
    expect(b.deliveryFee).toBe(7);
  });

  it('com desconto', () => {
    const b = orderMoneyBreakdown({ subtotal: 15, discount: 2, deliveryFee: 7, totalAmount: 20, fulfillmentType: 'DELIVERY', items } as any);
    expect(b.discount).toBe(2);
    expect(b.subtotal - b.discount + b.deliveryFee).toBe(b.total);
  });

  it('retirada sem taxa não mostra a linha', () => {
    const b = orderMoneyBreakdown({ subtotal: 15, discount: 0, deliveryFee: 0, totalAmount: 15, fulfillmentType: 'PICKUP', items } as any);
    expect(b.showDeliveryFee).toBe(false);
  });
});

describe('R$ com vírgula nas telas do dono', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(n => {
      const p = join(dir, n);
      if (n === '__tests__') return [];
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
    });

  it('nenhum "R$ {x.toFixed(2)}" (ponto decimal) em pages/establishment e components/establishment', () => {
    const offenders: string[] = [];
    for (const f of [...walk('src/pages/establishment'), ...walk('src/components/establishment')]) {
      const src = readFileSync(f, 'utf8');
      if (/R\$ \$?\{[^}]*\.toFixed\(2\)/.test(src) || /'R\$ ' \+ [^;]*\.toFixed\(2\)/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
