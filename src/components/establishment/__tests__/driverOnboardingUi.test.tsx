import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false, ensureValidSession: async () => true }));
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamMemberStatusBadge, DriverApprovalBadge } from '../statusBadges';
import { PendingApplicationsSection, DriverLinkActions, InviteLinksSection } from '../DriverOnboardingSections';
import { DriverInviteModal } from '../DriverInviteModal';
import { driverPagePermissions, linkActionsFor, assignableDrivers } from '../../../lib/driverAdmin';
import type { Driver } from '../../../types';

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const drv = (approvalStatus: Driver['approvalStatus'], id = 'd1'): Driver => ({
  id, tenantId: 't', name: 'Zé Moto', phone: '1199', vehicle: 'MOTO', plate: 'X', isOnline: false,
  completedDeliveriesToday: 0, approvalStatus, createdAt: '2026-10-14T10:00:00Z',
});
const noop = () => {};

describe('F-B: selos da TeamPage (tenant_users.status)', () => {
  it.each([
    ['ACTIVE', 'Ativo', 'emerald'], ['PENDING', 'Aguardando aprovação', 'amber'], ['SUSPENDED', 'Suspenso', 'rose'],
    ['INVITED', 'Convidado', 'blue'], ['INACTIVE', 'Inativo', 'gray'],
  ] as const)('%s → %s', (st, label, color) => {
    const h = html(<TeamMemberStatusBadge status={st} />);
    expect(h).toContain(label);
    expect(h).toContain(color);
  });
});

describe('F-E: selo de aprovação separado da disponibilidade', () => {
  it.each([['APPROVED', 'Aprovado'], ['PENDING', 'Pendente'], ['SUSPENDED', 'Suspenso'], ['REJECTED', 'Rejeitado'], ['REMOVED', 'Removido']] as const)
  ('%s → %s', (st, label) => expect(html(<DriverApprovalBadge status={st} />)).toContain(label));
});

describe('F-E: permissões por papel', () => {
  it('OWNER/MANAGER revisam e gerenciam links', () => {
    expect(driverPagePermissions('OWNER')).toEqual({ canManageLinks: true, canReview: true });
    expect(driverPagePermissions('MANAGER')).toEqual({ canManageLinks: true, canReview: true });
  });
  it('DELIVERY_MANAGER só links', () => expect(driverPagePermissions('DELIVERY_MANAGER')).toEqual({ canManageLinks: true, canReview: false }));
  it('CASHIER nada (e não acessa a aba pelo navPermissions)', () => expect(driverPagePermissions('CASHIER')).toEqual({ canManageLinks: false, canReview: false }));
  it('DELIVERY_MANAGER não vê Suspender/Remover', () => {
    const h = html(<DriverLinkActions driver={drv('APPROVED')} canReview={false} onAction={noop} />);
    expect(h).not.toContain('Suspender');
    expect(h).not.toContain('Remover');
  });
  it('OWNER vê Suspender/Remover para APPROVED e Reativar/Remover para SUSPENDED', () => {
    expect(html(<DriverLinkActions driver={drv('APPROVED')} canReview onAction={noop} />)).toMatch(/Suspender[\s\S]*Remover/);
    const s = html(<DriverLinkActions driver={drv('SUSPENDED')} canReview onAction={noop} />);
    expect(s).toContain('Reativar'); expect(s).not.toContain('Suspender');
  });
  it('REJECTED/REMOVED: sem reabrir, com orientação de convite por e-mail', () => {
    for (const st of ['REJECTED', 'REMOVED'] as const) {
      const h = html(<DriverLinkActions driver={drv(st)} canReview onAction={noop} />);
      expect(h).toContain('Para readmitir, envie um convite por e-mail');
      expect(h).not.toMatch(/Reativar|Aprovar/);
    }
    expect(linkActionsFor('PENDING')).toEqual([]);
  });
  it('seção de pendentes mostra Aprovar e Rejeitar', () => {
    const h = html(<PendingApplicationsSection drivers={[drv('PENDING')]} onApprove={noop} onReject={noop} />);
    expect(h).toContain('Pendentes de aprovação (1)');
    expect(h).toContain('Aprovar'); expect(h).toContain('Rejeitar'); expect(h).toContain('Zé Moto');
    expect(html(<PendingApplicationsSection drivers={[]} onApprove={noop} onReject={noop} />)).toBe('');
  });
  it('seletor de atribuição só lista APPROVED confirmado (ausente/UNKNOWN fora)', () => {
    const list = [drv('APPROVED', 'a'), drv('PENDING', 'b'), drv('SUSPENDED', 'c'), drv(undefined, 'd'), drv('REJECTED', 'e'), drv('UNKNOWN', 'f')];
    expect(assignableDrivers(list).map(d => d.id)).toEqual(['a']);
  });
  it('UNKNOWN: selo "Aprovação não confirmada" e nenhuma ação', () => {
    expect(html(<DriverApprovalBadge status="UNKNOWN" />)).toContain('Aprovação não confirmada');
    const h = html(<DriverLinkActions driver={drv(undefined)} canReview onAction={noop} />);
    expect(h).not.toMatch(/Suspender|Remover|Reativar/);
    expect(linkActionsFor('UNKNOWN')).toEqual([]);
    expect(linkActionsFor(undefined)).toEqual([]);
  });
});

