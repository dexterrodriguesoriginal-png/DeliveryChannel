import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const M1 = read('supabase/migrations/20261109000100_cardapio_capa_menu.sql');
const M2 = read('supabase/migrations/20261109000200_totem_salao_capa.sql');
const M3 = read('supabase/migrations/20261109000300_totem_access_and_design.sql');
const stub = read('supabase/tests/entrega3/stub.sql');
const extra = read('supabase/tests/totem_access/stub_extra.sql');

const T = '11111111-1111-1111-1111-111111111111';
const O = '22222222-2222-2222-2222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STAFF = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CASHIER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const P1 = 'd0000000-0000-0000-0000-0000000000a1';
const PINACTIVE = 'd0000000-0000-0000-0000-0000000000a2';
const POTHER = 'd0000000-0000-0000-0000-0000000000b1';

const db = new PGlite();
let failed = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log('PASS', name);
  else { failed++; console.log('FAIL', name, detail || ''); }
};

async function exec(sql) { await db.exec(sql); }
async function query(sql, params = []) { return db.query(sql, params); }
async function expectOk(name, sql, params = []) {
  try { const r = await query(sql, params); console.log('PASS', name); return r; }
  catch (e) { failed++; console.log('FAIL', name, 'unexpected error:', e.message); return null; }
}
async function expectErr(name, sql, params = [], match) {
  try { const r = await query(sql, params); failed++; console.log('FAIL', name, 'unexpected OK', JSON.stringify(r.rows)); }
  catch (e) {
    if (match && !String(e.message).includes(match)) { failed++; console.log('FAIL', name, 'wrong error:', e.message); }
    else console.log('PASS', name, '→', String(e.message).split('\n')[0]);
  }
}

async function asRole(role, uid = OWNER) {
  await exec(`DELETE FROM public.caller`);
  if (role) await exec(`INSERT INTO public.caller VALUES ('${uid}', '${role}')`);
}

async function setupBase() {
  await exec(stub);
  await exec(M1);
  await exec(M2);
  await exec(extra.replace("ARRAY['status','payment_status'", "ARRAY['awaiting_online_payment','status','payment_status'"));
}

await setupBase();
await exec(M3);
await exec(`ALTER TABLE public.orders ADD COLUMN updated_at timestamptz DEFAULT now(), ADD COLUMN awaiting_online_payment boolean NOT NULL DEFAULT false;`);

await exec(`CREATE TABLE IF NOT EXISTS public.pickup_arrivals (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  pickup_code text NOT NULL,
  closed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pickup_arrivals_open_code ON public.pickup_arrivals(tenant_id,pickup_code) WHERE closed_at IS NULL;
CREATE OR REPLACE FUNCTION public._new_pickup_code(p_tenant uuid) RETURNS text LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x text;
BEGIN
 FOR x IN SELECT lpad(n::text,3,'0') FROM generate_series(100,999) n LOOP
  IF NOT EXISTS(SELECT 1 FROM public.pickup_arrivals WHERE tenant_id=p_tenant AND pickup_code=x AND closed_at IS NULL) THEN RETURN x; END IF;
 END LOOP;
 RAISE EXCEPTION 'NO_CODE';
END $$;`);
await exec(read('supabase/migrations/20261019002100_pickup_arrival_queue.sql').match(/CREATE OR REPLACE FUNCTION public\._orders_pickup_arrival_sync\(\)[\s\S]*?END;?\s*\$\$;/)[0]);
await exec(`CREATE TRIGGER trg_orders_pickup_arrival_ins AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public._orders_pickup_arrival_sync();
CREATE TRIGGER trg_orders_pickup_arrival_upd AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public._orders_pickup_arrival_sync();`);
const M4 = read('supabase/migrations/20261110000100_entrega3_totem_senha_pagamento.sql');
const M5 = read('supabase/migrations/20261110000300_entrega3_online_payment_guard.sql');
const M5down = read('supabase/rollback/20261110000300_entrega3_online_payment_guard_down.sql');
await exec(read('supabase/tests/entrega3/online_payment_guard.sql'));
console.log('LIVE_GUARD_OK');
await exec(M4);
console.log('M4_OK');
await exec(M5);
console.log('M5_OK');

