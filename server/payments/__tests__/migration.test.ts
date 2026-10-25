import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync('supabase/migrations/20261024003900_store_online_payments.sql','utf8');
const rollback = readFileSync('supabase/rollback/20261024003900_store_online_payments_down.sql','utf8');
const functions = [...sql.matchAll(/CREATE FUNCTION public\.(\w+)\([^]*?END; \$\$;/g)].map(m => m[0]);
describe('offline SQL security contracts (runtime RLS suite is supplied separately)', () => {
  it('enables RLS on every new public/private table', () => {
    const tables = [...sql.matchAll(/CREATE TABLE ((?:public|private)\.\w+)/g)].map(m => m[1]);
    expect(tables).toHaveLength(5);
    for (const table of tables) expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  });
  it('uses empty search_path and restricts every SECURITY DEFINER entry point', () => {
    expect(functions).toHaveLength(7);
    for (const fn of functions) {
      expect(fn).toContain("SECURITY DEFINER SET search_path = ''");
      const name = fn.match(/CREATE FUNCTION public\.(\w+)/)![1];
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*FROM PUBLIC, anon, authenticated`));
    }
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]+TO (?:PUBLIC|anon|authenticated)/);
  });
  it('never exposes private ciphertext tables even to the service-role table API', () => {
    for (const table of ['private.store_payment_credentials','private.payment_oauth_states','private.order_payment_webhook_tokens']) expect(sql).toMatch(new RegExp(`REVOKE ALL ON [^;]*${table.replaceAll('.','\\.')}[^;]*FROM PUBLIC, anon, authenticated, service_role`));
    expect(sql).not.toMatch(/GRANT .*ON private\./);
  });
  it('limits public account reads to scoped owners/managers and disallows anon', () => {
    const policy = sql.split('CREATE POLICY payment_accounts_staff')[1].split(';')[0];
    expect(policy).toContain("public.has_tenant_scoped_role(tenant_id, ARRAY['OWNER','MANAGER'])");
    expect(policy).not.toMatch(/CEO|SUPER_ADMIN|anon/);
    expect(sql).toContain('REVOKE ALL ON public.store_payment_accounts FROM PUBLIC, anon, authenticated');
  });
  it('derives tenant from membership and orders, and locks orders before reserving/confirming', () => {
    expect(sql).toContain("tu.id=p_membership AND tu.user_id=p_user AND tu.status='ACTIVE'");
    expect(sql).toContain('SELECT * INTO v_order FROM public.orders WHERE id=p_order FOR UPDATE');
    expect(sql).toContain('VALUES(p_order,v_order.tenant_id,p_provider,p_method,v_order.total_amount');
    expect(sql).toContain('SELECT * INTO v_order FROM public.orders WHERE id=v_order_id FOR UPDATE');
  });
  it('checks confirmed amount, currency and order, with unique provider identity and no split', () => {
    expect(sql).toContain('UNIQUE (provider, provider_payment_id)');
    expect(sql).toContain('order_id uuid NOT NULL UNIQUE');
    expect(sql).toContain("(p_confirmation->>'currency') IS DISTINCT FROM 'BRL'");
    expect(sql).toContain("(p_confirmation->>'amountCents')::numeric IS DISTINCT FROM (v_order.total_amount*100)");
    expect(sql).toContain("(p_confirmation->>'orderId') IS DISTINCT FROM v_payment.order_id::text");
    expect(sql).toContain('application_fee IS NULL OR application_fee = 0');
  });
  it('blocks legacy paid updates and admits manual confirmation only for manual adapters', () => {
    expect(sql).toContain("v_payment.provider NOT IN ('manual_pix','infinitepay')");
    expect(sql).toContain("v_payment.provider NOT IN ('mercadopago','pagbank')");
    expect(sql).toContain("current_setting('role',true) IS DISTINCT FROM 'service_role'");
    expect(sql).toContain('BEFORE UPDATE OF payment_status ON public.orders');
    expect(sql).toContain("IF v_payment.status='paid' THEN RETURN");
  });
  it('supplies a rollback for every new object and does not change old migrations', () => {
    for (const table of [...sql.matchAll(/CREATE TABLE ((?:public|private)\.\w+)/g)].map(m=>m[1])) expect(rollback).toContain(`DROP TABLE IF EXISTS ${table}`);
    for (const fn of functions) expect(rollback).toContain('DROP FUNCTION IF EXISTS public.'+fn.match(/CREATE FUNCTION public\.(\w+)/)![1]);
    expect(rollback).not.toContain('DROP SCHEMA'); expect(sql.trim().endsWith('COMMIT;')).toBe(true);
  });
});
