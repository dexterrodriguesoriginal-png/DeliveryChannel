import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, from, calls } = vi.hoisted(() => {
  const state = { tables: {} as Record<string, any[]> };
  const calls: Array<{ table: string; field: string; value: unknown }> = [];
  const from = vi.fn((table: string) => {
    const query: any = {
      select: () => query,
      eq: (field: string, value: unknown) => { calls.push({ table, field, value }); return query; },
      in: (_field: string, _value: unknown) => query,
      then: (resolve: any) => Promise.resolve({ data: state.tables[table] || [], error: null }).then(resolve),
    };
    return query;
  });
  return { state, from, calls };
});
vi.mock('../../lib/supabase', () => ({ supabase: { from } }));
import { dispatchChatRepository, type OwnerNotification } from '../dispatchChatRepository';
import { notificationType } from '../../lib/notifications/notificationView';

const event = (id: string, kind: OwnerNotification['kind'], ref_id: string, tenant_id = 'A'): OwnerNotification =>
  ({ id, tenant_id, kind, ref_id, title: 'Pedir mais: Balcão 5', read_at: null, created_at: '2026-11-03T23:00:00Z' });

beforeEach(() => { state.tables = {}; calls.length = 0; from.mockClear(); });

describe('avisos de reabertura de comanda', () => {
  it('resolve a mesa por comanda autorizada sem tratar o ref_id como pedido', async () => {
    state.tables.dining_tabs = [{ id: 'tab-a', tenant_id: 'A', table_id: 'table-a' }];
    const visible = await dispatchChatRepository.visibleNotifications('A', [event('n1', 'TAB_REOPENED', 'tab-a')]);
    expect(visible).toEqual([expect.objectContaining({ id: 'n1', tableTarget: 'table-a' })]);
    expect(from).toHaveBeenCalledWith('dining_tabs');
    expect(from).not.toHaveBeenCalledWith('orders');
    expect(calls).toContainEqual({ table: 'dining_tabs', field: 'tenant_id', value: 'A' });
    expect(notificationType(visible[0])).toBe('table');
  });
  it('recusa eventos, referências e destinos de outra loja, inclusive em dados realtime forjados', async () => {
    state.tables.dining_tabs = [{ id: 'tab-other', tenant_id: 'B', table_id: 'table-other' }];
    const rows = [
      event('n1', 'TAB_REOPENED', 'tab-other'),
      event('n2', 'TAB_REOPENED', 'tab-a', 'B'),
      event('n3', 'DRIVER_JOIN_REQUEST', 'driver-b', 'B'),
      { ...event('n4', 'TAB_REOPENED', 'missing'), tableTarget: 'forged-table' },
    ];
    expect(await dispatchChatRepository.visibleNotifications('A', rows)).toEqual([]);
  });
  it('mantém pedidos pagos e solicitações de entregador junto do aviso de reabertura', async () => {
    state.tables.orders = [{ id: 'paid', tenant_id: 'A', awaiting_online_payment: false }, { id: 'unpaid', tenant_id: 'A', awaiting_online_payment: true }];
    state.tables.dining_tabs = [{ id: 'tab-a', tenant_id: 'A', table_id: 'table-a' }];
    const rows = [event('n1', 'TAB_REOPENED', 'tab-a'), event('n2', 'ORDER_NEW', 'paid'), event('n3', 'ORDER_NEW', 'unpaid'), event('n4', 'DRIVER_JOIN_REQUEST', 'driver')];
    expect((await dispatchChatRepository.visibleNotifications('A', rows)).map(row => row.id)).toEqual(['n1', 'n2', 'n4']);
  });
});

it('disputa referencia apenas pedido visível da loja e ignora destino de mesa forjado',async()=>{
  state.tables.orders=[{id:'own',tenant_id:'A',awaiting_online_payment:false},{id:'other',tenant_id:'B',awaiting_online_payment:false}];
  const rows=[{...event('n1','ORDER_DELIVERY_DISPUTE','own'),tableTarget:'forged'},event('n2','ORDER_DELIVERY_DISPUTE','other'),event('n3','ORDER_DELIVERY_DISPUTE','own','B')];
  expect(await dispatchChatRepository.visibleNotifications('A',rows)).toEqual([expect.objectContaining({id:'n1',ref_id:'own'})]);
  expect((await dispatchChatRepository.visibleNotifications('A',rows))[0].tableTarget).toBeUndefined();
});