await asRole('OWNER');
await expectOk('cria usuário', `select public.admin_create_totem_user($1,'Totem','totem01','senha1234')`,[T]);
await asRole(null);
const activated = await expectOk('ativa totem', `select public.totem_activate('loja','totem01','senha1234','Terminal 1',false,'ip') j`);
const token = activated?.rows?.[0]?.j?.token;
ok('token existe', Boolean(token));
const items = JSON.stringify([{ productId:P1, quantity:2, price:0, tenant_id:O }]);
const key='c0000000-0000-0000-0000-000000000001';
await expectErr('token inválido',`select public.create_totem_order('invalid',$1::jsonb,$2::uuid)`,[items,key],'TOTEM_DEVICE_INVALID');
const created = await expectOk('pedido aguarda pagamento', `select public.create_totem_order($1,$2::jsonb,$3::uuid) j`,[token,items,key]);
const initial=created?.rows?.[0]?.j;
ok('não libera senha antes do pagamento',initial?.paymentStatus==='PENDING' && !initial.pickupCode);
ok('total no servidor',Number(initial?.total)===25.8);
const orderId=initial?.orderId;
const before=await expectOk('pedido pendente no banco',`select status,payment_status from public.orders where id=$1`,[orderId]);
ok('cozinha bloqueada',before?.rows?.[0]?.status==='PENDING' && before.rows[0].payment_status==='PENDING');
const gate=await query('select awaiting_online_payment from public.orders where id=$1',[orderId]);
ok('gate cozinha/relatórios ativo',gate.rows[0].awaiting_online_payment);
ok('sem senha no banco', (await query('select * from public.pickup_arrivals where order_id=$1',[orderId])).rows.length===0);
await expectErr('totem anônimo não aprova', 'select public.confirm_manual_totem_payment($1)',[orderId],'AUTH_REQUIRED');
await expectErr('UPDATE pago bloqueado',"update public.orders set payment_status='PAID' where id=$1",[orderId],'TOTEM_PAYMENT_FORBIDDEN');
await expectErr('avanço cozinha bloqueado',"update public.orders set status='PREPARING' where id=$1",[orderId],'TOTEM_PAYMENT_REQUIRED');
const again=await expectOk('repetição idempotente',`select public.create_totem_order($1,$2::jsonb,$3::uuid) j`,[token,items,key]);
ok('mesmo pedido sem senha',again?.rows?.[0]?.j?.orderId===orderId && !again.rows[0].j.pickupCode);
await asRole('STAFF',STAFF);
await expectErr('papel proibido',`select public.confirm_manual_totem_payment($1::uuid)`,[orderId],'FORBIDDEN');
await asRole('CASHIER',CASHIER);
const confirmed=await expectOk('caixa confirma no PDV',`select public.confirm_manual_totem_payment($1::uuid) j`,[orderId]);
ok('senha só após aprovação',/^[0-9]{3,4}$/.test(confirmed?.rows?.[0]?.j?.pickupCode||''));
const result=await expectOk('consultar pago',`select public.get_totem_payment_status($1,$2::uuid) j`,[token,orderId]);
ok('consulta mantém mesma senha',result?.rows?.[0]?.j?.pickupCode===confirmed?.rows?.[0]?.j?.pickupCode && result.rows[0].j.paymentStatus==='PAID');
const count=await expectOk('uma tentativa',`select count(*)::int n from public.totem_payment_attempts where order_id=$1`,[orderId]);
ok('idempotência impede segunda cobrança',count?.rows?.[0]?.n===1);
const cancelled=await expectOk('consulta tentativa aprovada',`select status from public.totem_payment_attempts where order_id=$1`,[orderId]);
ok('tentativa aprovada',cancelled?.rows?.[0]?.status==='approved');

