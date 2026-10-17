import { describe, it, expect } from 'vitest';
import { buildCustomerTimeline } from '../customerTracking';

const T0 = '2026-10-17T10:00:00Z';
const at = (min: number) => new Date(Date.parse(T0) + min * 60000).toISOString();
const h = (status: string, min: number) => ({ status, timestamp: at(min), changedBy: '' });
const mk = (status: string, history: any[] = [], fulfillmentType: 'DELIVERY' | 'PICKUP' = 'DELIVERY') =>
  ({ status, fulfillmentType, createdAt: T0, statusHistory: history } as any);
const states = (tl: ReturnType<typeof buildCustomerTimeline>) => tl.steps.map(s => `${s.key}:${s.state}`);

describe('buildCustomerTimeline — entrega', () => {
  it('mostra todas as etapas pedidas pelo David', () => {
    const tl = buildCustomerTimeline(mk('PENDING', [h('PENDING', 0)]));
    expect(tl.steps.map(s => s.label)).toEqual([
      'Pedido recebido',
      'Loja aceitou',
      'Em preparo',
      'Pronto',
      'Motoboy aceitou',
      'Motoboy indo retirar',
      'A caminho de você (saiu para entrega)',
      'Entregue',
    ]);
    expect(states(tl).slice(0, 2)).toEqual(['received:done', 'store_accepted:current']);
    expect(tl.headline).toMatch(/aguardando a loja/);
  });

  it('loja aceitou → em preparo em andamento, com horários do histórico', () => {
    const tl = buildCustomerTimeline(mk('CONFIRMED', [h('PENDING', 0), h('CONFIRMED', 2)]));
    expect(tl.steps[1]).toMatchObject({ key: 'store_accepted', state: 'done', at: at(2) });
    expect(tl.current?.key).toBe('preparing');
    expect(tl.headline).toBe('Loja aceitou seu pedido');
  });

  it('loja pulou CONFIRMED (PENDING → PREPARING): "Loja aceitou" conclui no mesmo horário', () => {
    const tl = buildCustomerTimeline(mk('PREPARING', [h('PENDING', 0), h('PREPARING', 3)]));
    expect(tl.steps[1]).toMatchObject({ state: 'done', at: at(3) });
    expect(tl.steps[2]).toMatchObject({ key: 'preparing', state: 'done', at: at(3) });
    expect(tl.current?.key).toBe('ready');
  });

  it('chamando motoboy (WAITING_FOR_DRIVER sem aceite)', () => {
    const tl = buildCustomerTimeline(mk('WAITING_FOR_DRIVER', [h('PENDING', 0), h('PREPARING', 1), h('READY', 10), h('WAITING_FOR_DRIVER', 11)]));
    expect(tl.steps[3]).toMatchObject({ key: 'ready', state: 'done', label: 'Pronto • chamando motoboy' });
    expect(tl.current?.key).toBe('driver_accepted');
    expect(tl.headline).toBe('Procurando motoboy');
  });

  it('fluxo atual: despacho leva direto a OUT_FOR_DELIVERY → a caminho de você', () => {
    const tl = buildCustomerTimeline(mk('OUT_FOR_DELIVERY', [h('PENDING', 0), h('CONFIRMED', 1), h('PREPARING', 2), h('READY', 10), h('OUT_FOR_DELIVERY', 12)]));
    expect(states(tl)).toEqual([
      'received:done', 'store_accepted:done', 'preparing:done', 'ready:done',
      'driver_accepted:done', 'driver_to_store:done', 'out_for_delivery:current', 'delivered:pending',
    ]);
    expect(tl.steps[4].at).toBe(at(12));
    expect(tl.headline).toBe('Motoboy a caminho de você');
  });

  it('proposta: DRIVER_ACCEPTED com pedido em WAITING_FOR_DRIVER → indo retirar em andamento', () => {
    const tl = buildCustomerTimeline(mk('WAITING_FOR_DRIVER', [h('PENDING', 0), h('READY', 5), h('WAITING_FOR_DRIVER', 6), h('DRIVER_ACCEPTED', 7)]));
    expect(tl.steps[4]).toMatchObject({ key: 'driver_accepted', state: 'done', at: at(7) });
    expect(tl.current?.key).toBe('driver_to_store');
    expect(tl.headline).toBe('Motoboy a caminho da loja');
  });

  it('proposta: DRIVER_ASSIGNED (dono escolheu o motoboy) equivale ao aceite', () => {
    const tl = buildCustomerTimeline(mk('WAITING_FOR_DRIVER', [h('READY', 5), h('DRIVER_ASSIGNED', 7)]));
    expect(tl.steps[4].state).toBe('done');
    expect(tl.current?.key).toBe('driver_to_store');
  });

  it('proposta: DRIVER_RELEASED desfaz o aceite', () => {
    const tl = buildCustomerTimeline(mk('WAITING_FOR_DRIVER', [h('READY', 5), h('WAITING_FOR_DRIVER', 6), h('DRIVER_ACCEPTED', 7), h('DRIVER_RELEASED', 9)]));
    expect(tl.steps[4].state).toBe('current');
    expect(tl.current?.key).toBe('driver_accepted');
  });

  it('desatribuição atual (OUT_FOR_DELIVERY → READY) volta a "aguardando motoboy"', () => {
    const tl = buildCustomerTimeline(mk('READY', [h('READY', 5), h('OUT_FOR_DELIVERY', 6), h('READY', 8)]));
    expect(tl.steps[4].state).toBe('current');
    expect(tl.steps[6].state).toBe('pending');
  });

  it('entregue: todas concluídas, nenhuma em andamento', () => {
    const tl = buildCustomerTimeline(mk('DELIVERED', [h('PENDING', 0), h('OUT_FOR_DELIVERY', 12), h('DELIVERED', 30)]));
    expect(tl.steps.every(s => s.state === 'done')).toBe(true);
    expect(tl.steps[7].at).toBe(at(30));
    expect(tl.current).toBeUndefined();
    expect(tl.headline).toBe('Pedido entregue');
  });

  it('sem histórico (falha de leitura) usa só orders.status', () => {
    const tl = buildCustomerTimeline(mk('PREPARING'));
    expect(tl.steps[2].state).toBe('done');
    expect(tl.steps[2].at).toBeUndefined();
    expect(tl.current?.key).toBe('ready');
  });

  it('cancelado', () => {
    const tl = buildCustomerTimeline(mk('CANCELLED', [h('PENDING', 0), h('CONFIRMED', 1), h('CANCELLED', 4)]));
    expect(tl.cancelled).toBe(true);
    expect(tl.cancelledAt).toBe(at(4));
    expect(tl.current).toBeUndefined();
    expect(tl.headline).toBe('Pedido cancelado');
  });
});

describe('buildCustomerTimeline — retirada no balcão', () => {
  it('sem etapas de motoboy', () => {
    const tl = buildCustomerTimeline(mk('READY', [h('PENDING', 0), h('READY', 9)], 'PICKUP'));
    expect(tl.steps.map(s => s.key)).toEqual(['received', 'store_accepted', 'preparing', 'ready', 'delivered']);
    expect(tl.current?.key).toBe('delivered');
    expect(tl.headline).toBe('Pronto para retirada');
  });
});
