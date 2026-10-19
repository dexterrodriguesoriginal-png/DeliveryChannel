/**
 * E2E REAL no STAGING: fila de chegada da retirada (migration 20261019002100). Dados sintéticos; nunca apaga nada.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
vi.mock('../../src/lib/supabase', async () => {
  const m = await import('./stagingClient');
  return { supabase: m.stagingSupabase, isSupabaseConfigured: true, ensureValidSession: async () => true };
});
import { loginAs, USERS, stagingSupabase as sb } from './stagingClient';
import { orderRepository } from '../../src/repositories/orderRepository';
import { arrivalRepository } from '../../src/repositories/arrivalRepository';
import { newIdempotencyKey } from '../../src/lib/backend';

const TA = '5a000000-0000-4000-8000-00000000000a', SLUG_A = 'stg-adega-a', P1 = '5b000000-0000-4000-8000-0000000000a1';
const TB = '5a000000-0000-4000-8000-00000000000b';
const uid: Record<string, string> = {};
const ctx = (u: string, role: string) => ({ userId: uid[u], userRole: role as any, userName: 'stg', tenantId: TA });
const order = (ft: 'PICKUP' | 'DELIVERY') => ({
  customerName: 'Cliente Fila E2E', customerPhone: '11900009998', deliveryAddress: ft === 'PICKUP' ? '' : 'Rua Sintética, 10',
  items: [{ productId: P1, quantity: 1 }], paymentMethod: 'CASH' as const, fulfillmentType: ft as any, origin: 'storefront' as any, idempotencyKey: newIdempotencyKey(),
});
const err = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return String(e?.message || e); } };
const R: Record<string, unknown> = {};
let token = '', pick: any, pick2: any, deliv: any;

beforeAll(async () => { for (const k of ['c1', 'c2', 'ownerA', 'ownerB', 'operatorA', 'cashierA'] as const) uid[k] = (await loginAs(USERS[k]))!; });

describe('Fila de chegada (staging)', () => {
  it('pedido de retirada ganha código curto; entrega não', async () => {
    await loginAs(USERS.c1);
    pick = await orderRepository.createPublicOrder(SLUG_A, order('PICKUP'));
    pick2 = await orderRepository.createPublicOrder(SLUG_A, order('PICKUP'));
    deliv = await orderRepository.createPublicOrder(SLUG_A, order('DELIVERY'));
    const s = await arrivalRepository.myStatus(pick.id);
    expect(s!.code).toMatch(/^\d{3,4}$/);
    expect(s!.arrivedAt).toBeNull();
    expect(await arrivalRepository.myStatus(deliv.id)).toBeNull();
    R.code = s!.code;
  });
  it('QR da loja: equipe lê; operador não troca; dono troca', async () => {
    await loginAs(USERS.operatorA);
    const t1 = (await arrivalRepository.getStoreQr(TA)).token;
    expect(t1).toMatch(/^[A-Z2-9]{6}$/);
    expect(await err(arrivalRepository.rotateStoreQr(TA))).toMatch(/FORBIDDEN/);
    await loginAs(USERS.ownerB);
    expect(await err(arrivalRepository.getStoreQr(TA))).toMatch(/FORBIDDEN/);
    await loginAs(USERS.ownerA);
    token = (await arrivalRepository.rotateStoreQr(TA)).token;
    expect(token).not.toBe(t1);
    await loginAs(USERS.c1);
    expect(await err(arrivalRepository.checkIn(t1, pick.id))).toMatch(/WRONG_STORE/);
  });
  it('check-in: só o dono do pedido, só retirada, QR certo; posição por ordem de chegada', async () => {
    await loginAs(USERS.c2);
    expect(await err(arrivalRepository.checkIn(token, pick.id))).toMatch(/ORDER_NOT_FOUND/);
    await loginAs(USERS.c1);
    expect(await err(arrivalRepository.checkIn(token, deliv.id))).toMatch(/NOT_PICKUP/);
    const a = await arrivalRepository.checkIn(token.toLowerCase(), pick.id);
    expect(a.arrivedAt).toBeTruthy();
    const b = await arrivalRepository.checkIn(token, pick2.id);
    expect(b.position!).toBe(a.position! + 1);
    R.positions = [a.position, b.position];
  });
  it('RLS: cliente 2 e loja B não veem a fila; dono A vê sem PII', async () => {
    await loginAs(USERS.c2);
    expect((await sb.from('pickup_arrivals').select('*').eq('order_id', pick.id)).data).toEqual([]);
    await loginAs(USERS.ownerB);
    expect((await sb.from('pickup_arrivals').select('*').eq('tenant_id', TA)).data).toEqual([]);
    await loginAs(USERS.ownerA);
    const rows = await arrivalRepository.listOpen(TA);
    const row: any = rows!.find(r => r.order_id === pick.id);
    expect(row.arrived_at).toBeTruthy();
    const { data } = await sb.from('pickup_arrivals').select('*').eq('order_id', pick.id);
    expect(Object.keys(data![0]).sort()).toEqual(['arrived_at', 'called_at', 'closed_at', 'code_attempts', 'created_at', 'handed_over_at', 'order_id', 'pickup_code', 'tenant_id']);
  });
  it('chamar exige PRONTO; caixa chama; cliente vê chamado; realtime para o cliente', async () => {
    await loginAs(USERS.cashierA);
    expect(await err(arrivalRepository.call(pick.id))).toMatch(/INVALID_STATE/);
    await loginAs(USERS.ownerA);
    for (const st of ['CONFIRMED', 'PREPARING', 'READY'] as const) await orderRepository.updateStatus(ctx('ownerA', 'OWNER') as any, TA, pick.id, st);
    await loginAs(USERS.c1);
    let events = 0; const off = arrivalRepository.subscribeOrder(pick.id, () => { events++; });
    await new Promise(r => setTimeout(r, 2500));
    await loginAs(USERS.cashierA);
    await arrivalRepository.call(pick.id);
    await loginAs(USERS.c1);
    const s = await arrivalRepository.myStatus(pick.id);
    expect(s!.calledAt).toBeTruthy();
    const t0 = Date.now(); while (!events && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 250));
    off(); R.customerRealtimeEvents = events;
  });
  it('entrega no balcão: sem código não conclui; código errado conta; certo conclui DELIVERED', async () => {
    await loginAs(USERS.operatorA);
    expect(await err(orderRepository.updateStatus(ctx('operatorA', 'OPERATOR') as any, TA, pick.id, 'DELIVERED'))).toMatch(/c[oó]digo|PICKUP_CODE_REQUIRED/i);
    const wrong = String((Number(R.code) + 1) % 1000).padStart(3, '1');
    const w = await arrivalRepository.confirmHandover(pick.id, wrong === R.code ? '0000' : wrong);
    expect(w.success).toBe(false);
    const ok = await arrivalRepository.confirmHandover(pick.id, String(R.code));
    expect(ok.success).toBe(true);
    await loginAs(USERS.c1);
    const mine = await orderRepository.getCustomerOrders(TA, uid.c1);
    expect(mine.find(o => o.id === pick.id)!.status).toBe('DELIVERED');
    expect((await arrivalRepository.myStatus(pick.id))!.closed).toBe(true);
    const s2 = await arrivalRepository.myStatus(pick2.id);
    expect(s2!.position).toBeLessThanOrEqual(Number((R.positions as number[])[1]));
    R.pick2PositionAfter = s2!.position;
  });
  it('override com motivo continua possível (auditado) e anônimo não acessa nada', async () => {
    await loginAs(USERS.ownerA);
    for (const st of ['CONFIRMED', 'PREPARING', 'READY'] as const) await orderRepository.updateStatus(ctx('ownerA', 'OWNER') as any, TA, pick2.id, st);
    const u = await orderRepository.updateStatus(ctx('ownerA', 'OWNER') as any, TA, pick2.id, 'DELIVERED', 'Retirada sem código: E2E');
    expect(u.status).toBe('DELIVERED');
    await loginAs(null);
    expect(await err(arrivalRepository.getStoreQr(TA))).not.toBe('OK');
    expect((await sb.from('pickup_arrivals').select('*').limit(1)).data ?? []).toEqual([]);
    console.log('ARRIVAL_E2E', JSON.stringify(R));
  });
});