await expectErr('pago não cancela',`select public.cancel_totem_payment($1,$2)`,[token,orderId],'TOTEM_ALREADY_PAID');
await expectOk('aprovação idempotente',`select public.confirm_manual_totem_payment($1)`,[orderId]);
ok('auditoria única',(await query('select * from public.test_audit')).rows.length===1);
ok('gate liberado após aprovação',!(await query('select awaiting_online_payment from public.orders where id=$1',[orderId])).rows[0].awaiting_online_payment);
await exec(`UPDATE public.caller SET tenant_id='${O}'`);
await expectErr('staff outra loja não aprova',`select public.confirm_manual_totem_payment($1)`,[orderId],'FORBIDDEN');
await expectErr('staff outra loja não lista',`select public.list_pending_totem_payments($1)`,[T],'FORBIDDEN');
await asRole('OWNER');
await expectErr('provedores desativados',`select public.set_totem_payment_settings($1,'mercadopago_point',240,false,false)`,[T],'INVALID_TOTEM_SETTINGS');
await expectErr('produto outra loja',`select public.create_totem_order($1,$2,gen_random_uuid())`,[token,JSON.stringify([{productId:POTHER,quantity:1}])],'INVALID_TOTEM_ORDER');
await expectErr('quantidade ausente',`select public.create_totem_order($1,$2,gen_random_uuid())`,[token,JSON.stringify([{productId:P1}])],'INVALID_TOTEM_ORDER');
await expectErr('produto inativo',`select public.create_totem_order($1,$2,gen_random_uuid())`,[token,JSON.stringify([{productId:PINACTIVE,quantity:1}])],'INVALID_TOTEM_ORDER');
const otherDevice=(await query(`select public.totem_activate_as_staff('loja','Outro dispositivo') j`)).rows[0].j.token;
await expectErr('outro dispositivo não consulta',`select public.get_totem_payment_status($1,$2)`,[otherDevice,orderId],'TOTEM_ORDER_NOT_FOUND');
await expectErr('outro dispositivo não cancela',`select public.cancel_totem_payment($1,$2)`,[otherDevice,orderId],'TOTEM_ORDER_NOT_FOUND');
const second=(await query(`select public.create_totem_order($1,$2,gen_random_uuid()) j`,[token,items])).rows[0].j.orderId;
await exec(`UPDATE public.totem_payment_attempts SET expires_at=now()-interval '1 second' WHERE order_id='${second}'`);
await expectErr('expirado não aprova',`select public.confirm_manual_totem_payment($1)`,[second],'TOTEM_PAYMENT_EXPIRED_OR_CANCELLED');
ok('expiração sem senha',(await query(`select public.get_totem_payment_status($1,$2) j`,[token,second])).rows[0].j.paymentStatus==='EXPIRED');
await asRole('OWNER');
const rollbackKey='c0000000-0000-0000-0000-0000000000bb';
const pendingDown=(await query(`select public.create_totem_order($1,$2, $3::uuid) j`,[token,items,rollbackKey])).rows[0].j.orderId;
await exec(M5down);
console.log('M5_DOWN_OK');
await expectErr('sem 00300 o PDV continua bloqueado',`select public.confirm_manual_totem_payment($1)`,[pendingDown],'PAYMENT_REQUIRED');
await exec(M5);
console.log('M5_REAPPLY_OK');
await asRole('CASHIER',CASHIER);
const reapplied=await expectOk('caixa confirma após reaplicar 00300',`select public.confirm_manual_totem_payment($1::uuid) j`,[pendingDown]);
ok('senha após reaplicar 00300',/^[0-9]{3,4}$/.test(reapplied?.rows?.[0]?.j?.pickupCode||''));
await asRole('OWNER');
await exec(`SET ROLE anon`);
await expectErr('anon sem acesso tabela',`select * from public.totem_payment_attempts`,[],'permission denied');
await expectErr('anon sem acesso helper de aprovação',`select public._totem_approve_payment($1,$2)`,[orderId,OWNER],'permission denied');
await exec('RESET ROLE; SET ROLE authenticated');
await expectErr('staff sem escrita direta de tentativas',`update public.totem_payment_attempts set status='approved'`,[],'permission denied');
await exec('RESET ROLE');
const down=read('supabase/rollback/20261110000100_entrega3_totem_senha_pagamento_down.sql');
try { await exec(down); failed++; console.log('FAIL rollback deveria bloquear dados'); }
catch(e) { ok('rollback bloqueia dados',e.message.includes('ROLLBACK_BLOCKED')); await exec('ROLLBACK'); }
ok('rollback bloqueado mantém RPC',(await query(`select to_regprocedure('public.confirm_manual_totem_payment(uuid,text)') is not null ok`)).rows[0].ok);
await exec('DELETE FROM public.totem_payment_attempts; DELETE FROM public.totem_payment_settings;');
await exec(down);
ok('rollback vazio',true);
ok('rollback remove tabelas',(await query(`select to_regclass('public.totem_payment_attempts') is null ok`)).rows[0].ok);
await exec(M4);
await exec(M5);
ok('migration reaplicável após rollback',true);
console.log('FAILURES',failed);
await db.close();
if(failed)process.exitCode=1;
