import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { tsImport } from 'tsx/esm/api';
const { priceLineByOrigin } = await tsImport('../../../src/lib/pricing/purchaseOrigin.ts', import.meta.url);
const { computeFulfillmentPricing, DEFAULT_FULFILLMENT_SETTINGS } = await tsImport('../../../src/lib/pricing/fulfillmentPricing.ts', import.meta.url);
const db = new PGlite();
const read = p => fs.readFileSync(p, 'utf8');
const tenant='10000000-0000-0000-0000-000000000001', other='10000000-0000-0000-0000-000000000002';
const product='20000000-0000-0000-0000-000000000001', carousel='30000000-0000-0000-0000-000000000001', item='40000000-0000-0000-0000-000000000001';
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.uid',true),'')::uuid $$;
CREATE TABLE users(id uuid,name text,email text);
CREATE FUNCTION public.is_tenant_owner_or_manager(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.tenant',true)=$1::text AND current_setting('test.role',true) IN ('OWNER','MANAGER') $$;
CREATE TABLE tenants(id uuid PRIMARY KEY,slug text);
CREATE TABLE products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,name text,description text,image_url text NOT NULL,price numeric, promotional_price numeric,stock_quantity int CHECK(stock_quantity>=0),is_active boolean DEFAULT true,unit text DEFAULT 'un',stock_unit text DEFAULT 'un',updated_at timestamptz,UNIQUE(tenant_id,id));
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_fixture ON products TO authenticated USING(public.is_tenant_owner_or_manager(tenant_id)) WITH CHECK(public.is_tenant_owner_or_manager(tenant_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON products TO authenticated;
CREATE TABLE promotion_carousels(id uuid PRIMARY KEY,tenant_id uuid,name text,description text,display_order int DEFAULT 0,cover_asset_id uuid,is_active boolean DEFAULT true,show_in_store boolean DEFAULT true,start_at timestamptz,end_at timestamptz, UNIQUE(tenant_id,id));
CREATE TABLE promotion_carousel_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,carousel_id uuid,product_id uuid,discount_type text,discount_value numeric,show_discount_badge boolean DEFAULT true,start_at timestamptz,end_at timestamptz,is_active boolean DEFAULT true,display_order int DEFAULT 0,CHECK(end_at IS NULL OR start_at IS NULL OR end_at>start_at),FOREIGN KEY(tenant_id,carousel_id) REFERENCES promotion_carousels(tenant_id,id),FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id));
ALTER TABLE promotion_carousel_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY items_fixture ON promotion_carousel_items TO authenticated USING(public.is_tenant_owner_or_manager(tenant_id)) WITH CHECK(public.is_tenant_owner_or_manager(tenant_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON promotion_carousel_items TO authenticated;
CREATE TABLE orders(id uuid PRIMARY KEY,tenant_id uuid,status text DEFAULT 'PENDING',payment_status text DEFAULT 'PENDING',awaiting_online_payment boolean DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz,notes text,UNIQUE(tenant_id,id));
CREATE TABLE order_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,tenant_id uuid,status text);
CREATE TABLE order_status_history(order_id uuid,status text,note text,changed_by text);
CREATE FUNCTION public.log_audit_event(text,text,text,text,text,text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE TABLE stock_reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,order_id uuid,order_item_id uuid UNIQUE,product_id uuid,location_id uuid,quantity numeric,unit text,status text DEFAULT 'ACTIVE',created_at timestamptz DEFAULT now(),closed_at timestamptz);
CREATE FUNCTION public._stock_default_location(uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT $1 $$;
CREATE TABLE coupons(discount_type text,discount_value numeric,max_discount_amount numeric);
CREATE TABLE order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,product_id uuid,product_name text,quantity int,unit_price numeric,total_price numeric,notes text,unit text,original_unit_price numeric,discount_amount numeric,item_kind text,offer_id uuid,card_id uuid);
CREATE TABLE product_option_groups(id uuid,tenant_id uuid,name text);
CREATE TABLE product_options(id uuid,group_id uuid,tenant_id uuid,name text,extra_price_cents int);
CREATE TABLE order_item_options(tenant_id uuid,order_item_id uuid,group_id uuid,option_id uuid,group_name_snapshot text,option_name_snapshot text,qty int,unit_price_cents int,fraction numeric);
CREATE TABLE inventory_movements(created_at timestamptz DEFAULT now(),order_id uuid,location_id uuid,unit text,actor_user_id uuid,tenant_id uuid,product_id uuid,product_name text,quantity int,type text,reference_id text,reason text,previous_stock int,new_stock int,created_by_name text);
CREATE FUNCTION public._normalize_product_option_selections(jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT COALESCE($1,'[]'::jsonb) $$;
CREATE FUNCTION public._product_option_selection_price(uuid,uuid,jsonb) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public._public_media_json(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION public.get_public_store(p_slug text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('products',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'price',p.price)) FROM public.products p JOIN public.tenants t ON t.id=p.tenant_id WHERE t.slug=p_slug),'[]'::jsonb)) $$;
CREATE FUNCTION public.get_totem_store(p_token text) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE v_store jsonb; BEGIN v_store:=public.get_public_store(p_token); RETURN v_store || '{}'::jsonb; END $$;
CREATE FUNCTION public.create_totem_order(p_token text,p_items jsonb,p_idempotency_key uuid) RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE p record; BEGIN SELECT * INTO p FROM public.products WHERE id=(p_items->0->>'productId')::uuid; IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF; RETURN to_jsonb(p); END $$;
INSERT INTO tenants VALUES('${tenant}','loja'),('${other}','outra');
INSERT INTO products(id,tenant_id,name,image_url,price,stock_quantity) VALUES('${product}','${tenant}','Catálogo','https://example.com/p.png',20,50);
INSERT INTO promotion_carousels(id,tenant_id,name) VALUES('${carousel}','${tenant}','Promoções');
INSERT INTO promotion_carousel_items(id,tenant_id,carousel_id,product_id,discount_type,discount_value) VALUES('${item}','${tenant}','${carousel}','${product}','PROMOTIONAL_PRICE',15);
SELECT set_config('test.tenant','${tenant}',false),set_config('test.role','OWNER',false);
`);
// Execute the production functions used by the current order flow, not test doubles.
const n4=read('supabase/migrations/20261006000400_n4_promotion_carousels_and_offer_columns.sql');
await db.exec(n4.slice(n4.indexOf('CREATE OR REPLACE FUNCTION public._effective_product_price('),n4.indexOf('DO $grants$')));
const dine=read('supabase/migrations/20261019002600_dine_in.sql');
await db.exec(dine.slice(dine.indexOf('CREATE OR REPLACE FUNCTION public._product_option_snapshot_after_order_item()'),dine.indexOf('CREATE OR REPLACE FUNCTION public._price_items(')));
await db.exec('CREATE TRIGGER product_option_snapshot AFTER INSERT ON public.order_items FOR EACH ROW EXECUTE FUNCTION public._product_option_snapshot_after_order_item()');
await db.exec(dine.slice(dine.indexOf('CREATE OR REPLACE FUNCTION public._price_items('),dine.indexOf('REVOKE ALL ON FUNCTION public._price_items(')));
const n5=read('supabase/migrations/20261006000500_n5_campaigns_cards_analytics_attribution.sql');
await db.exec(n5.slice(n5.indexOf('CREATE OR REPLACE FUNCTION public._insert_order_lines('),n5.indexOf('CREATE OR REPLACE FUNCTION public._checkout_core(')));
const n1=read('supabase/migrations/20261006000100_n1_foundations_preflight_order_hardening_payment_settings.sql');
await db.exec(n1.slice(n1.indexOf('CREATE OR REPLACE FUNCTION public._restock_order_items('),n1.indexOf('CREATE OR REPLACE FUNCTION public._status_rank(')));
const stock=read('supabase/migrations/20261020003100_stock_phase1.sql');
await db.exec(stock.slice(stock.indexOf('CREATE OR REPLACE FUNCTION public._stock_reserve_legacy_sale()'),stock.indexOf('CREATE OR REPLACE FUNCTION public._stock_order_reservation_lifecycle()')));
const stockLifecycleStart=stock.indexOf('CREATE OR REPLACE FUNCTION public._stock_order_reservation_lifecycle()');
const stockLifecycleEnd=stock.indexOf('FOR EACH ROW EXECUTE FUNCTION public._stock_order_reservation_lifecycle();',stockLifecycleStart)+'FOR EACH ROW EXECUTE FUNCTION public._stock_order_reservation_lifecycle();'.length;
await db.exec(stock.slice(stockLifecycleStart,stockLifecycleEnd));
const online=read('supabase/migrations/20261026004301_online_payment_gate.sql');
await db.exec(online.slice(online.indexOf('CREATE FUNCTION public.expire_unpaid_online_orders()'),online.indexOf("NOTIFY pgrst,'reload schema';")));
const coupons=read('supabase/migrations/20261006000200_n2_coupons_checkout_v2_pos_and_reversal.sql');
await db.exec(coupons.slice(coupons.indexOf('CREATE OR REPLACE FUNCTION public._coupon_compute_discount('),coupons.indexOf('-- Normaliza e precifica os itens')));
// Exercise the real checkout core for the coupon/base regression. Authentication/rate-limit
// services and coupon lookup are fixture boundaries; price, eligible-base calculation,
// coupon arithmetic, order totals and inventory writers below are production functions.
await db.exec(`
CREATE TABLE auth.users(id uuid,email text);
ALTER TABLE tenants ADD COLUMN status text DEFAULT 'ACTIVE';
CREATE TABLE tenant_settings(tenant_id uuid,is_open boolean DEFAULT true,min_order_value numeric DEFAULT 0,delivery_fee numeric DEFAULT 0,free_delivery_threshold numeric,default_prep_time_minutes int DEFAULT 15);
INSERT INTO tenant_settings(tenant_id) VALUES('${tenant}');
CREATE TABLE customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,name text,phone text,email text,origin text,total_orders int,ltv_amount numeric,first_order_date date,last_order_date date,updated_at timestamptz);
ALTER TABLE orders ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE orders ADD COLUMN customer_id uuid,ADD COLUMN customer_name text,ADD COLUMN customer_phone text,ADD COLUMN customer_email text,
 ADD COLUMN delivery_address text,ADD COLUMN address_details jsonb,ADD COLUMN subtotal numeric,ADD COLUMN delivery_fee numeric,ADD COLUMN discount numeric,
 ADD COLUMN total_amount numeric,ADD COLUMN payment_method text,ADD COLUMN fulfillment_type text,ADD COLUMN origin text,ADD COLUMN prep_time_minutes int,
 ADD COLUMN idempotency_key uuid,ADD COLUMN coupon_id uuid,ADD COLUMN coupon_code text,ADD COLUMN campaign_id uuid,ADD COLUMN card_id uuid,ADD COLUMN attribution_source text;
