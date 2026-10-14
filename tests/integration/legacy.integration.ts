/**
 * Integração REAL (VITE_BACKEND_SCHEMA=legacy-020, padrão): repositórios → supabase-js → PostgREST local →
 * PostgreSQL local SOMENTE com 001–020 (estado atual de produção). Prova que o main não chama RPCs inexistentes
 * em produção e que recursos N1–N6 falham com N1N6_REQUIRED (sem localStorage/mock).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../src/lib/supabase', async () => {
  const m = await import('./localClient');
  return { supabase: m.localSupabase, isSupabaseConfigured: true, ensureValidSession: async () => true };
});

import { loginAs, localSupabase } from './localClient';
import { orderRepository } from '../../src/repositories/orderRepository';
import { tenantRepository } from '../../src/repositories/tenantRepository';
import { publicStoreRepository } from '../../src/repositories/publicStoreRepository';
import { offerRepository } from '../../src/repositories/offerRepository';
import { campaignRepository } from '../../src/repositories/campaignRepository';
import { isN1N6Backend } from '../../src/lib/backendSchema';
import { newIdempotencyKey } from '../../src/lib/backend';

const T = '10000000-0000-0000-0000-00000000000a';
const OWNER = 'a0000000-0000-0000-0000-000000000001';
const CASHIER = 'a0000000-0000-0000-0000-000000000004';
const C1 = 'a0000000-0000-0000-0000-000000000007';
const C2 = 'a0000000-0000-0000-0000-000000000008';
const P1 = 'd0000000-0000-0000-0000-0000000000a1';
const ctx = (userId: string, role: any) => ({ userId, userRole: role, userName: 'teste', tenantId: T });
const input = (extra: Record<string, unknown> = {}) => ({
  customerName: 'Cliente Dois', customerPhone: '11977776666', deliveryAddress: 'Rua Legada, 9',
  items: [{ productId: P1, quantity: 2 }], paymentMethod: 'CASH' as const, fulfillmentType: 'DELIVERY' as const,
  origin: 'storefront' as any, ...extra,
});

beforeAll(() => {
  expect(isN1N6Backend()).toBe(false);
});

describe('banco 001–020: RPCs N1–N6 realmente não existem (premissa do modo legacy)', () => {
  it('process_checkout_atomic_v2 inexistente', async () => {
    loginAs(C2);
    const { error } = await localSupabase.rpc('process_checkout_atomic_v2', {});
    expect(error).toBeTruthy();
  });
});

describe('fluxo 2 (legacy) — checkout pelo process_checkout_atomic de 001–020', () => {
  it('cliente autenticado cria pedido com preço do servidor; origem mapeada para o CHECK legado', async () => {
    loginAs(C2);
    const o = await orderRepository.createPublicOrder('adega-a', input());
    expect(o.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(o.subtotal).toBe(20);
  });
  it('visitante anônimo é recusado pelo servidor', async () => {
    loginAs(null);
    await expect(orderRepository.createPublicOrder('adega-a', input())).rejects.toBeTruthy();
  });
  it('cupom e checkout promocional => N1N6_REQUIRED (sem fallback local)', async () => {
    loginAs(C2);
    await expect(orderRepository.createPublicOrder('adega-a', input({ couponCode: 'X' }))).rejects.toMatchObject({ code: 'N1N6_REQUIRED' });
    await expect(orderRepository.createPromotionalOrder('adega-a', { offerId: 'e0000000-0000-0000-0000-0000000000a1', quantity: 1, customerName: 'a', customerPhone: 'b', paymentMethod: 'CASH' } as any))
      .rejects.toMatchObject({ code: 'N1N6_REQUIRED' });
    await expect(orderRepository.validateCoupon({ slug: 'adega-a' }, 'X', [])).rejects.toMatchObject({ code: 'N1N6_REQUIRED' });
  });
});

describe('fluxo 1 (legacy) — status e PDV pelos caminhos de 001–020', () => {
  it('OWNER confirma e cancela com motivo; reabertura bloqueada no cliente', async () => {
    loginAs(C2);
    const o = await orderRepository.createPublicOrder('adega-a', input());
    loginAs(OWNER);
    const c = await orderRepository.updateStatus(ctx(OWNER, 'OWNER'), T, o.id, 'CONFIRMED', undefined, 'PENDING');
    expect(c.status).toBe('CONFIRMED');
    const x = await orderRepository.updateStatus(ctx(OWNER, 'OWNER'), T, o.id, 'CANCELLED', 'teste legado', 'CONFIRMED');
    expect(x.status).toBe('CANCELLED');
    await expect(orderRepository.updateStatus(ctx(OWNER, 'OWNER'), T, o.id, 'PENDING', undefined, 'CANCELLED'))
      .rejects.toMatchObject({ code: 'ORDER_CANCELLED_IS_FINAL' });
  });
  it('001–020 não tem política de INSERT em orders: INSERT direto do staff é negado pelo servidor', async () => {
    loginAs(OWNER);
    const { error } = await localSupabase.from('orders').insert({
      tenant_id: T, customer_name: 'x', customer_phone: '1', delivery_address: 'Balcão', subtotal: 1, delivery_fee: 0,
      discount: 0, total_amount: 1, payment_method: 'CASH', payment_status: 'PAID', fulfillment_type: 'PICKUP', status: 'DELIVERED', origin: 'direct',
    });
    expect(error).toBeTruthy();
  });
  it('PDV e pagamento => N1N6_REQUIRED (sem fallback local)', async () => {
    loginAs(CASHIER);
    await expect(orderRepository.createPosSale(ctx(CASHIER, 'CASHIER'), T, { items: [{ productId: P1, quantity: 3 }], paymentMethod: 'CASH' }))
      .rejects.toMatchObject({ code: 'N1N6_REQUIRED' });
    await expect(orderRepository.updatePaymentStatus(ctx(CASHIER, 'CASHIER'), T, '0d000000-0000-0000-0000-0000000000a1', 'PAID'))
      .rejects.toMatchObject({ code: 'N1N6_REQUIRED' });
  });
});

describe('fluxo 3/5 (legacy) — PIX, vitrine, ofertas e campanhas', () => {
  it('PIX por pedido indisponível; vitrine legada carrega sem chamar RPC inexistente', async () => {
    loginAs(C1);
    await expect(orderRepository.getOrderPixPayload('0d000000-0000-0000-0000-0000000000a1')).rejects.toMatchObject({ code: 'N1N6_REQUIRED' });
    loginAs(null);
    const res = await publicStoreRepository.loadPublicStore('adega-a');
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.data.products.length).toBeGreaterThan(0);
      expect((res.data.settings as any).prepTimeMinutes ?? null).not.toBe(30);
    }
  });
  it('OWNER salva configurações (pix_key legado) e card com checkout promocional sem colunas N4', async () => {
    loginAs(OWNER);
    await tenantRepository.updateSettings(ctx(OWNER, 'OWNER'), T, { pixKey: '52998224725' } as any);
    const t = await tenantRepository.getById(ctx(OWNER, 'OWNER'), T);
    expect(t?.settings.pixKey).toBe('52998224725');
    const created = await offerRepository.create(ctx(OWNER, 'OWNER'), T, {
      title: 'Card legado', imageUrl: 'https://img.test/legado.jpg', destinationType: 'CUSTOM_OFFER', hasPromoCheckout: true, promoPrice: 9, isActive: true,
      mediaType: 'IMAGE', cardFormat: 'HORIZONTAL', displayMode: 'FULL_MEDIA', order: 9,
    } as any);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    await offerRepository.delete(ctx(OWNER, 'OWNER'), T, created.id);
  });
  it('campanhas N5 => N1N6_REQUIRED; evento de funil não é enviado', async () => {
    loginAs(OWNER);
    await expect(campaignRepository.listCampaigns(T)).rejects.toMatchObject({ code: 'N1N6_REQUIRED' });
    expect(await campaignRepository.trackEvent({ storeSlug: 'adega-a', eventType: 'CARD_CLICK', sessionId: newIdempotencyKey() })).toBe(false);
  });
});
