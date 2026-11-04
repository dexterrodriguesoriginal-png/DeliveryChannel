import { describe, expect, it } from 'vitest';
import { canCustomizeRolePermission, maskTeamInviteEmail, roleFromTeamPath, teamRolePath, visibleTeamRoles } from '../teamAccess';
describe('links e papéis da equipe', () => {
  it('scopes role links to the store and keeps waiter signup on its own app', () => {
    expect(teamRolePath('loja-a', 'WAITER')).toBe('/garcom/loja-a?signup=1');
    expect(teamRolePath('loja-a', 'KITCHEN')).toBe('/equipe/loja-a/kitchen?signup=1');
    expect(teamRolePath('loja-a', 'OWNER')).toBe('/equipe/loja-a/owner');
    expect(teamRolePath('loja-a', 'WAITER', false)).toBe('/garcom/loja-a');
  });
  it('accepts only store team roles', () => {
    expect(roleFromTeamPath('kitchen')).toBe('KITCHEN');
    expect(roleFromTeamPath('ceo')).toBeNull();
    expect(roleFromTeamPath('invalid')).toBeNull();
  });
  it('keeps dedicated app permissions within their data boundary', () => {
    expect(canCustomizeRolePermission('KITCHEN', 'manage_kitchen')).toBe(true);
    expect(canCustomizeRolePermission('KITCHEN', 'view_orders')).toBe(false);
    expect(canCustomizeRolePermission('WAITER', 'manage_tables')).toBe(true);
    expect(canCustomizeRolePermission('WAITER', 'manage_catalog')).toBe(false);
    expect(canCustomizeRolePermission('DRIVER', 'view_orders')).toBe(false);
    expect(canCustomizeRolePermission('OWNER', 'view_orders')).toBe(false);
    expect(canCustomizeRolePermission('MANAGER', 'view_finances')).toBe(false);
  });
  it('hides only the optional roles when their tools are off', () => {
    expect(visibleTeamRoles({ waiter: false, kitchen: false })).toEqual(['OWNER', 'MANAGER', 'CASHIER', 'OPERATOR', 'DELIVERY_MANAGER', 'DRIVER']);
    expect(visibleTeamRoles({ waiter: true, kitchen: true })).toContain('KITCHEN');
    expect(visibleTeamRoles({ waiter: true, kitchen: true })).toContain('WAITER');
  });
  it('masks legacy and already masked invite addresses without exposing the original', () => {
    expect(maskTeamInviteEmail('convidado@example.com')).toBe('co***@ex***.com');
    expect(maskTeamInviteEmail('co***@ex***.com')).toBe('co***@ex***.com');
    expect(maskTeamInviteEmail('a@b.com.br')).toBe('a***@b***.br');
    expect(maskTeamInviteEmail('a***@b***.br')).toBe('a***@b***.br');
    expect(maskTeamInviteEmail('inválido')).toBe('***');
  });
});
