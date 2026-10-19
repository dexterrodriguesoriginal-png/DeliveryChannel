import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrderAgeBadge } from '../OrderAgeBadge';

const NOW = Date.parse('2026-10-19T15:00:00Z');
describe('OrderAgeBadge', () => {
  it('vermelho para pedido em aberto há 3 dias', () => {
    const html = renderToStaticMarkup(<OrderAgeBadge now={NOW} order={{ status: 'PENDING', createdAt: new Date(NOW - 3 * 86400000).toISOString() }} />);
    expect(html).toContain('data-level="stale"');
    expect(html).toContain('recebido há 3 dias');
  });
  it('âmbar após 30 min; nada para pedido novo ou entregue', () => {
    expect(renderToStaticMarkup(<OrderAgeBadge now={NOW} order={{ status: 'PREPARING', createdAt: new Date(NOW - 40 * 60000).toISOString() }} />)).toContain('data-level="warn"');
    expect(renderToStaticMarkup(<OrderAgeBadge now={NOW} order={{ status: 'PENDING', createdAt: new Date(NOW - 60000).toISOString() }} />)).toBe('');
    expect(renderToStaticMarkup(<OrderAgeBadge now={NOW} order={{ status: 'DELIVERED', createdAt: new Date(NOW - 3 * 86400000).toISOString() }} />)).toBe('');
  });
});
