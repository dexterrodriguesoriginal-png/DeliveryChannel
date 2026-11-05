import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '../../../types';
import { OrderStatusChip } from '../StatusIcon';
import { STATUS_COLORS } from '../../../lib/orders/statusColors';

describe('selo de status usa os hex compartilhados em todos os canais', () => {
  it.each(['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as OrderStatus[])('%s mantém ícone e texto com a cor exata do token', status => {
    const colors = STATUS_COLORS[status];
    for (const fulfillmentType of ['DELIVERY', 'DINE_IN', 'PICKUP'] as const) {
      const html = renderToStaticMarkup(<OrderStatusChip status={status} fulfillmentType={fulfillmentType} />);
      expect(html).toContain(`background-color:${colors.bg}`);
      expect(html).toContain(`color:${colors.fg}`);
      expect(html).toContain(`border-color:${colors.border}`);
      expect(html).toContain('<svg');
      expect(html).toMatch(/<\/svg>[^<]+<\/span>/);
    }
  });
});

