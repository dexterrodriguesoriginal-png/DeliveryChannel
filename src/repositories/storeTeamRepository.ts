import { supabase } from '../lib/supabase';
import { RpcBusinessError } from '../lib/rpcErrors';
import type { RoleId } from '../types';
import type { StoreTools } from '../lib/teamAccess';
export type { StoreTools } from '../lib/teamAccess';
export interface StoreAccess { role: RoleId; permissions: string[]; tools: StoreTools }
export interface StoreRolePermission { role: RoleId; permission: string; enabled: boolean }
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new RpcBusinessError(error);
  return data as T;
}
export const storeTeamRepository = {
  getAccess: (tenantId: string) => call<StoreAccess>('get_store_access', { p_tenant: tenantId }),
  listTools: (tenantId: string) => call<StoreTools>('list_store_tools', { p_tenant: tenantId }),
  setTool: (tenantId: string, tool: keyof StoreTools, enabled: boolean) => call<void>('set_store_tool', { p_tenant: tenantId, p_tool: tool, p_enabled: enabled }),
  listPermissions: (tenantId: string) => call<StoreRolePermission[]>('list_store_role_permissions', { p_tenant: tenantId }),
  setPermission: (tenantId: string, role: RoleId, permission: string, enabled: boolean) => call<void>('set_store_role_permission', { p_tenant: tenantId, p_role: role, p_permission: permission, p_enabled: enabled }),
};
