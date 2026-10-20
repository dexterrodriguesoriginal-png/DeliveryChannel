import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KitchenBoard } from '../KitchenBoard';

describe('KitchenBoard station controls', () => {
  it('renders Todos, Cozinha and Bar filters for the station view', () => {
    const html = renderToStaticMarkup(
      <KitchenBoard
        client={{} as any}
        tenantId="tenant"
        storeName="Loja"
        mode="staff"
        initialOrders={[{
          order_id: 'order-1',
          order_number: 1,
          status: 'CONFIRMED',
          fulfillment_type: 'DELIVERY',
          created_at: '2026-10-19T10:00:00Z',
          items: [{ order_item_id: 'item-1', product_name: 'Café', quantity: 1, station: 'BAR' }],
        }]}
      />
    );
    expect(html).toContain('Todos');
    expect(html).toContain('Cozinha');
    expect(html).toContain('Bar');
    expect(html).toContain('Café');
  });
});
