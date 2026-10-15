import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockRpc = vi.fn();
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
  },
  isSupabaseConfigured: true,
}));

import { driverLocationRepository } from '../../../repositories/driverLocationRepository';
import { DriverLocationConsentModal } from '../DriverLocationConsentModal';
import { DriverDeliveryMap } from '../DriverDeliveryMap';
import { resolveDriverTrackingDecision } from '../../../lib/useDriverLocationTracking';
import { isValidCoordinate, extractDestinationCoordinates } from '../../../lib/driverNavigation';
import { Tenant, Order } from '../../../types';

const mockTenant = {
  id: 'tenant-1',
  name: 'Adega Gourmet Prime',
  slug: 'adega-gourmet',
  settings: {
    address: 'Rua Augusta, 1500',
    city: 'São Paulo',
    phoneWhatsApp: '11999998888',
  },
} as unknown as Tenant;

const mockOrder = {
  id: 'order-1',
  tenantId: 'tenant-1',
  orderNumber: 1042,
  customerName: 'Carlos Silva',
  customerPhone: '11999998888',
  deliveryAddress: 'Rua Bela Cintra, 1100, Consolação',
  items: [],
  subtotal: 100,
  deliveryFee: 8.5,
  totalAmount: 108.5,
  status: 'OUT_FOR_DELIVERY',
  driverId: 'driver-1',
  createdAt: '2026-10-14T11:00:00Z',
  updatedAt: '2026-10-14T11:15:00Z',
} as unknown as Order;

describe('driverLocationRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upsertMyLocation chama a RPC upsert_my_location com parâmetros exatos da migration', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { updated: 1, throttled: false, low_accuracy: false },
      error: null,
    });

    const res = await driverLocationRepository.upsertMyLocation({
      lat: -23.5505,
      lng: -46.6333,
      accuracy: 15,
      heading: 180,
      speed: 12.5,
    });

    expect(mockRpc).toHaveBeenCalledWith('upsert_my_location', {
      p_lat: -23.5505,
      p_lng: -46.6333,
      p_accuracy: 15,
      p_heading: 180,
      p_speed: 12.5,
    });
    expect(res).toEqual({ updated: 1, throttled: false, low_accuracy: false });
  });

  it('listTenantDriverLocations chama list_tenant_driver_locations com p_tenant_id', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          driver_id: 'd1',
          full_name: 'Motoboy 1',
          status: 'ON_DELIVERY',
          active_order_id: 'order-1',
          lat: -23.55,
          lng: -46.63,
          accuracy_m: 20,
          heading: 90,
          speed: 15,
          recorded_at: '2026-10-15T03:00:00Z',
          is_stale: false,
          low_accuracy: false,
          location_visible: true,
        },
      ],
      error: null,
    });

    const list = await driverLocationRepository.listTenantDriverLocations('tenant-1');
    expect(mockRpc).toHaveBeenCalledWith('list_tenant_driver_locations', {
      p_tenant_id: 'tenant-1',
    });
    expect(list).toHaveLength(1);
    expect(list[0].driver_id).toBe('d1');
    expect(list[0].location_visible).toBe(true);
  });
});

