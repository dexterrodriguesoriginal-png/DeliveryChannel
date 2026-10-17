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

  it('PREPARING: a tag "agora" aparece só em "Em preparo" (etapa 3)', () => {
    const tl = buildCustomerTimeline({
      status: 'PREPARING',
      fulfillmentType: 'DELIVERY',
      createdAt: '2026-10-17T10:00:00Z',
      statusHistory: [
        { status: 'PENDING', timestamp: '2026-10-17T10:00:00Z', changedBy: '' },
        { status: 'PREPARING', timestamp: '2026-10-17T10:05:00Z', changedBy: '' },
      ],
    } as any);
    const html = renderToStaticMarkup(<OrderTrackingTimeline timeline={tl} />);
    expect(html).toContain('data-step="preparing" data-state="current"');
    expect(html).toContain('data-step="ready" data-state="pending"');
    expect((html.match(/>agora</g) || []).length).toBe(1);
    const agoraAt = html.indexOf('>agora<');
    expect(agoraAt).toBeGreaterThan(html.indexOf('Em preparo'));
    expect(agoraAt).toBeLessThan(html.indexOf('data-step="ready"'));
  });
});
