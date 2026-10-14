import { describe, it, expect } from 'vitest';
import { classifyMemberships, resolveDriverScreen, canFetchDriverOrders, normalizeApprovalStatus, parseOwnApprovalResponse, DriverApprovalLookup } from '../membershipResolution';

const row = (status: string, role_id = 'DRIVER') => ({ status, role_id, tenant_id: 't1' });

describe('F1: classifyMemberships (tenant_users.status)', () => {
  it('só PENDING → PENDING_APPROVAL', () => expect(classifyMemberships([row('PENDING')]).kind).toBe('PENDING_APPROVAL'));
  it('só INACTIVE → INACTIVE (≠ EMPTY)', () => expect(classifyMemberships([row('INACTIVE')]).kind).toBe('INACTIVE'));
  it('ACTIVE + PENDING → ACTIVE', () => expect(classifyMemberships([row('PENDING'), row('ACTIVE', 'OWNER')]).kind).toBe('ACTIVE'));
  it('SUSPENDED → SUSPENDED', () => expect(classifyMemberships([row('SUSPENDED')]).kind).toBe('SUSPENDED'));
  it('PENDING > SUSPENDED > INACTIVE', () => expect(classifyMemberships([row('INACTIVE'), row('SUSPENDED'), row('PENDING')]).kind).toBe('PENDING_APPROVAL'));
  it('nenhuma linha → EMPTY', () => expect(classifyMemberships([]).kind).toBe('EMPTY'));
  it('só INVITED → INACTIVE', () => expect(classifyMemberships([row('INVITED')]).kind).toBe('INACTIVE'));
});

/**
 * Matriz completa: eixo tenant_users (membershipStatus + papel) × eixo drivers.approval_status (lookup).
 * null = vínculo não-DRIVER (ex-staff); NONE = servidor confirmou que não há linha; UNAVAILABLE = falha.
 */
const LOOKUPS: DriverApprovalLookup[] = ['APPROVED', 'PENDING', 'REJECTED', 'SUSPENDED', 'REMOVED', 'NONE', 'UNAVAILABLE', null];
const EXPECTED: Record<string, Record<string, string | null>> = {
  'MEMBERSHIP_PENDING_APPROVAL|null': { APPROVED: 'PENDING', PENDING: 'PENDING', REJECTED: 'REJECTED', SUSPENDED: 'SUSPENDED', REMOVED: 'REMOVED', NONE: 'PENDING', UNAVAILABLE: 'UNAVAILABLE', null: 'PENDING' },
  'MEMBERSHIP_INACTIVE|null': { APPROVED: 'INACTIVE', PENDING: 'INACTIVE', REJECTED: 'REJECTED', SUSPENDED: 'INACTIVE', REMOVED: 'REMOVED', NONE: 'INACTIVE', UNAVAILABLE: 'UNAVAILABLE', null: 'INACTIVE' },
  'MEMBERSHIP_RESOLVED_WITH_DATA|DRIVER': { APPROVED: null, PENDING: 'PENDING', REJECTED: 'REJECTED', SUSPENDED: 'SUSPENDED', REMOVED: 'REMOVED', NONE: 'INACTIVE', UNAVAILABLE: 'UNAVAILABLE', null: 'INACTIVE' },
  'MEMBERSHIP_RESOLVED_WITH_DATA|OWNER': { APPROVED: null, PENDING: null, REJECTED: null, SUSPENDED: null, REMOVED: null, NONE: null, UNAVAILABLE: null, null: null },
  'MEMBERSHIP_RESOLVED_EMPTY|null': { APPROVED: null, PENDING: null, REJECTED: null, SUSPENDED: null, REMOVED: null, NONE: null, UNAVAILABLE: null, null: null },
};

describe('F5: resolveDriverScreen — todas as combinações', () => {
  for (const [key, row] of Object.entries(EXPECTED)) {
    const [ms, roleRaw] = key.split('|');
    const role = roleRaw === 'null' ? null : roleRaw;
    for (const lk of LOOKUPS) {
      it(`${ms} / papel ${roleRaw} / approval ${String(lk)} → ${String(row[String(lk)])}`, () => {
        expect(resolveDriverScreen(ms, role, lk)).toBe(row[String(lk)]);
      });
    }
  }
  it('REJECTED com tenant_users INACTIVE mostra "Cadastro não aprovado" (REJECTED)', () => {
    expect(resolveDriverScreen('MEMBERSHIP_INACTIVE', null, 'REJECTED')).toBe('REJECTED');
  });
  it('ex-staff INACTIVE (sem lookup) → Sem acesso a esta loja', () => {
    expect(resolveDriverScreen('MEMBERSHIP_INACTIVE', null, null)).toBe('INACTIVE');
  });
  it('o app só abre com APPROVED confirmado', () => {
    for (const lk of LOOKUPS) {
      const opens = resolveDriverScreen('MEMBERSHIP_RESOLVED_WITH_DATA', 'DRIVER', lk) === null;
      expect(opens).toBe(lk === 'APPROVED');
    }
  });
});

describe('sem fallback para APPROVED', () => {
  it('canFetchDriverOrders só com APPROVED', () => {
    for (const lk of LOOKUPS) expect(canFetchDriverOrders(lk)).toBe(lk === 'APPROVED');
  });
  it('normalizeApprovalStatus', () => {
    expect(normalizeApprovalStatus('REMOVED')).toBe('REMOVED');
    expect(normalizeApprovalStatus('x')).toBeNull();
    expect(normalizeApprovalStatus(null)).toBeNull();
  });
  it('parseOwnApprovalResponse: válido, NONE, ausente, null, inválido', () => {
    expect(parseOwnApprovalResponse({ approval_status: 'APPROVED' })).toBe('APPROVED');
    expect(parseOwnApprovalResponse({ approval_status: 'NONE' })).toBe('NONE');
    expect(parseOwnApprovalResponse({})).toBe('UNAVAILABLE');
    expect(parseOwnApprovalResponse(null)).toBe('UNAVAILABLE');
    expect(parseOwnApprovalResponse({ approval_status: 'approved' })).toBe('UNAVAILABLE');
    expect(parseOwnApprovalResponse('APPROVED')).toBe('UNAVAILABLE');
  });
});
