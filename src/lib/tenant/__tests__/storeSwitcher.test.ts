import { describe, it, expect } from 'vitest';
import { buildStoreSwitcherEntries, otherStoresWithPending, pendingLabel, countPendingRows, isStaffMembership } from '../storeSwitcher';

const ESPETO = 'f8965291-3c69-4052-be14-cef68bbcbf38';
const NEY = 'e516a2c9-ce4e-4983-a5a3-9facdb57c4f0';
const LOJA3 = 'c78b3c65-5b76-4760-997b-f5819d17ec1f';
const m = (tenantId: string, tenantName: string, tenantSlug: string, roleId = 'OWNER', status = 'ACTIVE') => ({ tenantId, tenantName, tenantSlug, roleId, status });

describe('storeSwitcher: loja atual + pedidos novos de cada loja', () => {
  const memberships = [
    m(ESPETO, 'Espeto do Bahia', 'espeto-do-bahia'),
    m(NEY, 'Bar do Ney', 'bar-do-ney'),
    m(LOJA3, 'Loja Entregador', 'loja-x', 'DRIVER'),
    m(NEY, 'Bar do Ney', 'bar-do-ney', 'MANAGER'), // duplicado
  ];
  it('vendo o Espeto, mostra "BAR DO NEY: 2 novos pedidos"', () => {
    const e = buildStoreSwitcherEntries(memberships, ESPETO, { [ESPETO]: 0, [NEY]: 2 });
    expect(e.map(x => x.tenantId)).toEqual([ESPETO, NEY]); // atual primeiro; DRIVER e duplicado fora
    expect(e[0].isActive).toBe(true);
    expect(otherStoresWithPending(e).map(x => x.summary)).toEqual(['BAR DO NEY: 2 novos pedidos']);
  });
  it('rótulos em pt-BR', () => {
    expect(pendingLabel(0)).toBe('nenhum pedido novo');
    expect(pendingLabel(1)).toBe('1 novo pedido');
    expect(pendingLabel(5)).toBe('5 novos pedidos');
    expect(pendingLabel(null)).toBe('…');
  });
  it('sem contagem ainda: não alerta outras lojas', () => {
    const e = buildStoreSwitcherEntries(memberships, NEY, null);
    expect(e[0].tenantId).toBe(NEY);
    expect(otherStoresWithPending(e)).toEqual([]);
  });
  it('só vínculo ativo de equipe entra', () => {
    expect(isStaffMembership({ roleId: 'OWNER', status: 'ACTIVE' })).toBe(true);
    expect(isStaffMembership({ roleId: 'OWNER', status: 'SUSPENDED' })).toBe(false);
    expect(isStaffMembership({ roleId: 'DRIVER', status: 'ACTIVE' })).toBe(false);
    expect(isStaffMembership({ roleId: 'CUSTOMER', status: 'ACTIVE' })).toBe(false);
  });
  it('conta PENDING por loja e ignora loja que não foi pedida', () => {
    expect(countPendingRows([{ tenant_id: NEY }, { tenant_id: NEY }, { tenant_id: LOJA3 }], [ESPETO, NEY])).toEqual({ [ESPETO]: 0, [NEY]: 2 });
  });
});
