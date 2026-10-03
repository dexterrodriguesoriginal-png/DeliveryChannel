import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Driver, DriverStatus } from '../types';
import { SecurityContext } from '../services/securityEngine';
import { teamRepository } from './teamRepository';
import { dataStore } from '../services/dataStore';
import { isValidUuid } from '../lib/uuid';

function mapRowToDriver(row: any, completedToday = 0): Driver {
  const isOnline = row.status === 'AVAILABLE' || row.status === 'ON_DELIVERY';
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    name: row.full_name,
    phone: row.phone,
    document: row.document || undefined,
    vehicle: row.vehicle_model ? `${row.vehicle_model} (${row.vehicle_type || 'MOTO'})` : (row.vehicle_type || 'MOTO'),
    vehicleType: row.vehicle_type || 'MOTO',
    vehicleModel: row.vehicle_model || '',
    plate: row.vehicle_plate || 'PLACA N/D',
    status: (row.status as DriverStatus) || 'AVAILABLE',
    isOnline,
    completedDeliveriesToday: completedToday,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const driverRepository = {
  /**
   * Lista os motoristas cadastrados no tenant (public.drivers)
   */
  async listDrivers(context: SecurityContext, tenantId: string): Promise<Driver[]> {
    if (isSupabaseConfigured && isValidUuid(tenantId)) {
      try {
        const { data, error } = await supabase
          .from('drivers')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('full_name', { ascending: true });

        if (error) {
          console.warn('[driverRepository] Erro ao listar motoristas do Supabase:', error);
          return dataStore.getDrivers(context, tenantId);
        }

        if (data) {
          // Contagem de entregas hoje por motorista
          const todayStr = new Date().toISOString().split('T')[0];
          const { data: deliveries } = await supabase
            .from('orders')
            .select('driver_id')
            .eq('tenant_id', tenantId)
            .eq('status', 'DELIVERED')
            .gte('created_at', todayStr);

          const deliveryCountMap: Record<string, number> = {};
          if (deliveries) {
            deliveries.forEach((d: any) => {
              if (d.driver_id) {
                deliveryCountMap[d.driver_id] = (deliveryCountMap[d.driver_id] || 0) + 1;
              }
            });
          }

          return data.map(row => mapRowToDriver(row, deliveryCountMap[row.id] || 0));
        }
      } catch (err) {
        console.warn('[driverRepository] Falha ao consultar motoristas no Supabase:', err);
        return dataStore.getDrivers(context, tenantId);
      }
    }
    return dataStore.getDrivers(context, tenantId);
  },

  /**
   * Convida um novo entregador via convite formal de equipe (role: DRIVER)
   * O motorista nasce exclusivamente após o aceite do convite (accept_team_invite).
   */
  async inviteDriver(context: SecurityContext, tenantId: string, email: string): Promise<any> {
    return teamRepository.createInvite(context, tenantId, email, 'DRIVER');
  },

  /**
   * Atualiza dados de veículo ou status do motorista via RPC segura update_driver_profile
   * (id, user_id e tenant_id são estritamente imutáveis)
   */
  async updateDriverProfile(
    context: SecurityContext, 
    tenantId: string, 
    driverId: string, 
    updates: Partial<Driver>
  ): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('update_driver_profile', {
        p_driver_id: driverId,
        p_full_name: updates.name || null,
        p_phone: updates.phone || null,
        p_document: updates.document || null,
        p_vehicle_type: updates.vehicleType || null,
        p_vehicle_model: updates.vehicleModel || null,
        p_vehicle_plate: updates.plate || null,
        p_status: updates.status || null,
      });

      if (error) {
        throw new Error(error.message);
      }
      return;
    }
  },

  /**
   * Compatibilidade para atualizações de motorista
   */
  async updateDriver(
    context: SecurityContext, 
    tenantId: string, 
    driverId: string, 
    updates: Partial<Driver>
  ): Promise<void> {
    return this.updateDriverProfile(context, tenantId, driverId, updates);
  },

  /**
   * Suspende o motorista via RPC suspend_driver
   */
  async suspendDriver(context: SecurityContext, tenantId: string, driverId: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('suspend_driver', {
        p_driver_id: driverId,
      });

      if (error) {
        throw new Error(error.message);
      }
      return;
    }
  },

  /**
   * Atribui um pedido a um motorista via RPC assign_order_to_driver
   */
  async assignOrder(
    context: SecurityContext, 
    tenantId: string, 
    orderId: string, 
    driverUserId: string
  ): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('assign_order_to_driver', {
        p_order_id: orderId,
        p_driver_user_id: driverUserId,
      });

      if (error) {
        throw new Error(error.message);
      }
      return;
    }
  },

  /**
   * Desatribui um pedido via RPC unassign_order_driver
   */
  async unassignOrder(context: SecurityContext, tenantId: string, orderId: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await supabase.rpc('unassign_order_driver', {
        p_order_id: orderId,
      });

      if (error) {
        throw new Error(error.message);
      }
      return;
    }
  }
};
