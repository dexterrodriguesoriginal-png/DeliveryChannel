/**
 * E2E REAL no STAGING: Tela da Cozinha (migration 20261019002300). Dados sintéticos; nunca apaga nada.
 * O fluxo do aparelho (login anônimo) só roda se "Allow anonymous sign-ins" estiver ligado no projeto.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
vi.mock('../../src/lib/supabase', async () => {
  const m = await import('./stagingClient');
  return { supabase: m.stagingSupabase, isSupabaseConfigured: true, ensureValidSession: async () => true };
});
import { loginAs, USERS, stagingSupabase as sb } from './stagingClient';
import { orderRepository } from '../../src/repositories/orderRepository';
import { kitchenRepository } from '../../src/repositories/kitchenRepository';
import { newIdempotencyKey } from '../../src/lib/backend';

const TA = '5a000000-0000-4000-8000-00000000000a', SLUG_A = 'stg-adega-a', P1 = '5b000000-0000-4000-8000-0000000000a1';
const uid: Record<string, string> = {};
const ctx = (u: string, role: string) => ({ userId: uid[u], userRole: role as any, userName: 'stg', tenantId: TA });
const order = (ft: 'PICKUP' | 'DELIVERY') => ({
  customerName: 'Mariana Cozinha Sobrenome', customerPhone: '11900007777', deliveryAddress: ft === 'PICKUP' ? '' : 'Rua Sintética Cozinha, 10',
  items: [{ productId: P1, quantity: 1 }], paymentMethod: 'CASH' as const, fulfillmentType: ft as any, origin: 'storefront' as any, idempotencyKey: newIdempotencyKey(),
});
const err = async (p: PromiseLike<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return String(e?.message || e); } };
let pick: any, deliv: any, pendente: any;
const anonClient = (): SupabaseClient => createClient(process.env.STAGING_SUPABASE_URL || '', process.env.STAGING_ANON_KEY || '', { auth: { persistSession: false, autoRefreshToken: false } });

beforeAll(async () => { for (const k of ['c1', 'ownerA', 'ownerB', 'operatorA', 'cashierA', 'driverA'] as const) uid[k] = (await loginAs(USERS[k]))!; });
afterAll(async () => { await loginAs(USERS.ownerA); await kitchenRepository.setSettings(TA, false, null, true).catch(() => {}); });

describe('Tela da Cozinha (staging)', () => {
  it('desligada por padrão; só dono/gerente liga', async () => {
    await loginAs(USERS.ownerA);
    await kitchenRepository.setSettings(TA, false, null, true);
    expect((await kitchenRepository.getSettings(TA)).enabled).toBe(false);
    expect(await err(kitchenRepository.createCode(TA))).toMatch(/KITCHEN_DISABLED/);
    await loginAs(USERS.operatorA);
    expect(await err(kitchenRepository.setSettings(TA, true))).toMatch(/FORBIDDEN/);
    await loginAs(USERS.ownerB);
    expect(await err(kitchenRepository.getSettings(TA))).toMatch(/FORBIDDEN/);
    await loginAs(USERS.ownerA);
    const s = await kitchenRepository.setSettings(TA, true, '4321');
    expect(s.enabled).toBe(true); expect(s.has_pin).toBe(true);
    expect(await err(kitchenRepository.setSettings(TA, true, '12a4'))).toMatch(/PIN_FORMAT/);
  });

  it('código de pareamento: 8 caracteres, 10 min, só o dono da loja gera; conta logada não pareia', async () => {
    await loginAs(USERS.ownerA);
    const c = await kitchenRepository.createCode(TA, 'Tablet E2E');
    expect(c.code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    const mins = (new Date(c.expires_at).getTime() - Date.now()) / 60000; expect(mins).toBeGreaterThan(9); expect(mins).toBeLessThanOrEqual(10.1);
    await loginAs(USERS.ownerB);
    expect(await err(kitchenRepository.createCode(TA))).toMatch(/FORBIDDEN/);
    await loginAs(USERS.operatorA);
    expect(await err(kitchenRepository.createCode(TA))).toMatch(/FORBIDDEN/);
    expect(await err(sb.rpc('redeem_kitchen_pairing_code', { p_code: c.code, p_device_name: 'x' }).then(r => { if (r.error) throw r.error; }))).toMatch(/USE_STAFF_LOGIN/);
    await loginAs(USERS.ownerA);
    expect(Array.isArray(await kitchenRepository.listDevices(TA))).toBe(true);
  });

  it('transições: só CONFIRMED→PREPARING→READY; sem preço/PII além do 1º nome na retirada', async () => {
    await loginAs(USERS.c1);
    pick = await orderRepository.createPublicOrder(SLUG_A, order('PICKUP'));
    deliv = await orderRepository.createPublicOrder(SLUG_A, order('DELIVERY'));
    pendente = await orderRepository.createPublicOrder(SLUG_A, order('DELIVERY'));
    await loginAs(USERS.ownerA);
    await orderRepository.updateStatus(ctx('ownerA', 'OWNER') as any, TA, pick.id, 'CONFIRMED');
    await orderRepository.updateStatus(ctx('ownerA', 'OWNER') as any, TA, deliv.id, 'CONFIRMED');
    await loginAs(USERS.operatorA);
    const list = await kitchenRepository.listOrders(sb, TA);
    const mine = list.filter(o => [pick.id, deliv.id].includes(o.order_id));
    expect(mine.length).toBe(2);
    expect(list.some(o => o.order_id === pendente.id)).toBe(false);
    const raw = JSON.stringify(list);
    for (const bad of ['total', 'subtotal', 'price', 'phone', '11900007777', 'Sintética', 'Sobrenome', 'address', 'email', 'customer_id']) expect(raw).not.toContain(bad);
    expect(mine.find(o => o.order_id === pick.id)!.customer_first_name).toBe('Mariana');
    expect(mine.find(o => o.order_id === deliv.id)!.customer_first_name).toBeNull();
    expect(await err(kitchenRepository.setStatus(sb, pick.id, 'READY'))).toMatch(/TRANSITION_FORBIDDEN/);
    expect(await err(kitchenRepository.setStatus(sb, pendente.id, 'PREPARING'))).toMatch(/TRANSITION_FORBIDDEN/);
    expect((await kitchenRepository.setStatus(sb, pick.id, 'PREPARING')).status).toBe('PREPARING');
    expect((await kitchenRepository.setStatus(sb, pick.id, 'PREPARING')).unchanged).toBe(true);
    await loginAs(USERS.cashierA);
    expect((await kitchenRepository.setStatus(sb, pick.id, 'READY')).status).toBe('READY');
    expect(await err(sb.rpc('kitchen_set_order_status', { p_order_id: pick.id, p_to: 'DELIVERED' }).then(r => { if (r.error) throw r.error; }))).toMatch(/TRANSITION_FORBIDDEN|PICKUP_CODE|check|invalid/i);
    await loginAs(USERS.ownerA);
    const { data: sig } = await sb.from('kitchen_order_signals').select('status').eq('order_id', pick.id).single();
    expect(sig!.status).toBe('READY');
  });

  it('isolamento: outra loja, cliente e entregador não abrem a cozinha', async () => {
    await loginAs(USERS.ownerB);
    expect(await err(kitchenRepository.listOrders(sb, TA))).toMatch(/FORBIDDEN/);
    expect(await err(kitchenRepository.setStatus(sb, deliv.id, 'PREPARING'))).toMatch(/ORDER_NOT_FOUND|FORBIDDEN/);
    const { data: sigB } = await sb.from('kitchen_order_signals').select('order_id').eq('tenant_id', TA);
    expect(sigB || []).toEqual([]);
    await loginAs(USERS.c1);
    expect(await err(kitchenRepository.listOrders(sb, TA))).toMatch(/FORBIDDEN/);
    await loginAs(USERS.driverA);
    expect(await err(kitchenRepository.listOrders(sb, TA))).toMatch(/FORBIDDEN/);
    await loginAs(USERS.ownerA);
    await kitchenRepository.setSettings(TA, false);
    await loginAs(USERS.operatorA);
    expect(await err(kitchenRepository.listOrders(sb, TA))).toMatch(/KITCHEN_DISABLED/);
  });

  it('aparelho anônimo: pareia, PIN, revoga e não cria pedido/cliente (só se login anônimo estiver ligado)', async () => {
    const a = anonClient();
    const { error: signErr } = await a.auth.signInAnonymously();
    if (signErr) { expect(signErr.message).toMatch(/anonymous/i); console.warn('[kitchen e2e] login anônimo desligado no staging: fluxo do aparelho pulado'); return; }
    await loginAs(USERS.ownerA);
    await kitchenRepository.setSettings(TA, true, '4321');
    const c = await kitchenRepository.createCode(TA, 'Tablet anon E2E');
    const rpc = async (fn: string, args: any = {}) => { const r = await a.rpc(fn, args); if (r.error) throw r.error; return r.data; };
    expect(await err(rpc('redeem_kitchen_pairing_code', { p_code: 'ZZZZZZZZ', p_device_name: 'x' }))).toMatch(/PAIRING_CODE_INVALID/);
    const dev: any = await rpc('redeem_kitchen_pairing_code', { p_code: c.code, p_device_name: 'Tablet anon E2E' });
    expect(dev.tenant_id).toBe(TA);
    expect(await err(rpc('kitchen_list_orders'))).toMatch(/KITCHEN_LOCKED/);
    expect(await err(rpc('kitchen_unlock', { p_pin: '0000' }))).toMatch(/PIN_INVALID/);
    await rpc('kitchen_unlock', { p_pin: '4321' });
    expect(Array.isArray(await rpc('kitchen_list_orders'))).toBe(true);
    // anônimo bloqueado de qualquer dado de cliente
    expect(await err(rpc('create_public_order', { p_slug: SLUG_A }))).not.toBe('OK');
    const ins = await a.from('customers').insert({ tenant_id: TA, name: 'x', phone: '1' }); expect(ins.error).not.toBeNull();
    const sel = await a.from('orders').select('id').limit(1); expect(sel.data || []).toEqual([]);
    // código de uso único
    const b = anonClient(); await b.auth.signInAnonymously();
    expect(await err(b.rpc('redeem_kitchen_pairing_code', { p_code: c.code, p_device_name: 'y' }).then(r => { if (r.error) throw r.error; }))).toMatch(/PAIRING_CODE_INVALID/);
    // revogar
    await loginAs(USERS.ownerA);
    await kitchenRepository.revokeDevice(dev.device_id);
    expect(await err(rpc('kitchen_list_orders'))).toMatch(/KITCHEN_DEVICE_REVOKED/);
  });
});
