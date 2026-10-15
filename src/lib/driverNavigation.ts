import { Order, Tenant } from '../types';

export interface RouteCoordinates {
  lat: number;
  lng: number;
}

export interface NavigationUrls {
  googleMaps: string;
  waze: string;
  embedMapUrl: string;
  originText: string;
  destinationText: string;
  hasCoordinates: boolean;
  coordinates?: RouteCoordinates;
}

/**
 * Validates whether latitude and longitude are valid numeric geographic coordinates.
 */
export function isValidCoordinate(lat?: unknown, lng?: unknown): lat is number {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  // Also guard against (0,0) null-island coordinates if unexpected
  if (lat === 0 && lng === 0) return false;
  return true;
}

export function hasValidCoordinates(lat?: unknown, lng?: unknown): lat is number {
  return isValidCoordinate(lat, lng);
}

/**
 * Extracts destination coordinates from an Order if present and valid.
 * Checks order.addressDetails (latitude, longitude, lat, lng).
 */
export function extractDestinationCoordinates(order: Order): RouteCoordinates | null {
  const details = order.addressDetails as (Record<string, unknown> | undefined);
  if (!details) return null;

  const rawLat = details.latitude ?? details.lat;
  const rawLng = details.longitude ?? details.lng;

  if (typeof rawLat === 'number' && typeof rawLng === 'number' && isValidCoordinate(rawLat, rawLng)) {
    return { lat: rawLat, lng: rawLng };
  }
  return null;
}

/**
 * Formats the establishment's textual address from activeTenant settings:
 * activeTenant.settings.address + activeTenant.settings.city
 */
export function formatOriginAddress(tenant: Tenant): string {
  const parts: string[] = [];
  const addr = tenant.settings?.address?.trim();
  const city = tenant.settings?.city?.trim();

  if (addr) parts.push(addr);
  if (city) parts.push(city);

  return parts.join(', ');
}

/**
 * Formats the customer delivery destination address from activeOrder.
 * Uses order.deliveryAddress, complementing with addressDetails when useful.
 */
export function formatDestinationAddress(order: Order): string {
  if (order.deliveryAddress && order.deliveryAddress.trim().length > 0) {
    return order.deliveryAddress.trim();
  }

  const d = order.addressDetails;
  if (d) {
    const parts: string[] = [];
    if (d.street) {
      parts.push(d.number ? `${d.street}, ${d.number}` : d.street);
    }
    if (d.complement) parts.push(d.complement);
    if (d.neighborhood) parts.push(d.neighborhood);
    if (d.city) {
      parts.push(d.state ? `${d.city} - ${d.state}` : d.city);
    }
    if (d.cep) parts.push(`CEP ${d.cep}`);
    if (parts.length > 0) return parts.join(', ');
  }

  return '';
}

/**
 * Builds external navigation URLs for Google Maps and Waze, plus an embedded Google Maps iframe URL.
 * Strictly uses coordinates when valid, otherwise safely falls back to encoded text addresses.
 * Does NOT invent coordinates, modify databases, or introduce unnecessary dependencies.
 */
export function buildDriverNavigation(tenant: Tenant, order: Order, apiKey?: string): NavigationUrls {
  const coords = extractDestinationCoordinates(order);
  const originText = formatOriginAddress(tenant);
  const destinationText = formatDestinationAddress(order);

  const hasCoords = !!coords;
  const destinationQuery = hasCoords && coords
    ? `${coords.lat},${coords.lng}`
    : destinationText;

  // Google Maps Direction URL:
  // If origin is present, directs from origin to destination.
  // Otherwise searches/navigates directly to destination.
  // Google Maps directions mode (origin omitted => driver's current location).
  let googleMapsUrl = '';
  if (destinationQuery) {
    googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationQuery)}&travelmode=driving`;
  }

  // Waze Navigation URL:
  // If coordinates are present, waze accepts ll=lat,lng&navigate=yes
  // If only text is available, accepts q=destinationQuery&navigate=yes
  let wazeUrl = '';
  if (hasCoords && coords) {
    wazeUrl = `https://waze.com/ul?ll=${coords.lat},${coords.lng}&navigate=yes`;
  } else if (destinationQuery) {
    wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(destinationQuery)}&navigate=yes`;
  }

  // Embedded Map URL:
  // Only generated when an official Google Maps API key is configured and valid.
  // Without a valid API key, embedMapUrl remains empty ('') and the UI shows the alternative panel.
  let embedMapUrl = '';
  const key = apiKey?.trim();

  if (key && key.length > 10) {
    if (originText && destinationQuery) {
      embedMapUrl = `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(key)}&origin=${encodeURIComponent(originText)}&destination=${encodeURIComponent(destinationQuery)}&mode=driving`;
    } else if (destinationQuery) {
      embedMapUrl = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(destinationQuery)}`;
    }
  }

  return {
    googleMaps: googleMapsUrl,
    waze: wazeUrl,
    embedMapUrl,
    originText,
    destinationText,
    hasCoordinates: hasCoords,
    coordinates: coords || undefined,
  };
}
