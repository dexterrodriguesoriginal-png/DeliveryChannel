import { describe, it, expect, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => true }));
import { mapTeamMemberStatus, mapRowToTeamMember } from '../teamRepository';

describe('F-A: tenant_users.status no TeamMember', () => {
  it.each(['ACTIVE', 'INVITED', 'PENDING', 'SUSPENDED', 'INACTIVE'] as const)('repassa %s', (st) => {
    expect(mapTeamMemberStatus(st)).toBe(st);
    expect(mapRowToTeamMember({ id: '1', tenant_id: 't', user_id: 'u', role_id: 'DRIVER', status: st }).status).toBe(st);
  });
  it('valor desconhecido vira INACTIVE com aviso sem dados pessoais', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapTeamMemberStatus('WHATEVER')).toBe('INACTIVE');
    expect(mapTeamMemberStatus(undefined)).toBe('INACTIVE');
    expect(String(warn.mock.calls[0][0])).not.toMatch(/@|WHATEVER/);
    warn.mockRestore();
  });
});
