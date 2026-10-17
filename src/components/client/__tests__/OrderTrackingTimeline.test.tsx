import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderTrackingTimeline } from '../OrderTrackingTimeline';
import { buildCustomerTimeline } from '../../../lib/orders/customerTracking';

describe('OrderTrackingTimeline', () => {
  it('renderiza as 8 etapas de entrega com a atual marcada', () => {
    const tl = buildCustomerTimeline({
      status: 'OUT_FOR_DELIVERY',
      fulfillmentType: 'DELIVERY',
      createdAt: '2026-10-17T10:00:00Z',
      statusHistory: [
        { status: 'PENDING', timestamp: '2026-10-17T10:00:00Z', changedBy: '' },
        { status: 'OUT_FOR_DELIVERY', timestamp: '2026-10-17T10:20:00Z', changedBy: '' },
      ],
    } as any);
    const html = renderToStaticMarkup(<OrderTrackingTimeline timeline={tl} />);
    expect((html.match(/data-step=/g) || []).length).toBe(8);
    expect(html).toContain('data-step="out_for_delivery" data-state="current"');
    expect(html).toContain('Motoboy indo retirar');
    expect(html).toContain('agora');
  });
});
