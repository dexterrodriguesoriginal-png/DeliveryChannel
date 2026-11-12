import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const tenant='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002';
const product=n=>`20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const user='30000000-0000-0000-0000-000000000001',stranger='30000000-0000-0000-0000-000000000002';
const session='40000000-0000-0000-0000-000000000001',session2='40000000-0000-0000-0000-000000000002';
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION public._tenant_role_of_caller(uuid) RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN auth.uid()='${user}'::uuid THEN 'OWNER' END $$;
CREATE TABLE tenants(id uuid PRIMARY KEY, status text);
CREATE TABLE products(id uuid,tenant_id uuid,name text,price numeric,is_active boolean,stock_quantity numeric,PRIMARY KEY(tenant_id,id));
CREATE TABLE orders(id uuid PRIMARY KEY,tenant_id uuid,created_at timestamptz,status text,payment_status text,tab_id uuid,ordered_by_session_id uuid);
CREATE TABLE order_items(id uuid PRIMARY KEY,order_id uuid,product_id uuid,product_name text,quantity integer,notes text);
CREATE TABLE order_item_options(tenant_id uuid,order_item_id uuid,group_id uuid,option_id uuid,qty integer,fraction numeric,group_name_snapshot text,option_name_snapshot text);
CREATE TABLE tab_sessions(id uuid,tenant_id uuid,tab_id uuid,auth_user_id uuid,approved_at timestamptz,ended_at timestamptz,expires_at timestamptz);
CREATE TABLE dining_tabs(id uuid,tenant_id uuid,status text);
INSERT INTO tenants VALUES('${tenant}','ACTIVE'),('${other}','ACTIVE');
INSERT INTO dining_tabs VALUES('${tenant}','${tenant}','OPEN');
INSERT INTO tab_sessions VALUES('${session}','${tenant}','${tenant}','${user}',now(),null,now()+interval '1 hour'),('${session2}','${tenant}','${tenant}','${user}',now(),null,now()+interval '1 hour');
SELECT set_config('test.uid','${user}',false);`);
for(let i=1;i<=5;i++)await db.query('INSERT INTO products VALUES($1,$2,$3,10,true,100)',[product(i),i===5?other:tenant,`Produto ${i}`]);
let seq=0;
async function order(p,qty,{shop=tenant,days=1,status='DELIVERED',payment='PAID',sid=session}={}){
 const id=`50000000-0000-0000-0000-${String(++seq).padStart(12,'0')}`;
 await db.query("INSERT INTO orders VALUES($1,$2,now()-$3*interval '1 day',$4,$5,$2,$6)",[id,shop,days,status,payment,sid]);
 await db.query('INSERT INTO order_items VALUES($1,$1,$2,$3,$4,$5)',[id,product(p),`Produto ${p}`,qty,'Sem cebola']);return id;
}
const mine=await order(1,5);await order(2,4);await order(3,3);await order(4,2);
await order(4,100,{days:31});await order(4,100,{status:'CANCELLED'});await order(4,100,{payment:'REFUNDED'});
await order(4,100,{status:'PENDING',payment:'PENDING'});await order(5,100,{shop:other});
await order(2,1,{sid:session2});
const migration=readFileSync('supabase/migrations/20261112000100_reorder_best_sellers.sql','utf8');
const rollback=readFileSync('supabase/rollback/20261112000100_reorder_best_sellers.sql','utf8');
const baseline=readFileSync('supabase/migrations/20261110000100_entrega3_totem_senha_pagamento.sql','utf8');
await db.exec(baseline.slice(baseline.indexOf('CREATE OR REPLACE FUNCTION public.create_totem_order('),baseline.indexOf('CREATE OR REPLACE FUNCTION public.get_totem_payment_status(')));
const originalTotem=(await db.query("SELECT pg_get_functiondef('public.create_totem_order(text,jsonb,uuid)'::regprocedure) def")).rows[0].def;
await db.exec(migration);
let rows=(await db.query('SELECT * FROM get_menu_best_sellers($1)',[tenant])).rows;
assert.deepEqual(rows,[{product_id:product(1),position:1},{product_id:product(2),position:2},{product_id:product(3),position:3}]);
assert.deepEqual(Object.keys(rows[0]),['product_id','position']);
assert.deepEqual((await db.query('SELECT * FROM get_menu_best_sellers($1)',[other])).rows,[{product_id:product(5),position:1}]);
await db.query('SELECT set_menu_best_seller_settings($1,false,$2)',[tenant,[]]);
assert.equal((await db.query('SELECT * FROM get_menu_best_sellers($1)',[tenant])).rows.length,0);
await assert.rejects(db.query('SELECT set_menu_best_seller_settings($1,true,$2)',[tenant,[product(5)]]));
await db.query('SELECT set_menu_best_seller_settings($1,true,$2)',[tenant,[product(4),product(1)]]);
assert.deepEqual((await db.query('SELECT * FROM get_menu_best_sellers($1)',[tenant])).rows.map(r=>r.product_id),[product(4),product(1)]);
await db.exec(`INSERT INTO order_item_options VALUES('${tenant}','${mine}','${product(10)}','${product(11)}',2,0.5,'Sabores','Queijo')`);
const history=(await db.query('SELECT get_session_reorder_items($1) items',[session])).rows[0].items;
assert(history.every(i=>i.id!==`50000000-0000-0000-0000-${String(seq).padStart(12,'0')}`));
assert.deepEqual(history.find(i=>i.id===mine).options,[{groupId:product(10),optionId:product(11),qty:2,fraction:0.5}]);
assert.equal(history.find(i=>i.id===mine).notes,'Sem cebola');
// Authorization must remain valid at the moment of each history lookup.
for (const [disable,restore] of [
 ["approved_at=NULL","approved_at=now()"],
 ["ended_at=now()","ended_at=NULL"],
 ["expires_at=now()-interval '1 second'","expires_at=now()+interval '1 hour'"],
]) {
 await db.exec(`UPDATE tab_sessions SET ${disable} WHERE id='${session}'`);
 await assert.rejects(db.query('SELECT get_session_reorder_items($1)',[session]),/FORBIDDEN/);
 await db.exec(`UPDATE tab_sessions SET ${restore} WHERE id='${session}'`);
}
await db.exec("UPDATE dining_tabs SET status='CLOSED'");
await assert.rejects(db.query('SELECT get_session_reorder_items($1)',[session]),/FORBIDDEN/);
await db.exec("UPDATE dining_tabs SET status='OPEN'");
assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='menu_best_seller_settings'::regclass")).rows[0].relrowsecurity,true);
await db.exec('SET ROLE authenticated');
await assert.rejects(db.query('SELECT * FROM menu_best_seller_settings'),/permission denied/);
await assert.rejects(db.query('UPDATE menu_best_seller_settings SET enabled=false'),/permission denied/);
await db.exec('RESET ROLE');
assert.deepEqual((await db.query('SELECT * FROM get_menu_best_sellers($1)',[product(99)])).rows,[]);
await db.exec(`SELECT set_config('test.uid','${stranger}',false)`);
await assert.rejects(db.query('SELECT get_session_reorder_items($1)',[session]));
await assert.rejects(db.query('SELECT set_menu_best_seller_settings($1,false,$2)',[tenant,[]]));
await db.exec(`SET ROLE anon`);
assert((await db.query('SELECT * FROM get_menu_best_sellers($1)',[tenant])).rows.length>0);
await assert.rejects(db.query('SELECT * FROM menu_best_seller_settings'));
await assert.rejects(db.query('SELECT get_session_reorder_items($1)',[session]));
await db.exec('RESET ROLE');
const funcs=(await db.query("SELECT prosecdef,proconfig FROM pg_proc WHERE proname IN ('get_menu_best_sellers','get_session_reorder_items')")).rows;
assert(funcs.every(f=>f.prosecdef&&f.proconfig.some(s=>s.startsWith('search_path='))));
await db.exec(rollback);
assert.equal((await db.query("SELECT pg_get_functiondef('public.create_totem_order(text,jsonb,uuid)'::regprocedure) def")).rows[0].def,originalTotem);
assert.equal((await db.query("SELECT to_regprocedure('public.get_menu_best_sellers(uuid)') f")).rows[0].f,null);
assert.equal((await db.query("SELECT to_regclass('public.menu_best_seller_settings') t")).rows[0].t,null);
assert.equal((await db.query('SELECT count(*)::int n FROM order_items')).rows[0].n,seq);
await db.exec(migration);await db.exec(rollback);
await db.close();
console.log('PGlite: ranking, isolamento por loja/sessão, privilégios, adicionais, configuração e rollback OK');
