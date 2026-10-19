/**
 * E2E REAL no STAGING (19/10): fluxo do pedido dono -> cliente + Supabase Realtime.
 *  - mesmo cliente faz DOIS pedidos: os dois aparecem no painel do dono e na aba Pedidos do cliente;
 *  - dono aceita -> em preparo -> pronto; o cliente vê cada etapa (lista + linha do tempo);
 *  - Realtime: cliente e dono recebem eventos de public.orders; outro cliente (mesma loja) e dono da loja B
 *    NÃO recebem nada (RLS aplicada aos eventos de postgres_changes).
 * E2E_EXPECT_REALTIME=1 exige os eventos (depois da migration 2000); sem ela só mede e informa.
 * Dados sintéticos; nunca apaga nada.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../src/lib/supabase', async () => {
  const m = await import('./stagingClient');
  return { supabase: m.stagingSupabase, isSupabaseConfigured: true, ensureValidSession: async () => true };
});

import { loginAs, USERS } from './stagingClient';
import { orderRepository } from '../../src/repositories/orderRepository';
import { buildCustomerTimeline } from '../../src/lib/orders/customerTracking';
import { newIdempotencyKey } from '../../src/lib/backend';
import { sortOrdersNewestFirst } from '../../src/lib/orders/orderAge';
import { nextStepFor, buildOrderAlerts } from '../../src/lib/orders/orderAlerts';

const TA = '5a000000-0000-4000-8000-00000000000a';
const SLUG_A = 'stg-adega-a';
const P1 = '5b000000-0000-4000-8000-0000000000a1';
const TB = '5a000000-0000-4000-8000-00000000000b';
const SLUG_B = 'stg-adega-b';
const PB = '5b000000-0000-4000-8000-0000000000b1';
const EXPECT_RT = process.env.E2E_EXPECT_REALTIME === '1';
const uid: Record<string, string> = {};
const ctx = (u: string, role: string) => ({ userId: uid[u], userRole: role as any, userName: 'stg', tenantId: TA });
const checkout = () => ({
  customerName: 'Cliente Sintético RT', customerPhone: '11900009999', deliveryAddress: 'Rua Sintética, 10',
  items: [{ productId: P1, quantity: 1 }], paymentMethod: 'CASH' as const, fulfillmentType: 'DELIVERY' as const,
  origin: 'storefront' as any, idempotencyKey: newIdempotencyKey(),
});
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn: () => boolean, ms: number) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(200); } return fn(); }

type Sub = { events: number; status: string[]; stop: () => void; who: string };
async function subscribe(who: keyof typeof USERS, kind: 'customer' | 'owner'): Promise<Sub> {
  await loginAs(USERS[who]);
  const s: Sub = { events: 0, status: [], stop: () => {}, who };
  s.stop = kind === 'customer'
    ? orderRepository.subscribeToCustomerOrders(TA, () => { s.events++; }, st => s.status.push(st))
    : orderRepository.subscribeToOrders(TA, () => { s.events++; });
  return s;
}

let o1: any, o2: any;
const subs: Record<string, Sub> = {};
const report: Record<string, unknown> = {};

beforeAll(async () => {
  for (const k of ['c1', 'c2', 'ownerA', 'ownerB'] as const) uid[k] = (await loginAs(USERS[k]))!;
});

describe('E8 fluxo do pedido (dono -> cliente) + realtime', () => {
  it('assina o realtime: cliente 1, cliente 2, dono A e dono B', async () => {
    subs.c1 = await subscribe('c1', 'customer');
    subs.c2 = await subscribe('c2', 'customer');
    subs.ownerA = await subscribe('ownerA', 'owner');
    subs.ownerB = await subscribe('ownerB', 'owner');
    const ok = await waitFor(() => subs.c1.status.includes('SUBSCRIBED') && subs.c2.status.includes('SUBSCRIBED'), 15000);
    report.subscribed = ok;
    expect(ok).toBe(true);
    await sleep(1500); // canal de postgres_changes pronto no servidor
  });

  it('mesmo cliente faz dois pedidos: os dois aparecem para o dono (novo no topo) e para o cliente', async () => {
    await loginAs(USERS.c1);
    o1 = await orderRepository.createPublicOrder(SLUG_A, checkout());
    o2 = await orderRepository.createPublicOrder(SLUG_A, checkout());
    expect(o2.id).not.toBe(o1.id);
    await loginAs(USERS.ownerA);
    const all = sortOrdersNewestFirst(await orderRepository.getOrders(ctx('ownerA', 'OWNER') as any, TA));
    const ids = all.map(o => o.id);
    expect(ids).toContain(o1.id);
    expect(ids).toContain(o2.id);
    expect(ids.indexOf(o2.id)).toBeLessThan(ids.indexOf(o1.id));
    expect(all.find(o => o.id === o2.id)!.status).toBe('PENDING');
    await loginAs(USERS.c1);
    const mine = (await orderRepository.getCustomerOrders(TA, uid.c1)).map(o => o.id);
    expect(mine).toContain(o1.id);
    expect(mine).toContain(o2.id);
  });

  for (const [step, status, key] of [
    ['aceita', 'CONFIRMED', 'store_accepted'],
    ['em preparo', 'PREPARING', 'preparing'],
    ['pronto', 'READY', 'ready'],
  ] as const) {
    it(`dono marca "${step}" -> cliente vê ${status} na lista e na linha do tempo (com evento realtime)`, async () => {
      const c1Before = subs.c1.events, ownerBefore = subs.ownerA.events;
      await loginAs(USERS.ownerA);
      const u = await orderRepository.updateStatus(ctx('ownerA', 'OWNER') as any, TA, o1.id, status);
      expect(u.status).toBe(status);
      const gotRt = await waitFor(() => subs.c1.events > c1Before && subs.ownerA.events > ownerBefore, EXPECT_RT ? 10000 : 4000);
      report[`rt_${status}`] = { c1: subs.c1.events - c1Before, ownerA: subs.ownerA.events - ownerBefore };
      if (EXPECT_RT) expect(gotRt).toBe(true);
      await loginAs(USERS.c1);
      const mine = await orderRepository.getCustomerOrders(TA, uid.c1);
      const seen = mine.find(o => o.id === o1.id)!;
      expect(seen.status).toBe(status);
      const tl = buildCustomerTimeline(seen);
      // a etapa alcançada fica "current" (ou "done" se já passou); todas as anteriores ficam "done".
      const idx = tl.steps.findIndex(s => s.key === key);
      expect(['current', 'done']).toContain(tl.steps[idx]?.state);
      expect(tl.steps.slice(0, idx).every(s => s.state === 'done')).toBe(true);
      expect(mine.find(o => o.id === o2.id)!.status).toBe('PENDING'); // o segundo pedido segue intacto
    });
  }

  it('cliente com pedidos em duas lojas: pedido em /app/<slug> fica só na loja do slug', async () => {
    await loginAs(USERS.c1);
    const inB = await orderRepository.createPublicOrder(SLUG_B, { ...checkout(), items: [{ productId: PB, quantity: 1 }] });
    const inA = (await orderRepository.getCustomerOrders(TA, uid.c1)).map(o => o.id);
    const inBList = (await orderRepository.getCustomerOrders(TB, uid.c1)).map(o => o.id);
    expect(inA).toContain(o1.id);
    expect(inA).not.toContain(inB.id);
    expect(inBList).toContain(inB.id);
    expect(inBList).not.toContain(o1.id);
    const { data } = await (await import('./stagingClient')).stagingSupabase.from('orders').select('id, tenant_id').in('id', [o1.id, o2.id, inB.id]);
    const byId = Object.fromEntries((data || []).map((r: any) => [r.id, r.tenant_id]));
    expect(byId).toEqual({ [o1.id]: TA, [o2.id]: TA, [inB.id]: TB });
    report.storeScope = { inB: inB.orderNumber };
  });

  it('seletor de loja: dono A conta pedidos novos da loja A; loja B (sem vínculo) fica 0 pela RLS', async () => {
    await loginAs(USERS.ownerA);
    const counts = await orderRepository.countPendingByTenant([TA, TB]);
    expect(counts[TA]).toBeGreaterThanOrEqual(1); // o2 segue PENDING
    expect(counts[TB]).toBe(0);
    await loginAs(USERS.ownerB);
    expect((await orderRepository.countPendingByTenant([TA, TB]))[TA]).toBe(0);
    report.pendingCounts = counts;
  });

  it('Dashboard: dono sozinho toca o pedido inteiro pelos botões de próxima etapa (retirada e entrega)', async () => {
    await loginAs(USERS.c1);
    const pick = await orderRepository.createPublicOrder(SLUG_A, { ...checkout(), fulfillmentType: 'PICKUP' as any, deliveryAddress: '' });
    const deliv = await orderRepository.createPublicOrder(SLUG_A, checkout());
    await loginAs(USERS.ownerA);
    const seen: Record<string, string[]> = { pick: [], deliv: [] };
    for (const [k, id] of [['pick', pick.id], ['deliv', deliv.id]] as const) {
      for (let i = 0; i < 6; i++) {
        const cur = (await orderRepository.getOrders(ctx('ownerA', 'OWNER') as any, TA)).find(o => o.id === id)!;
        if (i === 0) expect(buildOrderAlerts([cur]).novos.map(o => o.id)).toEqual([id]);
        const step = nextStepFor(cur, 'OWNER');
        if (!step) break;
        seen[k].push(step.kind);
        // 2100: retirada com fila ativa exige código ou motivo (override auditado).
        const u = await orderRepository.updateStatus(ctx('ownerA', 'OWNER') as any, TA, id, step.to, step.kind === 'pickup_done' ? 'Retirada sem código: E2E' : step.note, cur.status);
        expect(u.status).toBe(step.to);
      }
    }
    expect(seen.pick).toEqual(['accept', 'start', 'ready', 'pickup_done']);
    expect(seen.deliv).toEqual(['accept', 'start', 'ready', 'call_driver']);
    await loginAs(USERS.c1);
    const mine = await orderRepository.getCustomerOrders(TA, uid.c1);
    expect(mine.find(o => o.id === pick.id)!.status).toBe('DELIVERED');
    expect(mine.find(o => o.id === deliv.id)!.status).toBe('WAITING_FOR_DRIVER');
    report.dashboardFlow = seen;
  });

  it('RLS no realtime: cliente 2 e dono da loja B não recebem eventos dos pedidos do cliente 1', async () => {
    await sleep(1500);
    report.leak = { c2: subs.c2.events, ownerB: subs.ownerB.events };
    report.totals = { c1: subs.c1.events, ownerA: subs.ownerA.events };
    expect(subs.c2.events).toBe(0);
    expect(subs.ownerB.events).toBe(0);
    for (const k of Object.keys(subs) as (keyof typeof USERS)[]) { await loginAs(USERS[k]); subs[k].stop(); }
    const line = 'E8_REPORT ' + JSON.stringify({ expectRealtime: EXPECT_RT, o1: o1.orderNumber, o2: o2.orderNumber, ...report });
    console.log(line);
    if (process.env.E2E_REPORT_FILE) (await import('node:fs')).appendFileSync(process.env.E2E_REPORT_FILE, line + '\n');
  });
});
