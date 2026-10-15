import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { RpcBusinessError } from '../lib/rpcErrors';

export interface DriverLocationUpsertResult {
  updated: number;
  throttled: boolean;
  low_accuracy: boolean;
}

export interface TenantDriverLocation {
  driver_id: string;
  full_name: string;
  status: string;
  active_order_id: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  heading: number | null;
  speed: number | null;
  recorded_at: string | null;
  is_stale: boolean | null;
  low_accuracy: boolean | null;
  location_visible: boolean;
}

export interface MyDriverLocation {
  driver_id: string;
  tenant_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  recorded_at: string;
  is_stale: boolean;
}

export const driverLocationRepository = {
  /**
   * Envia a posição do motorista logado via RPC upsert_my_location.
   * Parâmetros mapeados estritamente conforme a migration 20261015001200:
   * p_lat, p_lng, p_accuracy, p_heading, p_speed.
   */
  async upsertMyLocation(coords: {
    lat: number;
    lng: number;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  }): Promise<DriverLocationUpsertResult | null> {
    if (!isSupabaseConfigured) {
      return { updated: 1, throttled: false, low_accuracy: false };
    }

    try {
      const { data, error } = await supabase.rpc('upsert_my_location', {
        p_lat: coords.lat,
        p_lng: coords.lng,
        p_accuracy: coords.accuracy ?? null,
        p_heading: coords.heading ?? null,
        p_speed: coords.speed ?? null,
      });

      if (error) {
        // Tratar erros previsíveis da migration sem quebrar a UI
        console.warn('[driverLocationRepository] upsert_my_location aviso:', error.message || error);
        return null;
      }

      return data as DriverLocationUpsertResult;
    } catch (err: any) {
      console.warn('[driverLocationRepository] Exceção em upsert_my_location:', err?.message || err);
      return null;
    }
  },

  /**
   * Lista localizações dos entregadores para o proprietário/gerente da loja via RPC list_tenant_driver_locations.
   * Retorna os entregadores com flag location_visible e coordenadas (quando autorizadas).
   */
  async listTenantDriverLocations(tenantId: string): Promise<TenantDriverLocation[]> {
    if (!isSupabaseConfigured || !tenantId) {
      return [];
    }

    try {
      const { data, error } = await supabase.rpc('list_tenant_driver_locations', {
        p_tenant_id: tenantId,
      });

      if (error) {
        console.warn('[driverLocationRepository] list_tenant_driver_locations erro:', error.message || error);
        return [];
      }

      return (data || []) as TenantDriverLocation[];
    } catch (err: any) {
      console.warn('[driverLocationRepository] Exceção em list_tenant_driver_locations:', err?.message || err);
      return [];
    }
  },

  /**
   * Consulta a última posição gravada do motorista logado via get_my_location.
   */
  async getMyLocation(): Promise<MyDriverLocation | null> {
    if (!isSupabaseConfigured) {
      return null;
    }

    try {
      const { data, error } = await supabase.rpc('get_my_location');
      if (error || !data || data.length === 0) {
        return null;
      }
      return data[0] as MyDriverLocation;
    } catch (err) {
      return null;
    }
  },
};
