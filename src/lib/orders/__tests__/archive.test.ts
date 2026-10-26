import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompactOrderCard } from '../../../components/establishment/CompactOrderCard';
import { canArchiveOrder, matchesOrderStatusTab } from '../archive';
import { mapStaffOrderRow } from '../../../repositories/orderMappers';
import type { OrderStatus } from '../../../types';

const statuses: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'WAITING_FOR_DRIVER', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

describe('arquivamento na tela Pedidos', () => {
  it('Todos exclui cancelados; cada pedido continua na aba do seu status', () => {
    for (const status of statuses) {
      const order = { status };
      expect(matchesOrderStatusTab(order, 'ALL')).toBe(status !== 'CANCELLED');
      expect(matchesOrderStatusTab(order, status === 'WAITING_FOR_DRIVER' ? 'READY' : status)).toBe(true);
      expect(matchesOrderStatusTab(order, 'ARCHIVED')).toBe(false);
    }
  });

  it('arquivados aparecem somente em Arquivados, inclusive nos contadores', () => {
    for (const status of ['DELIVERED', 'CANCELLED'] as const) {
      const order = { status, archivedAt: '2026-10-26T12:00:00Z' };
      expect(matchesOrderStatusTab(order, 'ARCHIVED')).toBe(true);
      for (const tab of ['ALL', ...statuses]) expect(matchesOrderStatusTab(order, tab)).toBe(false);
      const restored = { ...order, archivedAt: undefined };
      expect(matchesOrderStatusTab(restored, status)).toBe(true);
      expect(matchesOrderStatusTab(restored, 'ARCHIVED')).toBe(false);
    }
  });

  it('somente cancelados e entregues permitem arquivar', () => {
    for (const status of statuses) expect(canArchiveOrder({ status })).toBe(['CANCELLED', 'DELIVERED'].includes(status));
  });

  it('mapeia a persistência sem mudar valores financeiros nem o status', () => {
    const row = { id: 'o1', status: 'DELIVERED', total_amount: 42, archived_at: '2026-10-26T12:00:00Z', archived_by: 'owner' };
    const order = mapStaffOrderRow(row);
    expect(order).toMatchObject({ id: 'o1', status: 'DELIVERED', totalAmount: 42, archivedAt: row.archived_at, archivedBy: 'owner' });
    expect(mapStaffOrderRow({ ...row, archived_at: null, archived_by: null }).archivedAt).toBeUndefined();
  });
});

describe('ação de arquivar no card', () => {
  const render = (status: OrderStatus, archivedAt?: string, allowed = true, busy = false) => renderToStaticMarkup(createElement(CompactOrderCard, {
    order: { id: 'o1', orderNumber: 1, status, archivedAt, createdAt: '2026-10-26T12:00:00Z', totalAmount: 10, items: [], statusHistory: [], fulfillmentType: 'DELIVERY' } as any,
    density: 'normal', onSelectOrder: () => {}, onUpdateStatus: async () => {}, onAssignDriverClick: () => {},
    onArchiveClick: allowed ? () => {} : undefined, archiveBusy: busy,
  }));
  it('oferece Arquivar e Desarquivar apenas para encerrados e papel autorizado', () => {
    expect(render('CANCELLED')).toContain('>Arquivar</button>');
    expect(render('DELIVERED')).toContain('>Arquivar</button>');
    expect(render('CANCELLED', '2026-10-26T12:00:00Z')).toContain('>Desarquivar</button>');
    expect(render('PREPARING')).not.toContain('>Arquivar</button>');
    expect(render('CANCELLED', undefined, false)).not.toContain('>Arquivar</button>');
    expect(render('CANCELLED', undefined, true, true)).toMatch(/disabled=""[^>]*>Arquivar<\/button>/);
  });
});
