import { describe, it, expect, vi } from 'vitest';
import { readInviteStore, rememberInviteStore, driverAuthReturnPath, applyDriverRedeem, membershipsForSelection, startDriverGoogleAuth, clearInviteToken } from '../driverInviteFlow';
import { classifyMemberships } from '../membershipResolution';
import { inviteTokenFromLocation } from '../../utils/inviteUrl';
const session = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('QR da loja B com loja A ativa', () => {
  it.each(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'REMOVED'] as const)('%s troca para B antes de apresentar o resultado', async status => {
    let activeTenant = 'A';
    let finish!: (ok: boolean) => void;
    const switchTenant = vi.fn(async (id: string) => { const ok = await new Promise<boolean>(r => { finish = r; }); activeTenant = id; return ok; });
    let displayed = false;
    const pending = applyDriverRedeem({ status, consumed: false, tenantId: 'B' }, switchTenant).then(result => { displayed = true; return result; });
    await Promise.resolve();
    expect(displayed).toBe(false); expect(activeTenant).toBe('A');
    finish(true);
    const result = await pending;
    expect(activeTenant).toBe('B');
    expect(result).toMatchObject({ tenantId: 'B' });
    expect(switchTenant).toHaveBeenCalledWith('B');
  });
  it('nome público de B persiste no status após recarga, sem usar o nome de A', () => {
    const s = session(); rememberInviteStore(s, 'B', 'Mercado B');
    expect(readInviteStore(s, 'B')).toBe('Mercado B');
    expect(readInviteStore(s, 'A')).toBeNull();
    clearInviteToken(s);
    expect(readInviteStore(s, 'B')).toBe('Mercado B');
    expect(s.getItem('driver_invite_token')).toBeNull();
  });
  it('falha ao trocar ou falta de tenant não navega para a loja anterior', async () => {
    await expect(applyDriverRedeem({ status: 'APPROVED', consumed: false, tenantId: 'B' }, async () => false)).rejects.toThrow('abrir esta loja');
    const select = vi.fn();
    expect(await applyDriverRedeem({ status: 'APPROVED', consumed: false }, select)).toEqual({ kind: 'INVALID' });
    expect(select).not.toHaveBeenCalled();
  });
  it('vínculo PENDING/INACTIVE em B vence o ACTIVE de A; aprovação de B entra direto', () => {
    for (const status of ['PENDING', 'INACTIVE', 'ACTIVE']) {
      const rows = [{ tenant_id: 'A', role_id: 'DRIVER', status: 'ACTIVE' }, { tenant_id: 'B', role_id: 'DRIVER', status }];
      const selected = membershipsForSelection(rows, 'B');
      expect(selected.map(r => r.tenant_id)).toEqual(status === 'ACTIVE' ? ['B', 'A'] : ['B']);
      expect(classifyMemberships(selected).row?.tenant_id).toBe('B');
      expect(classifyMemberships(selected).kind).toBe(status === 'PENDING' ? 'PENDING_APPROVAL' : status);
    }
  });
});
describe('Google no convite', () => {
  it('retorno remove o token da URL sem perder code ou sessão no fragmento', () => {
    expect(driverAuthReturnPath('?token=CONVITE&code=oauth-code', '#access_token=auth-session')).toBe('/entregador/convite?code=oauth-code#access_token=auth-session');
    expect(driverAuthReturnPath('', '')).toBe('/entregador/convite');
    expect(inviteTokenFromLocation({ pathname: '/entregador/convite/%ZZ', search: '' }, session())).toBeNull();
  });
  it('usa intent driver, guarda token só na sessão e retoma o redeem da mesma conta confirmada', async () => {
    const s = session(); const google = vi.fn(async () => {});
    await startDriverGoogleAuth(s, 'TOKEN_B', google);
    expect(google).toHaveBeenCalledWith({ intent: 'driver', returnTo: '/convite-entregador' });
    const token = inviteTokenFromLocation({ pathname: '/convite-entregador', search: '' }, s);
    expect(token).toBe('TOKEN_B');
    const redeem = vi.fn(async (t: string) => ({ status: 'APPROVED' as const, consumed: false, tenantId: 'B' }));
    const switchTenant = vi.fn(async () => true);
    expect(await applyDriverRedeem(await redeem(token!), switchTenant)).toEqual({ kind: 'GO_APP', tenantId: 'B' });
    clearInviteToken(s);
    expect(inviteTokenFromLocation({ pathname: '/convite-entregador', search: '' }, s)).toBeNull();
  });
});