CREATE FUNCTION public._sha256_hex(text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
CREATE FUNCTION public._rate_limit_hit(text,text,text,int,int) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public._delivery_fee_customer_part(numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT $1 $$;
CREATE FUNCTION public.normalize_coupon_code(text) RETURNS text LANGUAGE sql AS $$ SELECT nullif(upper(trim($1)),'') $$;
CREATE FUNCTION public._coupon_lock_and_quote(uuid,text,uuid,numeric,boolean) RETURNS TABLE(r_discount numeric,r_coupon_id uuid,r_code text)
 LANGUAGE sql AS $$ SELECT public._coupon_compute_discount(ROW('PERCENTAGE',10,NULL)::public.coupons,$4),'60000000-0000-0000-0000-000000000001'::uuid,$2 $$;
CREATE FUNCTION public._coupon_consume(uuid,uuid,uuid,uuid,numeric,text,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public._checkout_order_summary(uuid,boolean) RETURNS jsonb LANGUAGE sql AS $$ SELECT to_jsonb(o) FROM public.orders o WHERE o.id=$1 $$;
`);
const checkout=read('supabase/migrations/20261017001700_delivery_fee_split.sql');
await db.exec(checkout.slice(checkout.indexOf('CREATE OR REPLACE FUNCTION public._checkout_core('),checkout.indexOf('CREATE OR REPLACE FUNCTION public.process_promotional_checkout_atomic(')));
// Use the actual alternate totem writer, including its direct order-item inserts.
await db.exec(`
ALTER TABLE orders ADD COLUMN totem_device_id uuid;
CREATE TABLE totem_payment_settings(tenant_id uuid,timeout_seconds int,provider text);
CREATE TABLE totem_payment_attempts(tenant_id uuid,order_id uuid,device_id uuid,provider text,amount numeric,expires_at timestamptz);
CREATE FUNCTION public._totem_device_ok(text) RETURNS TABLE(o_device uuid,o_tenant uuid,o_label text) LANGUAGE sql AS $$
 SELECT '80000000-0000-0000-0000-000000000001'::uuid,'${tenant}'::uuid,'Totem teste'::text $$;
CREATE FUNCTION public._totem_payment_response(uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('orderId',$1) $$;
CREATE FUNCTION public._rate_limit_hit(text,text,uuid,int,int) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
`);
const totemWriter=read('supabase/migrations/20261112000100_reorder_best_sellers.sql');
await db.exec(totemWriter.slice(totemWriter.indexOf('CREATE OR REPLACE FUNCTION public.create_totem_order('),totemWriter.indexOf("NOTIFY pgrst,'reload schema';")));
const migration=read('supabase/migrations/20261115000100_carousel_promotional_products.sql');
const rollback=read('supabase/rollback/20261115000100_carousel_promotional_products_down.sql');
const definitions=async()=> (await db.query(`SELECT oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY 1`)).rows;
const original=await definitions();
await db.exec(migration);
await db.exec(rollback);
assert.deepEqual(await definitions(),original,'rollback restores exact functions and grants');
assert.equal((await db.query("SELECT to_regclass('public.carousel_kit_order_consumptions') name")).rows[0].name,null,'rollback removes the empty consumption ledger');
await db.exec(migration);
const price=async(lines,lock=false)=>(await db.query('SELECT * FROM public._price_items($1,$2::jsonb,$3)',[tenant,JSON.stringify(lines),lock])).rows;
const line={productId:product,quantity:1,source:'campaign',campaignItemId:item};
assert.equal(Number((await price([line]))[0].r_unit_price),15);
await assert.rejects(price([{...line,price:0.01}]),/UNEXPECTED_FIELD/);
await assert.rejects(price([{...line,unit_price:0.01}]),/UNEXPECTED_FIELD/);
await assert.rejects(price([{...line,campaignItemId:'40000000-0000-0000-0000-000000000002'}]),/CAMPAIGN_ITEM_INVALID/);
await db.exec(`UPDATE promotion_carousel_items SET start_at=now()+interval '1 day' WHERE id='${item}'`);
await assert.rejects(price([line]),/CAMPAIGN_ITEM_INVALID/);
await db.exec(`UPDATE promotion_carousel_items SET start_at=NULL,end_at=now()-interval '1 day' WHERE id='${item}'`);
await assert.rejects(price([line]),/CAMPAIGN_ITEM_INVALID/);
await db.exec(`UPDATE promotion_carousel_items SET end_at=NULL,unit_limit=2 WHERE id='${item}'`);
await assert.rejects(price([{...line,quantity:3}]),/CAMPAIGN_ITEM_INVALID/);
assert.equal(Number((await price([{productId:product,quantity:1}]))[0].r_unit_price),20,'removing origin cannot bypass limited campaign quota');
// Simulate the existing checkout's authoritative price -> line writer transaction.
let orderSeq=0;
async function purchase(lines,fail=false){
 await db.exec('BEGIN');
 try {
  const rows=await price(lines,true);
  const order=`50000000-0000-0000-0000-${String(++orderSeq).padStart(12,'0')}`;
  await db.query('INSERT INTO orders(id,tenant_id) VALUES($1,$2)',[order,tenant]);
  const payload=rows.map(r=>({product_id:r.r_product_id,quantity:r.r_quantity,name:r.r_name,unit:r.r_unit,unit_price:r.r_unit_price,original_price:r.r_original_price,is_promotional:r.r_is_promotional}));
  await db.query('SELECT public._insert_order_lines($1,$2,$3::jsonb,0,0,$4)',[order,tenant,JSON.stringify(payload),'Fixture']);
  if(fail)throw new Error('payment failure');
  await db.exec('COMMIT');return order;
 }catch(error){await db.exec('ROLLBACK');throw error;}
}
await assert.rejects(purchase([line],true),/payment failure/);
assert.equal((await db.query('SELECT units_sold FROM promotion_carousel_items WHERE id=$1',[item])).rows[0].units_sold,0);
await purchase([{...line,quantity:2}]);
await assert.rejects(purchase([line]),/CAMPAIGN_ITEM_INVALID/);
assert.equal((await db.query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity,48);
const store=async()=> (await db.query("SELECT get_public_store('loja') j")).rows[0].j;
assert.equal((await store()).carousels[0].items.length,0,'exhausted quota disappears');
const create=async(overrides={},components=[]) => (await db.query('SELECT create_carousel_product($1,$2,$3,$4) id',[tenant,carousel,{
 name:'Kit promocional',description:'Somente carrossel',imageUrl:'https://example.com/kit.png',price:12,stock:3,endDate:'2099-01-01T00:00:00Z',...overrides},components])).rows[0].id;
await db.exec('SET ROLE authenticated');
const promoItem=await create({},[{productId:product,quantity:2}]);
await assert.rejects(create({},[{productId:'20000000-0000-0000-0000-000000000099',quantity:1}]),/INVALID_KIT_COMPONENT/);
await db.exec('RESET ROLE');
const promoProduct=(await db.query('SELECT product_id FROM promotion_carousel_items WHERE id=$1',[promoItem])).rows[0].product_id;
let storefront=await store();
assert.equal(storefront.products.length,1);
assert.equal(storefront.carousels[0].items[0].productId,promoProduct);
assert.equal(storefront.carousels[0].items[0].effectivePrice,12,'price without optional reference price');
assert.equal((await db.query("SELECT get_totem_store('loja') j")).rows[0].j.carousels,undefined);
await assert.rejects(db.query('SELECT create_totem_order($1,$2,$3)',['token',[{productId:promoProduct,quantity:1}],crypto.randomUUID()]),/CAMPAIGN_ITEM_INVALID/);
await assert.rejects(price([{productId:promoProduct,quantity:1}]),/CAMPAIGN_ITEM_INVALID/);
const promoLine={productId:promoProduct,quantity:1,source:'campaign',campaignItemId:promoItem};
// P1: authenticated totem cannot use a validated campaign origin to bypass the official writer.
await db.query('UPDATE promotion_carousel_items SET unit_limit=3 WHERE id=$1',[promoItem]);
const beforeTotem={
 orders:Number((await db.query('SELECT count(*) n FROM orders')).rows[0].n),
 stock:Number((await db.query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity),
 kitStock:Number((await db.query('SELECT stock_quantity FROM products WHERE id=$1',[promoProduct])).rows[0].stock_quantity),
};
for (const attack of [promoLine,{...line},{productId:product,quantity:1,campaignItemId:item}]) {
 await assert.rejects(db.query('SELECT create_totem_order($1,$2,$3)',['token',[attack],crypto.randomUUID()]),/CAMPAIGN_SOURCE_UNAVAILABLE/);
}
assert.equal(Number((await db.query('SELECT count(*) n FROM orders')).rows[0].n),beforeTotem.orders);
assert.equal(Number((await db.query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity),beforeTotem.stock);
assert.equal(Number((await db.query('SELECT stock_quantity FROM products WHERE id=$1',[promoProduct])).rows[0].stock_quantity),beforeTotem.kitStock);
assert.equal((await db.query('SELECT units_sold FROM promotion_carousel_items WHERE id=$1',[promoItem])).rows[0].units_sold,0);
assert.equal((await db.query('SELECT count(*) n FROM carousel_kit_order_consumptions')).rows[0].n,0);
await db.exec('BEGIN');
const normalTotem=(await db.query('SELECT create_totem_order($1,$2,$3)',['token',[{productId:product,quantity:1}],crypto.randomUUID()])).rows[0].create_totem_order;
assert.ok(normalTotem.orderId,'regular totem catalogue checkout remains functional');
await db.exec('ROLLBACK');
// Remove the test quota before the independent cancellation scenarios below.
await db.query('UPDATE promotion_carousel_items SET unit_limit=NULL WHERE id=$1',[promoItem]);
await purchase([promoLine]);
assert.equal((await db.query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity,46,'kit component stock decremented');
assert.equal((await db.query('SELECT stock_quantity FROM products WHERE id=$1',[promoProduct])).rows[0].stock_quantity,2,'kit stock decremented');
assert.equal(Number((await db.query('SELECT unit_price FROM order_items WHERE product_id=$1',[promoProduct])).rows[0].unit_price),12);
await db.exec(`INSERT INTO product_option_groups VALUES('${product}','${tenant}','Extras'); INSERT INTO product_options VALUES('${product}','${product}','${tenant}','Extra',0)`);
await purchase([{...promoLine,options:[{group_id:product,option_id:product,qty:1}]}]);
assert.equal((await db.query('SELECT count(*) n FROM order_item_options')).rows[0].n,1,'promotional options are snapshotted at the selected campaign price');
// P1: a committed kit order snapshots its consumption and restocks exactly once.
const stockOf=async id=>Number((await db.query('SELECT stock_quantity FROM products WHERE id=$1',[id])).rows[0].stock_quantity);
const cancel=async id=>{ await db.query("UPDATE orders SET status='CANCELLED' WHERE id=$1",[id]); await db.query("SELECT _restock_order_items($1,'Equipe')",[id]); };
const secondComponent='20000000-0000-0000-0000-000000000002';
await db.query("INSERT INTO products(id,tenant_id,name,image_url,price,stock_quantity) VALUES($1,$2,'Segundo componente','https://example.com/segundo.png',5,10)",[secondComponent,tenant]);
await db.query('INSERT INTO carousel_kit_components VALUES($1,$2,$3,3)',[tenant,promoItem,secondComponent]);
const beforeComponent=await stockOf(product),beforeKit=await stockOf(promoProduct),beforeSecondComponent=await stockOf(secondComponent);
const kitOrder=await purchase([promoLine,{productId:product,quantity:1}]);
assert.equal(await stockOf(product),beforeComponent-3,'component can also be a regular order line');
assert.equal(await stockOf(secondComponent),beforeSecondComponent-3);
assert.equal((await db.query('SELECT quantity FROM carousel_kit_order_consumptions WHERE order_id=$1 AND product_id=$2',[kitOrder,product])).rows[0].quantity,2);
await db.query("UPDATE orders SET status='CONFIRMED' WHERE id=$1",[kitOrder]);
assert.equal(await stockOf(product),beforeComponent-3,'phase-1 confirmation must not debit an already-reserved component line twice');
// Later recipe changes must not change the historical consumed quantity.
await db.query('UPDATE carousel_kit_components SET quantity=9 WHERE item_id=$1 AND product_id=$2',[promoItem,product]);
await cancel(kitOrder);
assert.equal(await stockOf(product),beforeComponent,'cancel restores kit components plus the regular line, once');
assert.equal(await stockOf(secondComponent),beforeSecondComponent,'cancel restores the exact quantity of the second component');
assert.equal(await stockOf(promoProduct),beforeKit,'component reversal must not suppress the legacy kit-SKU restock');
await cancel(kitOrder);
assert.equal(await stockOf(product),beforeComponent,'repeated cancel/restock cannot double return components');
assert.equal((await db.query("SELECT count(*) n FROM inventory_movements WHERE reference_id=$1 AND reason='Devolução de componentes de kit promocional'",[kitOrder])).rows[0].n,2);
await db.query('UPDATE carousel_kit_components SET quantity=2 WHERE item_id=$1 AND product_id=$2',[promoItem,product]);
// Same transaction rollback must not mark the snapshot as restored or retain return movements.
const paymentOrder=await purchase([promoLine]);
await db.exec('BEGIN');await cancel(paymentOrder);await db.exec('ROLLBACK');
assert.equal(await stockOf(product),beforeComponent-2);
assert.equal((await db.query('SELECT restored_at FROM carousel_kit_order_consumptions WHERE order_id=$1',[paymentOrder])).rows[0].restored_at,null);
// Production online-payment expiry: failed payment -> CANCELLED -> restock.
await db.query('UPDATE orders SET awaiting_online_payment=true WHERE id=$1',[paymentOrder]);
await db.query("INSERT INTO order_payments(order_id,tenant_id,status) VALUES($1,$2,'failed')",[paymentOrder,tenant]);
assert.equal((await db.query('SELECT expire_unpaid_online_orders() n')).rows[0].n,1);
assert.equal(await stockOf(product),beforeComponent,'failed online payment restores components');
assert.equal(await stockOf(secondComponent),beforeSecondComponent,'failed payment restores every kit component');
assert.equal(await stockOf(promoProduct),beforeKit,'failed online payment also restores the kit SKU');
assert.equal((await db.query('SELECT expire_unpaid_online_orders() n')).rows[0].n,0);
await db.query("SELECT _restock_order_items($1,'Retry')",[paymentOrder]);
assert.equal(await stockOf(product),beforeComponent,'payment retry cannot double restock');
// P2: use real server pricing and coupon arithmetic, and the real client calculation.
const serverRows=await price([promoLine,{productId:product,quantity:1}]);
assert.equal(serverRows.find(r=>r.r_product_id===promoProduct).r_is_promotional,true,'validated campaign origin excludes an equal-base-price SKU from coupons');
const subtotal=serverRows.reduce((sum,r)=>sum+Number(r.r_unit_price)*r.r_quantity,0);
const eligible=serverRows.filter(r=>!r.r_is_promotional).reduce((sum,r)=>sum+Number(r.r_unit_price)*r.r_quantity,0);
assert.equal(eligible,20,'only the regular catalogue line is coupon eligible');
const discount=Number((await db.query("SELECT _coupon_compute_discount(ROW('PERCENTAGE',10,NULL)::coupons,$1) amount",[eligible])).rows[0].amount);
const clientProduct={id:promoProduct,tenantId:tenant,price:12,carouselOnly:true};
const clientCampaigns=[{id:carousel,tenantId:tenant,isActive:true,items:[{id:promoItem,carouselId:carousel,tenantId:tenant,productId:promoProduct,promotionalPrice:12,isActive:true}]}];
const clientPromo=priceLineByOrigin({product:clientProduct,quantity:1,origin:{source:'campaign',campaignItemId:promoItem},campaigns:clientCampaigns,tenantId:tenant});
assert.equal(clientPromo.ok,true);
const client=computeFulfillmentPricing({lines:[clientPromo.line,{productId:product,quantity:1,unitPrice:20,isPromotional:false}],mode:'DELIVERY',settings:DEFAULT_FULFILLMENT_SETTINGS,coupon:{code:'DEZ',discountType:'PERCENTAGE',discountValue:10}});
assert.equal(client.couponDiscount,discount);
assert.equal(client.total,subtotal-discount,'client total equals server total without an optional reference price');
assert.equal(client.total,30);
await db.exec(`SELECT set_config('test.uid','70000000-0000-0000-0000-000000000001',false)`);
await db.exec('BEGIN');
const actualCheckout=(await db.query("SELECT public._checkout_core('loja','Cliente','11999999999','Rua de teste','{}','PIX','DELIVERY',NULL,'storefront',$1,'DEZ',NULL,NULL) j",[JSON.stringify([promoLine,{productId:product,quantity:1}])])).rows[0].j;
assert.equal(actualCheckout.discount,client.couponDiscount,'production checkout excludes the campaign SKU from coupon eligibility');
assert.equal(actualCheckout.total_amount,client.total,'real checkout total equals the real client total');
await db.exec('ROLLBACK');
const promoOnly=await price([promoLine]);
assert.equal(promoOnly.filter(r=>!r.r_is_promotional).length,0,'coupon cannot apply to an exclusive promotional product alone');
await db.exec(`UPDATE promotion_carousel_items SET end_at=now()-interval '1 minute' WHERE id='${promoItem}'`);
assert.equal((await store()).carousels[0].items.length,0);
await assert.rejects(price([promoLine]),/CAMPAIGN_ITEM_INVALID/);
// Role and tenant isolation, both RPC and direct RLS.
await db.exec(`SELECT set_config('test.role','STAFF',false); SET ROLE authenticated`);
await assert.rejects(create(),/FORBIDDEN/);
assert.equal((await db.query('SELECT * FROM products')).rows.length,0);
assert.equal((await db.query('SELECT * FROM carousel_kit_order_consumptions')).rows.length,0);
await assert.rejects(db.query("SELECT _carousel_restock_components($1,'Spoof')",[paymentOrder]),/permission denied/);
await db.exec(`RESET ROLE; SELECT set_config('test.role','OWNER',false),set_config('test.tenant','${other}',false); SET ROLE authenticated`);
await assert.rejects(create(),/FORBIDDEN/);
assert.equal((await db.query('SELECT * FROM promotion_carousel_items')).rows.length,0);
assert.equal((await db.query('SELECT * FROM carousel_kit_order_consumptions')).rows.length,0);
await assert.rejects(db.exec(`UPDATE promotion_carousel_items SET units_sold=0 WHERE id='${item}'; INSERT INTO promotion_carousel_items(tenant_id,carousel_id,product_id,discount_type,discount_value) VALUES('${other}','${carousel}','${product}','NONE',0)`),/foreign key/);
await db.exec('RESET ROLE');
await assert.rejects(db.exec(rollback),/ROLLBACK_BLOCKED/);await db.exec('ROLLBACK');
assert.equal((await db.query('SELECT count(*) n FROM products WHERE carousel_only')).rows[0].n,1,'blocked rollback preserves business data');
console.log('PASS carousel: up/down/up, pricing, tampering, windows, quota, orders, kit inventory/cancellation/online-payment failure with idempotent restock, campaign coupon exclusion and client/server total parity, rollback atomicity, catalogue/totem isolation and tenant/role RLS.');
await db.close();
