import { RoleId } from '../../types';

export const DEFAULT_CLOSE_ROLES = ['OWNER', 'MANAGER', 'CASHIER'] as const;

export function salonPermissions(role: RoleId | null | undefined) {
  const canManageSalon = role === 'OWNER' || role === 'MANAGER';
  return {
    canManageSalon,
    canManageServiceFeeModule: role === 'OWNER',
    canRegenerateQr: role === 'OWNER',
  };
}

export interface DineInConfig {
  mode: 'TABLE' | 'INDIVIDUAL';
  release_required: boolean;
  round_limit: number;
  salon_open: boolean;
  close_roles: string[];
}

export function readDineInConfig(value: Record<string, unknown> = {}): DineInConfig {
  const roles = Array.isArray(value.close_roles)
    ? value.close_roles.filter((role): role is string => typeof role === 'string')
    : [...DEFAULT_CLOSE_ROLES];
  const limit = Number(value.round_limit ?? 300);
  return {
    mode: value.mode === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'TABLE',
    release_required: value.release_required === undefined ? true : Boolean(value.release_required),
    round_limit: Number.isFinite(limit) && limit > 0 ? limit : 300,
    salon_open: Boolean(value.salon_open),
    close_roles: roles,
  };
}

export function diningTableQrUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/mesa/${encodeURIComponent(token)}`;
}

export function bulkTableInputs(count: number, area: string, seats: number) {
  return Array.from({ length: count }, (_, index) => ({
    label: `Mesa ${index + 1}`,
    area,
    seats,
  }));
}
