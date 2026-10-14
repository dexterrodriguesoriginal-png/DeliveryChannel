import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import {
  isValidCoordinate,
  extractDestinationCoordinates,
  formatOriginAddress,
  formatDestinationAddress,
  buildDriverNavigation,
} from '../driverNavigation';
import { DriverDeliveryMap } from '../../components/driver/DriverDeliveryMap';
import { Order, Tenant } from '../../types';

describe('driverNavigation logic and address extraction', () => {
  const mockTenant = {
    id: 'tenant-123',
    slug: 'adega-prime',
    name: 'Adega Gourmet Prime',
    settings: {
      address: 'Rua Augusta, 1500',
      city: 'São Paulo',
      phoneWhatsApp: '11999998888',
    },
  } as unknown as Tenant;

  const baseOrder: Order = {
    id: 'order-1',
    tenantId: 'tenant-123',
    orderNumber: 1001,
    customerName: 'Carlos Silva',
    customerPhone: '11988887777',
    status: 'OUT_FOR_DELIVERY',
    deliveryAddress: 'Rua Bela Cintra, 1100 - Apto 82, Consolação',
    items: [],
    subtotal: 100,
    deliveryFee: 10,
    discount: 0,
    totalAmount: 110,
    paymentMethod: 'PIX',
    paymentStatus: 'PAID',
    fulfillmentType: 'DELIVERY',
    origin: 'marketplace',
    statusHistory: [],
    createdAt: '2026-10-14T10:00:00Z',
    updatedAt: '2026-10-14T10:00:00Z',
  };

  describe('isValidCoordinate', () => {
    it('returns true for valid finite latitude and longitude within ranges', () => {
      expect(isValidCoordinate(-23.5505, -46.6333)).toBe(true);
      expect(isValidCoordinate(0.5, -45.0)).toBe(true);
    });

    it('returns false for null, undefined, strings, NaN, Infinity, and null island (0,0)', () => {
      expect(isValidCoordinate(undefined, undefined)).toBe(false);
      expect(isValidCoordinate(null, null)).toBe(false);
      expect(isValidCoordinate(0, 0)).toBe(false);
      expect(isValidCoordinate(-91, 50)).toBe(false);
      expect(isValidCoordinate(20, 185)).toBe(false);
      expect(isValidCoordinate(NaN, -46)).toBe(false);
      expect(isValidCoordinate(Infinity, -46)).toBe(false);
    });
  });

  describe('extractDestinationCoordinates', () => {
    it('returns null when order has no coordinates in addressDetails', () => {
      const order = { ...baseOrder };
      expect(extractDestinationCoordinates(order)).toBeNull();
    });

    it('extracts latitude and longitude when present in addressDetails', () => {
      const orderWithCoords: Order = {
        ...baseOrder,
        addressDetails: {
          street: 'Rua Bela Cintra',
          number: '1100',
          latitude: -23.5589,
          longitude: -46.6612,
        } as any,
      };
      expect(extractDestinationCoordinates(orderWithCoords)).toEqual({
        lat: -23.5589,
        lng: -46.6612,
      });
    });

    it('extracts lat and lng short-form if used', () => {
      const orderWithShortCoords: Order = {
        ...baseOrder,
        addressDetails: {
          lat: -23.5589,
          lng: -46.6612,
        } as any,
      };
      expect(extractDestinationCoordinates(orderWithShortCoords)).toEqual({
        lat: -23.5589,
        lng: -46.6612,
      });
    });
  });

  describe('formatOriginAddress & formatDestinationAddress', () => {
    it('formats origin address from activeTenant.settings.address + activeTenant.settings.city', () => {
      expect(formatOriginAddress(mockTenant)).toBe('Rua Augusta, 1500, São Paulo');
    });

    it('handles tenant without city gracefully', () => {
      const t = { ...mockTenant, settings: { ...mockTenant.settings, city: '' } };
      expect(formatOriginAddress(t)).toBe('Rua Augusta, 1500');
    });

    it('formats destination address prioritizing textual deliveryAddress', () => {
      expect(formatDestinationAddress(baseOrder)).toBe('Rua Bela Cintra, 1100 - Apto 82, Consolação');
    });

    it('reconstructs destination address from addressDetails if deliveryAddress is blank', () => {
      const orderWithoutStr: Order = {
        ...baseOrder,
        deliveryAddress: '',
        addressDetails: {
          street: 'Av Paulista',
          number: '2000',
          neighborhood: 'Bela Vista',
          city: 'São Paulo',
          state: 'SP',
          cep: '01310-200',
        },
      };
      expect(formatDestinationAddress(orderWithoutStr)).toBe(
        'Av Paulista, 2000, Bela Vista, São Paulo - SP, CEP 01310-200'
      );
    });
  });

  describe('buildDriverNavigation navigation URLs', () => {
    it('creates Google Maps and Waze URLs using text when no coordinates are present', () => {
      const nav = buildDriverNavigation(mockTenant, baseOrder);

      expect(nav.hasCoordinates).toBe(false);
      expect(nav.originText).toBe('Rua Augusta, 1500, São Paulo');
      expect(nav.destinationText).toBe('Rua Bela Cintra, 1100 - Apto 82, Consolação');

      // Google Maps with origin & destination
      expect(nav.googleMaps).toContain('https://www.google.com/maps/dir/?api=1');
      expect(nav.googleMaps).toContain(encodeURIComponent('Rua Augusta, 1500, São Paulo'));
      expect(nav.googleMaps).toContain(encodeURIComponent('Rua Bela Cintra, 1100 - Apto 82, Consolação'));

      // Waze with destination query
      expect(nav.waze).toContain('https://waze.com/ul?q=');
      expect(nav.waze).toContain(encodeURIComponent('Rua Bela Cintra, 1100 - Apto 82, Consolação'));
      expect(nav.waze).toContain('navigate=yes');

      // Without an API key, embedMapUrl must be empty string (no unofficial fallback URL)
      expect(nav.embedMapUrl).toBe('');
    });

    it('uses coordinates when valid coordinates exist in order', () => {
      const orderWithCoords: Order = {
        ...baseOrder,
        addressDetails: {
          latitude: -23.5589,
          longitude: -46.6612,
        } as any,
      };

      const nav = buildDriverNavigation(mockTenant, orderWithCoords);
      expect(nav.hasCoordinates).toBe(true);
      expect(nav.coordinates).toEqual({ lat: -23.5589, lng: -46.6612 });

      // Destination in Google Maps is coordinates
      expect(nav.googleMaps).toContain(encodeURIComponent('-23.5589,-46.6612'));

      // Waze uses ll=lat,lng
      expect(nav.waze).toBe('https://waze.com/ul?ll=-23.5589,-46.6612&navigate=yes');
    });

    it('builds official Google Maps Embed API url when API key is provided', () => {
      const nav = buildDriverNavigation(mockTenant, baseOrder, 'AIzaSyFakeKeyForTesting123456');
      expect(nav.embedMapUrl).toContain('https://www.google.com/maps/embed/v1/directions');
      expect(nav.embedMapUrl).toContain('key=AIzaSyFakeKeyForTesting123456');
      expect(nav.embedMapUrl).toContain(encodeURIComponent('Rua Augusta, 1500, São Paulo'));
      expect(nav.embedMapUrl).toContain(encodeURIComponent('Rua Bela Cintra, 1100 - Apto 82, Consolação'));
    });
  });

  describe('DriverDeliveryMap component alternative state', () => {
    it('renders alternative route panel without unofficial embed when no API key is set', () => {
      const html = renderToStaticMarkup(
        React.createElement(DriverDeliveryMap, {
          tenant: mockTenant,
          order: baseOrder,
          apiKey: '',
        })
      );

      // Verifies no unofficial maps.google.com embed URL or iframe is rendered
      expect(html).not.toContain('output=embed');
      expect(html).not.toContain('<iframe');

      // Verifies alternative panel contents: collection and destination
      expect(html).toContain('Painel de Rota');
      expect(html).toContain('Coleta (Estabelecimento)');
      expect(html).toContain('Adega Gourmet Prime');
      expect(html).toContain('Rua Augusta, 1500, São Paulo');
      expect(html).toContain('Entrega (Destino)');
      expect(html).toContain('Rua Bela Cintra, 1100 - Apto 82, Consolação');

      // Verifies external navigation buttons for Google Maps and Waze are present
      expect(html).toContain('Google Maps');
      expect(html).toContain('Waze');
    });

    it('renders official Google Maps embed iframe when a valid API key is configured', () => {
      const html = renderToStaticMarkup(
        React.createElement(DriverDeliveryMap, {
          tenant: mockTenant,
          order: baseOrder,
          apiKey: 'AIzaSyFakeKeyForTesting123456',
        })
      );

      // Renders official Google Maps directions embed iframe
      expect(html).toContain('<iframe');
      expect(html).toContain('https://www.google.com/maps/embed/v1/directions');
      expect(html).not.toContain('output=embed');
    });
  });
});
