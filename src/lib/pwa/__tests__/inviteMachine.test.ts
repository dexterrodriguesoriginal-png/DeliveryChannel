import { describe, expect, it } from 'vitest';
import { decideInvite, readInvite, recordInvite, recordAccepted, INVITE_MIN_GAP_MS, markInstallModalSeen, isMarkedInstalled, InviteTrigger } from '../installState';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const ctx = (s: ReturnType<typeof mem>, now: number, trigger: InviteTrigger, extra: Partial<{ installed: boolean; standalone: boolean; busy: boolean }> = {}) =>
  decideInvite({ now, trigger, record: readInvite(s, 't1'), installed: false, standalone: false, busy: false, ...extra });

describe('convite de instalação persistente', () => {
  it('primeira visita abre o modal; fechar não é instalação', () => {
    const s = mem();
    expect(ctx(s, 1000, 'visit')).toBe('modal');
    recordInvite(s, 't1', 1000);
    expect(isMarkedInstalled(s, 't1')).toBe(false);
    expect(ctx(s, 2000, 'visit')).toBeNull();
  });
  it('respeita o intervalo mínimo e reconvida nos momentos-chave', () => {
    const s = mem(); recordInvite(s, 't1', 0);
    expect(ctx(s, INVITE_MIN_GAP_MS - 1, 'product')).toBeNull();
    expect(ctx(s, INVITE_MIN_GAP_MS, 'product')).toBe('sheet');
    expect(ctx(s, INVITE_MIN_GAP_MS, 'cart')).toBe('sheet');
    expect(ctx(s, INVITE_MIN_GAP_MS, 'order')).toBe('sheet');
    expect(ctx(s, 3 * 60_000, 'active')).toBe('modal');
  });
  it('nunca durante checkout/formulário, nem instalado, nem em standalone', () => {
    const s = mem(); recordInvite(s, 't1', 0);
    const t = 10 * 60_000;
    expect(ctx(s, t, 'order', { busy: true })).toBeNull();
    expect(ctx(s, t, 'product', { installed: true })).toBeNull();
    expect(ctx(s, t, 'active', { standalone: true })).toBeNull();
    expect(ctx(mem(), 0, 'visit', { standalone: true })).toBeNull();
  });
  it('visitas futuras: sem cooldown longo, convida no primeiro momento-chave', () => {
    const s = mem(); recordInvite(s, 't1', 0); recordInvite(s, 't1', 60_000);
    const nextDay = 24 * 3600_000;
    expect(ctx(s, nextDay, 'visit')).toBeNull();
    expect(ctx(s, nextDay, 'product')).toBe('sheet');
  });
  it('aceite nativo só pausa (aguarda appinstalled), sem marcar instalado', () => {
    const s = mem(); recordInvite(s, 't1', 0); recordAccepted(s, 't1', 0);
    expect(isMarkedInstalled(s, 't1')).toBe(false);
    expect(ctx(s, 5 * 60_000, 'product')).toBeNull();
    expect(ctx(s, 11 * 60_000, 'product')).toBe('sheet');
  });
  it('é independente por loja e migra o modal antigo', () => {
    const s = mem(); recordInvite(s, 't1', 0);
    expect(decideInvite({ now: 1, trigger: 'visit', record: readInvite(s, 't2'), installed: false, standalone: false, busy: false })).toBe('modal');
    const old = mem(); markInstallModalSeen(old, 't9');
    expect(readInvite(old, 't9').count).toBe(1);
    expect(decideInvite({ now: Date.now(), trigger: 'product', record: readInvite(old, 't9'), installed: false, standalone: false, busy: false })).toBe('sheet');
  });
});
