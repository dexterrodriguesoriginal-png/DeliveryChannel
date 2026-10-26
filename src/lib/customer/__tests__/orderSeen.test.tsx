import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { reconcileOrderSeen } from '../orderSeen';
import { MobileNavigation } from '../../../components/layout/MobileNavigation';
const mem = () => { const data = new Map<string, string>(); return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }; };
const orders = (status: string) => [{ id: 'order-1', status }];
const nav = (badge: boolean, tab = 'home') => renderToStaticMarkup(<MobileNavigation type="customer" activeTab={tab} onTabChange={() => {}} ordersBadge={badge} />);
describe('ponto vermelho em Pedidos', () => {
  it('mudança fora de Pedidos acende; abrir a aba limpa e persiste o visto após recarga', () => {
    const s = mem();
    expect(reconcileOrderSeen(s, 'store-A:user-1', orders('PENDING'), false)).toBe(false);
    const unread = reconcileOrderSeen(s, 'store-A:user-1', orders('PREPARING'), false);
    expect(unread).toBe(true);
    expect(nav(unread)).toContain('nav-orders-dot');
    expect(nav(unread, 'orders')).not.toContain('nav-orders-dot');
    expect(reconcileOrderSeen(s, 'store-A:user-1', orders('PREPARING'), true)).toBe(false);
    expect(reconcileOrderSeen(s, 'store-A:user-1', orders('PREPARING'), false)).toBe(false);
    expect(reconcileOrderSeen(s, 'store-A:user-1', orders('READY'), false)).toBe(true);
  });
  it('isola lojas, contas e pedidos; só guarda IDs/status', () => {
    const s = mem();
    reconcileOrderSeen(s, 'A:1', orders('PENDING'), true);
    expect(reconcileOrderSeen(s, 'B:1', orders('READY'), false)).toBe(false);
    expect(reconcileOrderSeen(s, 'A:2', orders('READY'), false)).toBe(false);
    expect(reconcileOrderSeen(s, 'A:1', [{ id: 'order-2', status: 'READY' }], false)).toBe(false);
    expect([...s.data.values()]).toEqual(['PENDING', 'READY', 'READY', 'READY']);
  });
  it('mudança enquanto Pedidos está aberta fica vista', () => {
    const s = mem(); reconcileOrderSeen(s, 'A:1', orders('PENDING'), true);
    expect(reconcileOrderSeen(s, 'A:1', orders('READY'), true)).toBe(false);
    expect(reconcileOrderSeen(s, 'A:1', orders('READY'), false)).toBe(false);
  });
  it('storage indisponível não impede a navegação', () => {
    expect(reconcileOrderSeen({ getItem: () => { throw Error(); }, setItem: () => { throw Error(); } }, 'A:1', orders('READY'), false)).toBe(false);
  });
});