describe('F-F: lista de convites e modal QR', () => {
  it('estados Ativo/Expirado/Revogado; Revogar só em ativo', () => {
    const base = { label: null, maxUses: null, uses: 0, expiresAt: '2026-10-20T00:00:00Z', createdAt: 'c' };
    const h = html(<InviteLinksSection links={[
      { ...base, id: 'a', state: 'ACTIVE' }, { ...base, id: 'b', state: 'EXPIRED' }, { ...base, id: 'c', state: 'REVOKED' },
    ]} onRenew={noop} onRevoke={noop} />);
    expect(h).toContain('Ativo'); expect(h).toContain('Expirado'); expect(h).toContain('Revogado');
    expect(h.match(/Revogar/g)?.length).toBe(1);
    expect(h.match(/Renovar/g)?.length).toBe(3);
  });
  it('erro de RPC ausente aparece como texto', () => {
    expect(html(<InviteLinksSection links={[]} error="Recurso ainda não disponível." onRenew={noop} onRevoke={noop} />)).toContain('Recurso ainda não disponível.');
  });
  it('modal mostra URL absoluta, WhatsApp com a mesma URL codificada e some quando o convite é apagado', () => {
    vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', 'https://app.exemplo.test');
    const invite = { id: 'l', token: 'TOK_abc', url: '/entregador/convite/TOK_abc', expiresAt: '2026-10-21T00:00:00Z' };
    const h = html(<DriverInviteModal invite={invite} storeName="Loja A" maxUses={5} onClose={noop} />);
    const url = 'https://app.exemplo.test/entregador/convite/TOK_abc';
    expect(h).toContain(`value="${url}"`);
    expect(h).toContain(encodeURIComponent(url));
    expect(h).toContain('Copiar'); expect(h).toContain('WhatsApp'); expect(h).toContain('Limite: 5 usos');
    expect(html(<DriverInviteModal invite={null} storeName="Loja A" onClose={noop} />)).toBe('');
    vi.unstubAllEnvs();
  });
});

import { canAssignDrivers } from '../../../lib/driverAdmin';
describe('0700 v3.4: canAssignDrivers', () => {
  it('OWNER/MANAGER/DELIVERY_MANAGER atribuem; CASHIER/DRIVER/OPERATOR não', () => {
    expect(['OWNER', 'MANAGER', 'DELIVERY_MANAGER'].every(r => canAssignDrivers(r as any))).toBe(true);
    expect(['CASHIER', 'DRIVER', 'OPERATOR', 'CUSTOMER', null].some(r => canAssignDrivers(r as any))).toBe(false);
  });
});
