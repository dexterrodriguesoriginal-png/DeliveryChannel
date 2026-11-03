import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
import { attendedTabIds, badgeText, callTitle, canCollectTab, canUseWaiterApp, greeting, newRoundIds, newlyReadyRoundIds, openCalls, waiterFeatures, waiterOrderStatus } from '../waiterLogic';
import { injectWaiterHead, isWaiterRoute, WAITER_MANIFEST_PATH } from '../../../lib/pwa/waiterManifest';
import { newApprovalIds } from '../../../hooks/usePendingApprovals';

describe('App do Garçom — regras', () => {
  it('só a equipe do salão usa o app', () => {
    for (const role of ['WAITER', 'OWNER', 'MANAGER', 'CASHIER']) expect(canUseWaiterApp(role)).toBe(true);
    for (const role of ['DRIVER', 'KITCHEN', 'CUSTOMER', 'CEO', '', null, undefined]) expect(canUseWaiterApp(role as string)).toBe(false);
  });
  it('funções que dependem da migração ficam desligadas sem acesso v2', () => {
    expect(waiterFeatures(false)).toEqual({ reject: false, openTable: false, requestBill: false, holder: false });
    expect(waiterFeatures(true)).toEqual({ reject: true, openTable: true, requestBill: false, holder: true });
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
  it('aviso sonoro para novas rodadas na mesa (a primeira leitura nunca toca)', () => {
    expect(newRoundIds(null, [{ id: 'r1' }])).toEqual([]);
    expect(newRoundIds(new Set(['r1']), [{ id: 'r1' }, { id: 'r2' }])).toEqual(['r2']);
    expect(newRoundIds(new Set(['r1']), [])).toEqual([]);
  });
  it('avisa uma vez na transição para pronto e não ao abrir o app', () => {
    expect(newlyReadyRoundIds(null, [{ id: 'a', status: 'READY' }])).toEqual([]);
    const previous = new Map([['a', 'PREPARING'], ['b', 'READY']]);
    expect(newlyReadyRoundIds(previous, [{ id: 'a', status: 'READY' }, { id: 'b', status: 'READY' }])).toEqual(['a']);
    expect(newlyReadyRoundIds(new Map([['a', 'READY']]), [{ id: 'a', status: 'READY' }])).toEqual([]);
  });
  it('Meus pedidos respeita atribuição atual e não inclui mesa de outro garçom', () => {
    const tab = (id: string, table_id: string, waiter_id?: string) => ({ id, table_id, waiter_id, status: 'OPEN' as const, opened_at: '', service_fee_percent: 10, service_fee_removed: false });
    const tabs = [tab('a', '1', 'me'), tab('b', '2', 'me'), tab('c', '3'), tab('d', '4')];
    const assignments = [{ table_id: '2', waiter_id: 'other' }, { table_id: '3', waiter_id: 'me' }];
    expect([...attendedTabIds('me', tabs, assignments, [{ id: 'call', tab_id: 'd', type: 'CALL', status: 'OPEN', created_at: '', accepted_by: 'me' }], [])]).toEqual(['a', 'c', 'd']);
    expect([...attendedTabIds(undefined, tabs, assignments, [], [])]).toEqual([]);
  });
  it('garçom só cobra uma conta autorizada ou reabre Pix pendente da sua mesa', () => {
    for (const state of ['OPEN', 'BILL_REQUESTED', 'CLOSED', 'CANCELLED']) expect(canCollectTab(state, 'WAITER', true)).toBe(false);
    expect(canCollectTab('WAITER_AUTHORIZED', 'WAITER', true)).toBe(true);
    expect(canCollectTab('AWAITING_PAYMENT', 'WAITER', true)).toBe(true);
    expect(canCollectTab('WAITER_AUTHORIZED', 'WAITER', false)).toBe(false);
    expect(canCollectTab('WAITER_AUTHORIZED', 'CUSTOMER', true)).toBe(false);
    expect(waiterOrderStatus('READY').label).toContain('balcão chamando');
    expect(waiterOrderStatus('OUT_FOR_DELIVERY').label).toBe('Pedido indo até você');
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
