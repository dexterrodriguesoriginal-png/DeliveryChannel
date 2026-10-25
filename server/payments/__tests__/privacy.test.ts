import { afterEach,describe,expect,it,vi } from 'vitest';
import { PaymentStore } from '../store';
import { confirmationRecord,chargeRecord,paymentLog,isRuntimeArtifactPath } from '../privacy';
import { runPaymentRetention,startPaymentRetention } from '../retention';
import { legalDocuments,LEGAL_VERSION } from '../../../src/lib/legal/documents';
import { readFileSync } from 'node:fs';
const sql=readFileSync('supabase/migrations/20261024004000_payment_privacy_retention.sql','utf8');
const rollback=readFileSync('supabase/rollback/20261024004000_payment_privacy_retention_down.sql','utf8');
const confirmed={ providerPaymentId:'123',orderId:'order-1',amountCents:1000,currency:'BRL',paid:true,rawStatus:'PAID' };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('payment data minimization and log boundaries',() => {
 it('persists only an explicit confirmation projection, even when the adapter returns personal/card/webhook data',async () => {
  const rpc=vi.fn(async () => ({data:null,error:null})); const store=new PaymentStore({rpc} as any);
  await store.confirm('payment-1',{...confirmed,name:'NOME_SENSIVEL',email:'email@example.com',cpf:'12345678909',card:{number:'4111111111111111'},rawBody:'PAYLOAD'} as any);
  const payload=rpc.mock.calls[0] as any;
  expect(payload[1].p_confirmation).toEqual({...confirmed,rawStatus:'paid'});
  expect(JSON.stringify(payload)).not.toMatch(/NOME_SENSIVEL|email@example|12345678909|4111111111111111|PAYLOAD/);
 });
 it('never persists card or payer fields from a charge response',async () => {
  const rpc=vi.fn(async () => ({data:null,error:null})); const store=new PaymentStore({rpc} as any);
  await store.saveCharge('p',{providerPaymentId:'123',manualConfirmation:false,card:{number:'4111111111111111'},payer:{email:'private@example.com'},rawWebhook:'private-payload'} as any);
  expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/4111111111111111|private@example|private-payload/);
  expect(chargeRecord({providerPaymentId:'123',manualConfirmation:false})).not.toHaveProperty('card');
 });
 it('replaces arbitrary provider status text and rejects personal data in technical ID fields',() => {
  expect(confirmationRecord({...confirmed,rawStatus:'CPF 12345678909 email@example.com'}).rawStatus).toBe('unknown');
  expect(() => confirmationRecord({...confirmed,providerPaymentId:'private@example.com'})).toThrow();
 });
 it('keeps both compiled server entrypoints private, including URL-encoded paths',() => {
  for (const path of ['/server.cjs','/payment-retention.cjs','/%70ayment-retention.cjs','/%73erver.cjs.map','/%ZZ']) expect(isRuntimeArtifactPath(path)).toBe(true);
  expect(isRuntimeArtifactPath('/assets/app.js')).toBe(false);
 });
 it('emits only fixed event codes and numeric counts, never arbitrary properties/text',() => {
  const log=vi.spyOn(console,'info').mockImplementation(() => {});
  paymentLog('retention_completed',12); paymentLog('retention_failed','secret-token' as any); paymentLog('email@example.com' as any,4);
  expect(log.mock.calls.map(c=>JSON.parse(c[0]))).toEqual([{scope:'payments',event:'retention_completed',count:12},{scope:'payments',event:'retention_failed'}]);
 });
});
describe('five-year retention scheduler',() => {
 it('uses bounded DB batches, no client date or tenant parameter, and preserves records rather than deleting them',async () => {
  const rpc=vi.fn().mockResolvedValueOnce(500).mockResolvedValueOnce(13);
  expect(await runPaymentRetention({rpc})).toBe(513);
  expect(rpc.mock.calls).toEqual([['anonymize_expired_payments',{p_limit:500}],['anonymize_expired_payments',{p_limit:500}]]);
 });
 it('bounds backlog work to ten batches per execution',async () => { const rpc=vi.fn().mockResolvedValue(500); expect(await runPaymentRetention({rpc})).toBe(5000); expect(rpc).toHaveBeenCalledTimes(10); });
 it('runs on startup and each 24h, with no overlapping run, and logs no raw DB error',async () => {
  vi.useFakeTimers(); const log=vi.spyOn(console,'info').mockImplementation(() => {});
  const rpc=vi.fn().mockRejectedValueOnce(new Error('cpf=12345678909 token=SECRET')).mockResolvedValue(0);
  const stop=startPaymentRetention({}, {rpc} as any);
  await vi.advanceTimersByTimeAsync(0); expect(rpc).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(24*60*60_000); expect(rpc).toHaveBeenCalledTimes(2);
  stop(); await vi.advanceTimersByTimeAsync(24*60*60_000); expect(rpc).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/12345678909|SECRET/);
 });
 it('does not start a timer without server database configuration',() => { vi.useFakeTimers(); startPaymentRetention({},null)(); expect(vi.getTimerCount()).toBe(0); });
});
describe('LGPD migration contracts, erasure hooks and fiscal preservation (offline)',() => {
 it('retains financial records for five calendar years using the DB clock, then strips identifying links',() => {
  expect(sql).toContain("coalesce(NEW.paid_at,NEW.created_at)+interval '5 years'");
  const maintenance=sql.split('CREATE FUNCTION public.anonymize_expired_payments')[1].split('END; $$;')[0];
  expect(maintenance).toContain('p.retain_until<=statement_timestamp()'); expect(maintenance).toContain('FOR UPDATE SKIP LOCKED');
  expect(maintenance).toContain('SET order_id=NULL,tenant_id=NULL,anonymized_at=');
  expect(maintenance).not.toMatch(/DELETE FROM public.order_payments|SET amount|SET paid_at|SET created_at/);
 });
 it('erases links when a deletion request is processed, on physical auth deletion and on customer unlink/deletion',() => {
  expect(sql).toContain("NEW.status='PROCESSED'");
  expect(sql).toContain('BEFORE DELETE ON auth.users'); expect(sql).toContain('BEFORE DELETE OR UPDATE OF user_id ON public.customers');
  const erase=sql.split('CREATE FUNCTION public._erase_customer_payment_links')[1].split('END; $$;')[0];
  expect(erase).toContain('c.user_id=p_user'); expect(erase).toContain('order_id=NULL,provider_payment_id=NULL,anonymized_at=now()');
  expect(erase).not.toMatch(/SET amount|SET paid_at|SET created_at/);
  expect(sql).toContain('CREATE TABLE private.payment_erased_orders'); expect(sql).toContain('ALTER TABLE private.payment_erased_orders ENABLE ROW LEVEL SECURITY');
  expect(sql).toContain('WHERE e.order_id=NEW.order_id');
 });
 it('immediately deletes OAuth, refresh, webhook credentials and pending states on disconnect/store erasure, without a pending-payment exception',() => {
  const disconnect=sql.split('CREATE FUNCTION public._payment_disconnect_guard')[1].split('END; $$;')[0];
  for(const table of ['private.store_payment_credentials','private.payment_oauth_states','private.order_payment_webhook_tokens']) expect(disconnect).toContain('DELETE FROM '+table);
  expect(disconnect).toContain('OLD.connection_version+1');
  expect(sql).toContain('BEFORE DELETE OR UPDATE OF status ON public.tenants');
  expect(sql.split('CREATE OR REPLACE FUNCTION public.configure_store_payment')[1]).not.toContain('Aguarde os pagamentos pendentes');
  expect(sql).toContain('a.connection_version=p_version'); expect(sql).toContain('c.ciphertext=p_key');
 });
 it('uses hardened functions, restricts maintenance to the server, and cannot undo anonymization in rollback',() => {
  for(const header of [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.\w+\([^]*?AS \$\$/g)].map(m=>m[0])) expect(header).toContain("SET search_path = ''");
  expect(sql).toContain('REVOKE ALL ON FUNCTION public.anonymize_expired_payments(integer) FROM PUBLIC, anon, authenticated');
  expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.anonymize_expired_payments(integer) TO service_role');
  expect(rollback).not.toMatch(/DELETE FROM public.order_payments|DROP TABLE.*public.order_payments|SET NOT NULL/);
 });
});
describe('privacy policy and merchant terms',() => {
 it.each(['privacy','terms-owner'] as const)('discloses providers, contract basis, card isolation, retention and deletion in %s',document => {
  const text=legalDocuments[document].sections.map(s=>s.p).join(' ');
  for(const phrase of ['Mercado Pago','PagBank','InfinitePay','operadores','controladores independentes','execução de contrato','art. 7º, V','5 anos','valor e data','imediatamente','checkout hospedado']) expect(text).toContain(phrase);
 });
 it('bumps the acceptance version on both server and UI, preserving previous acceptance history',() => {
  expect(LEGAL_VERSION).toBe('2026-10-24.1'); expect(sql).not.toContain('_legal_version()'); // bump only in a coordinated release
  expect(sql).not.toMatch(/DELETE FROM public.legal_acceptances|UPDATE public.legal_acceptances/);
 });
});
