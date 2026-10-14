import { describe, it, expect } from 'vitest';
import { buildInviteUrl, buildWhatsAppInviteLink, inviteTokenFromPath } from '../inviteUrl';

describe('F-F: buildInviteUrl (domínio não fixo)', () => {
  it('usa a origem configurada', () => {
    expect(buildInviteUrl('/entregador/convite/abc', 'https://app.exemplo.test')).toBe('https://app.exemplo.test/entregador/convite/abc');
  });
  it('remove barras duplicadas da origem', () => {
    expect(buildInviteUrl('/entregador/convite/abc', 'https://app.exemplo.test//')).toBe('https://app.exemplo.test/entregador/convite/abc');
  });
  it('sem VITE_PUBLIC_APP_ORIGIN cai em window.location.origin', () => {
    const g = globalThis as any; const prev = g.window;
    g.window = { location: { origin: 'https://origem.local' } };
    try { expect(buildInviteUrl('/entregador/convite/xyz', '')).toBe('https://origem.local/entregador/convite/xyz'); }
    finally { g.window = prev; }
  });
  it('rejeita URL absoluta ou caminho inesperado vindo do servidor', () => {
    expect(() => buildInviteUrl('https://mal.example/entregador/convite/a', 'https://x')).toThrow();
    expect(() => buildInviteUrl('/outra/rota', 'https://x')).toThrow();
    expect(() => buildInviteUrl('/entregador/convite/', 'https://x')).toThrow();
    expect(() => buildInviteUrl('/entregador/convite/a', 'javascript:alert(1)')).toThrow();
  });
  it('WhatsApp leva a mesma URL codificada', () => {
    const url = 'https://x.test/entregador/convite/a-b_c';
    const wa = buildWhatsAppInviteLink('Loja A', url);
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true);
    expect(wa).toContain(encodeURIComponent(url));
    expect(decodeURIComponent(wa.split('text=')[1])).toBe(`Cadastre-se como entregador da Loja A: ${url}`);
  });
  it('inviteTokenFromPath', () => {
    expect(inviteTokenFromPath('/entregador/convite/tok123')).toBe('tok123');
    expect(inviteTokenFromPath('/entregador')).toBeNull();
    expect(inviteTokenFromPath('/entregador/convite/')).toBeNull();
  });
});