describe('DriverLocationConsentModal (LGPD)', () => {
  it('renderiza os 3 pilares LGPD: para que serve, quando é transmitida e como parar', () => {
    const html = renderToStaticMarkup(
      <DriverLocationConsentModal
        isOpen={true}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(html).toContain('Compartilhamento de Localização');
    expect(html).toContain('Para que serve?');
    expect(html).toContain('Quando é transmitida?');
    expect(html).toContain('Como pausar ou parar?');
    expect(html).toContain('15 segundos');
    expect(html).toContain('60 segundos');
    expect(html).toContain('Concordar e Ativar');
    expect(html).toContain('Agora não');
  });

  it('não renderiza quando isOpen é false', () => {
    const html = renderToStaticMarkup(
      <DriverLocationConsentModal
        isOpen={false}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(html).toBe('');
  });
});

describe('DriverDeliveryMap (requisitos de transparência e ETA)', () => {
  it('exibe badge "ETA indisponível" sem inventar km ou minutos', () => {
    const html = renderToStaticMarkup(
      <DriverDeliveryMap
        tenant={mockTenant}
        order={mockOrder}
        driverCoords={{ lat: -23.55, lng: -46.63 }}
      />
    );

    expect(html).toContain('ETA indisponível');
    expect(html).not.toMatch(/\d+\s*(km|min)/i);
  });

  it('exibe o aviso sobre celular em segundo plano', () => {
    const html = renderToStaticMarkup(
      <DriverDeliveryMap
        tenant={mockTenant}
        order={mockOrder}
      />
    );

    expect(html).toContain('No celular, a transmissão de GPS pode parar');
    expect(html).toContain('segundo plano');
  });

  it('exibe estado informativo quando o pedido NÃO tem coordenadas de destino sem inventar localização', () => {
    const orderWithoutCoords = {
      ...mockOrder,
      addressDetails: undefined,
    } as unknown as Order;

    const html = renderToStaticMarkup(
      <DriverDeliveryMap
        tenant={mockTenant}
        order={orderWithoutCoords}
        driverCoords={{ lat: -23.55, lng: -46.63 }}
      />
    );

    expect(html).toContain('Destino sem coordenadas no mapa');
    expect(html).toContain('Use os botões abaixo para abrir a rota nos navegadores externos');
  });

  it('não exibe alerta de ausência de coordenadas quando o pedido tem coordenadas válidas', () => {
    const orderWithCoords = {
      ...mockOrder,
      addressDetails: { lat: -23.5512, lng: -46.6543 },
    } as unknown as Order;

    const html = renderToStaticMarkup(
      <DriverDeliveryMap
        tenant={mockTenant}
        order={orderWithCoords}
        driverCoords={{ lat: -23.55, lng: -46.63 }}
      />
    );

    expect(html).not.toContain('Destino sem coordenadas no mapa');
    expect(html).toContain('Google Maps');
    expect(html).toContain('Waze');
  });
});

describe('resolveDriverTrackingDecision (regras de rastreamento e privacidade)', () => {
  it('envia a cada 15s SOMENTE quando houver pedido efetivamente OUT_FOR_DELIVERY', () => {
    const res = resolveDriverTrackingDecision('ON_DELIVERY', true, 'ACCEPTED', false);
    expect(res).toEqual({ shouldTrack: true, intervalMs: 15000 });

    const resAvailable = resolveDriverTrackingDecision('AVAILABLE', true, 'ACCEPTED', false);
    expect(resAvailable).toEqual({ shouldTrack: true, intervalMs: 15000 });
  });

  it('status ON_DELIVERY isoladamente SEM pedido OUT_FOR_DELIVERY envia a cada 60s (não 15s)', () => {
    const res = resolveDriverTrackingDecision('ON_DELIVERY', false, 'ACCEPTED', false);
    expect(res).toEqual({ shouldTrack: true, intervalMs: 60000 });
  });

  it('entregador AVAILABLE sem pedido em rota envia a cada 60s', () => {
    const res = resolveDriverTrackingDecision('AVAILABLE', false, 'ACCEPTED', false);
    expect(res).toEqual({ shouldTrack: true, intervalMs: 60000 });
  });

  it('interrompe envio imediatamente quando UNAVAILABLE, SUSPENDED ou UNKNOWN', () => {
    expect(resolveDriverTrackingDecision('UNAVAILABLE', true, 'ACCEPTED', false)).toEqual({
      shouldTrack: false,
      intervalMs: 0,
    });
    expect(resolveDriverTrackingDecision('SUSPENDED', true, 'ACCEPTED', false)).toEqual({
      shouldTrack: false,
      intervalMs: 0,
    });
    expect(resolveDriverTrackingDecision('UNKNOWN', true, 'ACCEPTED', false)).toEqual({
      shouldTrack: false,
      intervalMs: 0,
    });
  });

  it('respeita consentimento explícito e pausa (LGPD): não envia sem aceite ou quando pausado', () => {
    expect(resolveDriverTrackingDecision('ON_DELIVERY', true, 'REJECTED', false)).toEqual({
      shouldTrack: false,
      intervalMs: 0,
    });
    expect(resolveDriverTrackingDecision('ON_DELIVERY', true, 'PROMPT', false)).toEqual({
      shouldTrack: false,
      intervalMs: 0,
    });
    expect(resolveDriverTrackingDecision('ON_DELIVERY', true, 'ACCEPTED', true)).toEqual({
      shouldTrack: false,
      intervalMs: 0,
    });
  });
});

describe('CORREÇÃO 1: recálculo dinâmico por atribuição e isolamento por loja', () => {
  const isOutForDeliveryForStore = (assignedOrders: Order[], activeTenantId: string): boolean => {
    return assignedOrders.some(
      (o) => o.status === 'OUT_FOR_DELIVERY' && (!o.tenantId || o.tenantId === activeTenantId)
    );
  };

  it('pedido aguardando retirada (PREPARING) mantém intervalo de presença em 60s', () => {
    const orders = [{ id: '1', tenantId: 'store-1', status: 'PREPARING' } as Order];
    const isEnRoute = isOutForDeliveryForStore(orders, 'store-1');
    expect(isEnRoute).toBe(false);

    const decision = resolveDriverTrackingDecision('AVAILABLE', isEnRoute, 'ACCEPTED', false);
    expect(decision).toEqual({ shouldTrack: true, intervalMs: 60000 });
  });

  it('quando o pedido avança para OUT_FOR_DELIVERY da loja ativa, recalcula imediatamente para 15s', () => {
    const orders = [{ id: '1', tenantId: 'store-1', status: 'OUT_FOR_DELIVERY' } as Order];
    const isEnRoute = isOutForDeliveryForStore(orders, 'store-1');
    expect(isEnRoute).toBe(true);

    const decision = resolveDriverTrackingDecision('ON_DELIVERY', isEnRoute, 'ACCEPTED', false);
    expect(decision).toEqual({ shouldTrack: true, intervalMs: 15000 });
  });

  it('pedido OUT_FOR_DELIVERY de OUTRA loja não dispara 15s na loja ativa (isolamento entre lojas)', () => {
    const orders = [{ id: '1', tenantId: 'store-2', status: 'OUT_FOR_DELIVERY' } as Order];
    const isEnRoute = isOutForDeliveryForStore(orders, 'store-1');
    expect(isEnRoute).toBe(false);

    const decision = resolveDriverTrackingDecision('AVAILABLE', isEnRoute, 'ACCEPTED', false);
    expect(decision).toEqual({ shouldTrack: true, intervalMs: 60000 });
  });

  it('quando a entrega é concluída (DELIVERED), recalcula imediatamente de volta para 60s', () => {
    const orders = [{ id: '1', tenantId: 'store-1', status: 'DELIVERED' } as Order];
    const isEnRoute = isOutForDeliveryForStore(orders, 'store-1');
    expect(isEnRoute).toBe(false);

    const decision = resolveDriverTrackingDecision('AVAILABLE', isEnRoute, 'ACCEPTED', false);
    expect(decision).toEqual({ shouldTrack: true, intervalMs: 60000 });
  });

  it('quando entregador fica UNAVAILABLE ou SUSPENDED, o rastreamento é pausado (0ms) mesmo que existam pedidos', () => {
    const orders = [{ id: '1', tenantId: 'store-1', status: 'OUT_FOR_DELIVERY' } as Order];
    const isEnRoute = isOutForDeliveryForStore(orders, 'store-1');
    expect(isEnRoute).toBe(true);

    const decisionUnavail = resolveDriverTrackingDecision('UNAVAILABLE', isEnRoute, 'ACCEPTED', false);
    expect(decisionUnavail).toEqual({ shouldTrack: false, intervalMs: 0 });

    const decisionSuspended = resolveDriverTrackingDecision('SUSPENDED', isEnRoute, 'ACCEPTED', false);
    expect(decisionSuspended).toEqual({ shouldTrack: false, intervalMs: 0 });
  });
});

describe('CORREÇÃO 2: validação estrita de coordenadas do destino e do entregador', () => {
  it('não aceita coordenadas fictícias (0, 0), nulas ou fora dos limites terrestres', () => {
    expect(isValidCoordinate(0, 0)).toBe(false);
    expect(isValidCoordinate(91, 10)).toBe(false);
    expect(isValidCoordinate(-91, 10)).toBe(false);
    expect(isValidCoordinate(10, 181)).toBe(false);
    expect(isValidCoordinate('abc', 'def')).toBe(false);
    expect(isValidCoordinate(NaN, -46.63)).toBe(false);
    expect(isValidCoordinate(-23.55, null)).toBe(false);

    const fakeOrder = { addressDetails: { lat: 0, lng: 0 } } as unknown as Order;
    expect(extractDestinationCoordinates(fakeOrder)).toBeNull();

    const orderWithoutCoords = { addressDetails: {} } as unknown as Order;
    expect(extractDestinationCoordinates(orderWithoutCoords)).toBeNull();
  });

  it('extrai coordenadas reais e válidas de latitude/longitude ou lat/lng', () => {
    const orderWithLatLng = { addressDetails: { lat: -23.5505, lng: -46.6333 } } as unknown as Order;
    expect(extractDestinationCoordinates(orderWithLatLng)).toEqual({ lat: -23.5505, lng: -46.6333 });

    const orderWithFullKeys = { addressDetails: { latitude: -22.9068, longitude: -43.1729 } } as unknown as Order;
    expect(extractDestinationCoordinates(orderWithFullKeys)).toEqual({ lat: -22.9068, lng: -43.1729 });
  });

  it('renderiza o mapa com Street Zoom e exibe posição atual do entregador sem dados inventados', () => {
    const html = renderToStaticMarkup(
      <DriverDeliveryMap
        tenant={mockTenant}
        order={mockOrder}
        driverCoords={{ lat: -23.5505, lng: -46.6333, accuracy: 12 }}
      />
    );

    // Contém indicador da posição real do motorista
    expect(html).toContain('Sua Posição: -23.5505, -46.6333');
    // Contém o aviso LGPD e de celular em segundo plano
    expect(html).toContain('No celular, a transmissão de GPS pode parar');
    // Não inventa distância nem tempo
    expect(html).toContain('ETA indisponível');
    expect(html).not.toMatch(/\d+\s*(km|minutos|min)\b/i);
    // Coleta e destino identificados com transparência
    expect(html).toContain('Coleta (Estabelecimento)');
    expect(html).toContain('Entrega (Destino)');
    expect(html).toContain('Painel de Rota');
  });
});
