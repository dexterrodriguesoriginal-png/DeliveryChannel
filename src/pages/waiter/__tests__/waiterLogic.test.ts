import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
import { badgeText, callTitle, canUseWaiterApp, greeting, openCalls, waiterFeatures } from '../waiterLogic';
import { injectWaiterHead, isWaiterRoute, WAITER_MANIFEST_PATH } from '../../../lib/pwa/waiterManifest';
import { newApprovalIds } from '../../../hooks/usePendingApprovals';

describe('App do Garçom — regras', () => {
  it('só a equipe do salão usa o app', () => {
    for (const role of ['WAITER', 'OWNER', 'MANAGER', 'CASHIER']) expect(canUseWaiterApp(role)).toBe(true);
    for (const role of ['DRIVER', 'KITCHEN', 'CUSTOMER', 'CEO', '', null, undefined]) expect(canUseWaiterApp(role as string)).toBe(false);
  });
  it('funções que dependem da migração ficam desligadas sem acesso v2', () => {
    expect(waiterFeatures(false)).toEqual({ reject: false, openTable: false, requestBill: false, holder: false });
    expect(waiterFeatures(true)).toEqual({ reject: true, openTable: true, requestBill: true, holder: true });
  });
  it('selos e textos', () => {
    expect(badgeText(0)).toBe(''); expect(badgeText(7)).toBe('7'); expect(badgeText(250)).toBe('99+');
    expect(callTitle('BILL')).toBe('Pediu a conta'); expect(callTitle('HELP')).toBe('Precisa de ajuda'); expect(callTitle('CALL')).toBe('Chamou o garçom');
    expect(greeting(new Date('2026-10-27T08:00:00'))).toBe('Bom dia');
    expect(greeting(new Date('2026-10-27T20:00:00'))).toBe('Boa noite');
    expect(openCalls([{ id: 'a', tab_id: 't', type: 'CALL', status: 'OPEN', created_at: '' }, { id: 'b', tab_id: 't', type: 'CALL', status: 'HANDLED', created_at: '' }])).toHaveLength(1);
  });
  it('aviso sonoro só para liberações novas (a primeira leitura nunca toca)', () => {
    const item = (id: string) => ({ sessionId: id, tabId: 't', tableId: 'x', tableLabel: 'Mesa 1', displayName: 'A', expiresAt: '' });
    expect(newApprovalIds(null, [item('a')])).toEqual([]);
    expect(newApprovalIds(new Set(['a']), [item('a'), item('b')])).toEqual(['b']);
    expect(newApprovalIds(new Set(['a']), [])).toEqual([]);
  });
});

describe('PWA do Garçom', () => {
  it('manifesto próprio, escopo /garcom, sem token e com ícones', () => {
    const manifest = JSON.parse(readFileSync('public/garcom.webmanifest', 'utf8'));
    expect(manifest).toMatchObject({ id: '/garcom', start_url: '/garcom', scope: '/garcom', display: 'standalone', short_name: 'Garçom' });
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512']);
    for (const route of ['/garcom', '/garcom/']) expect(isWaiterRoute(route)).toBe(true);
    for (const route of ['/', '/garcom.webmanifest', '/app/garcom', '/entregador']) expect(isWaiterRoute(route)).toBe(false);
  });
  it('troca o manifesto global pelo do Garçom no HTML inicial', () => {
    const html = injectWaiterHead('<head><title>Loja</title><link rel="manifest" href="/manifest.json" /></head>');
    expect(html).toContain(`href="${WAITER_MANIFEST_PATH}"`);
    expect(html).not.toContain('/manifest.json');
    expect(html.match(/rel="manifest"/g)).toHaveLength(1);
    expect(html).toContain('<title>Garçom</title>');
  });
});
