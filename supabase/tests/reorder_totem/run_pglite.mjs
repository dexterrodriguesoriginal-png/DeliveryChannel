import assert from 'node:assert/strict';
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

// Real pricing, option validation/snapshot and payment RPCs on isolated fixtures.
await exec(`ALTER TABLE products ADD COLUMN stock_quantity integer DEFAULT 100, ADD COLUMN unit text DEFAULT 'un';
ALTER TABLE orders ADD COLUMN tab_id uuid, ADD COLUMN ordered_by_session_id uuid;
CREATE TABLE tab_sessions(id uuid,tenant_id uuid,tab_id uuid,auth_user_id uuid,approved_at timestamptz,ended_at timestamptz,expires_at timestamptz);
CREATE TABLE dining_tabs(id uuid,tenant_id uuid,status text);
CREATE TABLE tenant_modules(tenant_id uuid,module_key text,enabled boolean);
INSERT INTO tenant_modules VALUES('${T}','addons',true);
CREATE FUNCTION assert_tenant_module_enabled(uuid,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
CREATE FUNCTION _effective_product_price(uuid,uuid,timestamptz)
RETURNS TABLE(unit_price numeric,original_price numeric,is_promotional boolean,price_source text)
LANGUAGE sql AS $$ SELECT price,price,false,'fixture' FROM public.products WHERE tenant_id=$1 AND id=$2 $$;`);
const optionsMigration=read('supabase/migrations/20261019002500_product_option_groups.sql');
await exec(optionsMigration.slice(optionsMigration.indexOf('CREATE TABLE IF NOT EXISTS public.product_option_groups'), optionsMigration.indexOf('CREATE OR REPLACE FUNCTION public.product_options_public_enabled')));
await exec(optionsMigration.slice(optionsMigration.indexOf('CREATE OR REPLACE FUNCTION public._product_option_selection_price'),optionsMigration.indexOf('CREATE OR REPLACE FUNCTION public._product_option_snapshot_after_order_item')));
const dineIn=read('supabase/migrations/20261019002600_dine_in.sql');
for (const name of ['_normalize_product_option_selections','_product_option_snapshot_after_order_item','_price_items']) {
 const start=dineIn.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');
 const end=dineIn.indexOf('$$;',dineIn.indexOf('AS $$',start))+3;
 await exec(dineIn.slice(start,end));
}
await exec(`CREATE TRIGGER order_item_product_options_snapshot AFTER INSERT ON order_items
FOR EACH ROW EXECUTE FUNCTION _product_option_snapshot_after_order_item();`);
await exec(read('supabase/migrations/20261112000100_reorder_best_sellers.sql'));
await asRole('OWNER');
await query(`SELECT admin_create_totem_user($1,'Totem','totem01','senha1234')`,[T]);
await asRole(null);
const token=(await query(`SELECT totem_activate('loja','totem01','senha1234','Terminal',false,'ip') j`)).rows[0].j.token;
const group='e0000000-0000-0000-0000-000000000001';
const cheese='e0000000-0000-0000-0000-000000000002';
const bacon='e0000000-0000-0000-0000-000000000003';
await exec(`INSERT INTO product_option_groups(id,tenant_id,name,max_select) VALUES('${group}','${T}','Extras',1);
INSERT INTO product_option_group_links(tenant_id,product_id,group_id) VALUES('${T}','${P1}','${group}');
INSERT INTO product_options(id,tenant_id,group_id,name,extra_price_cents) VALUES
('${cheese}','${T}','${group}','Queijo',200),('${bacon}','${T}','${group}','Bacon',200);`);
const option=id=>[{group_id:group,option_id:id,qty:1,fraction:null}];
const lines=[
 {productId:P1,quantity:1,notes:'Sem cebola',options:option(cheese)},
 {productId:P1,quantity:2,notes:'Bem passado',options:option(cheese)},
 {productId:P1,quantity:1,notes:'Com bacon',options:option(bacon)},
 {productId:P1,quantity:1,notes:'Sem adicionais',options:[]},
];
const key='c0000000-0000-0000-0000-000000000001';
const create=(items,k=key)=>query('SELECT create_totem_order($1,$2::jsonb,$3::uuid) j',[token,JSON.stringify(items),k]);
const created=(await create(lines)).rows[0].j;
assert.equal(Number(created.total),72.5);
assert.equal(created.paymentStatus,'PENDING');
assert.equal(created.pickupCode,undefined);
const saved=(await query(`SELECT i.notes,i.quantity,i.unit_price::float8 price,x.option_id FROM order_items i
LEFT JOIN order_item_options x ON x.order_item_id=i.id WHERE i.order_id=$1 ORDER BY i.notes`,[created.orderId])).rows;
assert.deepEqual(saved,[
 {notes:'Bem passado',quantity:2,price:14.9,option_id:cheese},
 {notes:'Com bacon',quantity:1,price:14.9,option_id:bacon},
 {notes:'Sem adicionais',quantity:1,price:12.9,option_id:null},
 {notes:'Sem cebola',quantity:1,price:14.9,option_id:cheese},
]);
assert.equal((await create(lines)).rows[0].j.orderId,created.orderId);
assert.equal((await query('SELECT count(*)::int n FROM totem_payment_attempts WHERE order_id=$1',[created.orderId])).rows[0].n,1);
await asRole('CASHIER',CASHIER);
const paid=(await query('SELECT confirm_manual_totem_payment($1) j',[created.orderId])).rows[0].j;
assert.match(paid.pickupCode,/^[0-9]{3,4}$/);
assert.equal((await query('SELECT get_totem_payment_status($1,$2) j',[token,created.orderId])).rows[0].j.paymentStatus,'PAID');
await exec(`UPDATE products SET price=20 WHERE id='${P1}'`);
const fresh=()=> 'c0000000-0000-0000-0000-'+String(++sequence).padStart(12,'0');
let sequence=10;
const repriced=(await create([lines[0]],fresh())).rows[0].j;
assert.equal(Number(repriced.total),22);
await query('SELECT cancel_totem_payment($1,$2)',[token,repriced.orderId]);
assert.equal((await query('SELECT get_totem_payment_status($1,$2) j',[token,repriced.orderId])).rows[0].j.paymentStatus,'CANCELLED');
await assert.rejects(create([{...lines[0],price:0}],fresh()),/UNEXPECTED_FIELD/);
await assert.rejects(create([{...lines[0],productId:POTHER}],fresh()),/PRODUCT_NOT_FOUND/);
await assert.rejects(create([{...lines[0],productId:PINACTIVE}],fresh()),/PRODUCT_UNAVAILABLE/);
await exec(`UPDATE product_options SET sold_out=true WHERE id='${cheese}'`);
await assert.rejects(create([lines[0]],fresh()),/ADICIONAL_ESGOTADO/);
await exec(`UPDATE product_options SET sold_out=false WHERE id='${cheese}'; UPDATE products SET stock_quantity=2 WHERE id='${P1}'`);
await assert.rejects(create(lines,fresh()),/OUT_OF_STOCK/);
await assert.rejects(create([{...lines[0],quantity:100}],fresh()),/INVALID_TOTEM_ORDER/);
await assert.rejects(create([{...lines[0],notes:'x'.repeat(201)}],fresh()),/INVALID_TOTEM_ORDER/);
assert.equal((await query('SELECT count(*)::int n FROM orders')).rows[0].n,2);
await db.close();
console.log('PGlite: linhas/observações, snapshots de mesmo preço, preço vigente, estoque, adicionais, idempotência, pagamento e cancelamento OK');
