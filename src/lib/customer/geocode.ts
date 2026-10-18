/** Geolocalização + geocodificação reversa (Google Geocoder quando disponível; senão OpenStreetMap Nominatim). */
export interface GeoPoint { lat: number; lng: number }

export interface ReverseAddress {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  formattedAddress: string;
  placeId?: string;
}

/** Centro padrão quando nada é conhecido: Carapicuíba/SP (bairro de lançamento). */
export const DEFAULT_CENTER: GeoPoint = { lat: -23.5235, lng: -46.8407 };

const UF: Record<string, string> = {
  'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM', 'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', 'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG',
  'para': 'PA', 'paraiba': 'PB', 'parana': 'PR', 'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
  'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO',
};
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function ufFrom(stateName: string | undefined, iso?: string): string {
  if (iso && /^BR-[A-Z]{2}$/.test(iso)) return iso.slice(3);
  if (!stateName) return '';
  if (/^[A-Z]{2}$/.test(stateName)) return stateName;
  return UF[fold(stateName)] || stateName;
}

/** Resposta do Nominatim /reverse → endereço. */
export function parseNominatimReverse(d: any): ReverseAddress | null {
  if (!d || typeof d !== 'object' || !d.address) return null;
  const a = d.address;
  return {
    street: a.road || a.pedestrian || a.footway || a.residential || '',
    number: a.house_number || '',
    neighborhood: a.suburb || a.neighbourhood || a.quarter || a.city_district || '',
    city: a.city || a.town || a.municipality || a.village || '',
    state: ufFrom(a.state, a['ISO3166-2-lvl4']),
    postalCode: a.postcode || '',
    formattedAddress: d.display_name || '',
  };
}

/** Resultado do google.maps.Geocoder → endereço. */
export function parseGoogleGeocode(r: any): ReverseAddress | null {
  if (!r || !Array.isArray(r.address_components)) return null;
  const out: ReverseAddress = { street: '', number: '', neighborhood: '', city: '', state: '', postalCode: '', formattedAddress: r.formatted_address || '', placeId: r.place_id };
  for (const c of r.address_components) {
    const t: string[] = c.types || [];
    if (t.includes('route')) out.street = c.long_name;
    else if (t.includes('street_number')) out.number = c.long_name;
    else if (t.includes('sublocality') || t.includes('sublocality_level_1') || t.includes('neighborhood')) out.neighborhood = out.neighborhood || c.long_name;
    else if (t.includes('administrative_area_level_2') || t.includes('locality')) out.city = t.includes('administrative_area_level_2') || !out.city ? c.long_name : out.city;
    else if (t.includes('administrative_area_level_1')) out.state = c.short_name;
    else if (t.includes('postal_code')) out.postalCode = c.long_name;
  }
  return out;
}

export async function reverseGeocode(p: GeoPoint, timeoutMs = 7000): Promise<ReverseAddress | null> {
  const g = (typeof window !== 'undefined' ? (window as any).google : undefined)?.maps;
  if (g?.Geocoder && !(window as any).__dcGeocoderBlocked) {
    try {
      const res: any = await Promise.race([
        new g.Geocoder().geocode({ location: p, language: 'pt-BR', region: 'BR' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
      ]);
      const parsed = parseGoogleGeocode(res?.results?.[0]);
      if (parsed && parsed.street) return parsed;
    } catch {
      (window as any).__dcGeocoderBlocked = true; // Geocoding API não liberada para a chave: usa OSM daqui em diante
    }
  }
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ctrl?.abort(), timeoutMs);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${p.lat}&lon=${p.lng}&addressdetails=1&zoom=18`, {
      headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
      signal: ctrl?.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return parseNominatimReverse(await r.json());
  } catch {
    return null;
  }
}

export type GeoErrorKind = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export function getCurrentPosition(timeoutMs = 10000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(Object.assign(new Error('Seu aparelho não permite localização.'), { kind: 'unsupported' as GeoErrorKind }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => {
        const kind: GeoErrorKind = err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable';
        const msg = kind === 'denied'
          ? 'Permita o acesso à localização nas configurações do navegador para usar esta opção.'
          : kind === 'timeout' ? 'Não conseguimos achar sua localização a tempo. Tente de novo ou digite o endereço.'
          : 'Localização indisponível no momento. Digite o endereço.';
        reject(Object.assign(new Error(msg), { kind }));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}
