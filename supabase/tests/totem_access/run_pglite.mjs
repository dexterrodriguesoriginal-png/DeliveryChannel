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
const R3 = read('supabase/rollback/20261109000300_totem_access_and_design_down.sql');
const stub = read('supabase/tests/entrega3/stub.sql');
const extra = fs.readFileSync(path.join(here, 'stub_extra.sql'), 'utf8');

const T = '11111111-1111-1111-1111-111111111111';
const O = '22222222-2222-2222-2222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STAFF = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
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
  await exec(extra);
}

await setupBase();
await exec(M3);
console.log('M3_OK');

// --- design ---
const goodDesign = JSON.stringify({
  preset: 'noturno', bannerRadius: 16,
  colors: {
    pageBg:'#0B0F14', sidebarBg:'#111827', sidebarCardBg:'#1F2937', sidebarCardText:'#E5E7EB',
    sidebarCardActiveBg:'#176444', sidebarCardActiveText:'#FFFFFF', productCardBg:'#111827',
    productCardText:'#F9FAFB', productPrice:'#6EE7B7', addButtonBg:'#FF0000', addButtonText:'#FFFFFF',
    orderPanelBg:'#111827', orderPanelText:'#F9FAFB', checkoutButtonBg:'#176444', checkoutButtonText:'#FFFFFF'
  }
});
const badHex = JSON.stringify({ preset:'noturno', bannerRadius:16, colors: {
  pageBg:'red', sidebarBg:'#111827', sidebarCardBg:'#1F2937', sidebarCardText:'#E5E7EB',
  sidebarCardActiveBg:'#176444', sidebarCardActiveText:'#FFFFFF', productCardBg:'#111827',
  productCardText:'#F9FAFB', productPrice:'#6EE7B7', addButtonBg:'#176444', addButtonText:'#FFFFFF',
  orderPanelBg:'#111827', orderPanelText:'#F9FAFB', checkoutButtonBg:'#176444', checkoutButtonText:'#FFFFFF'
}});

await asRole(null);
await expectErr('anon set design', `select public.set_totem_design($1,$2::jsonb)`, [T, goodDesign], 'FORBIDDEN');
await asRole('STAFF', STAFF);
await expectErr('staff set design', `select public.set_totem_design($1,$2::jsonb)`, [T, goodDesign], 'FORBIDDEN');
await asRole('OWNER');
await expectErr('bad hex design', `select public.set_totem_design($1,$2::jsonb)`, [T, badHex], 'INVALID_TOTEM_DESIGN');
const setD = await expectOk('owner set design', `select public.set_totem_design($1,$2::jsonb) j`, [T, goodDesign]);
ok('design persists custom add button', setD && JSON.stringify(setD.rows).includes('#FF0000'));

// --- login payload (no PII) ---
const login = await expectOk('public login', `select public.get_public_totem_login('loja') j`);
const loginJ = login?.rows?.[0]?.j;
ok('login has name and logo', loginJ && loginJ.name === 'Adega Loja' && loginJ.logoUrl);
ok('login has no phone/email', loginJ && !('phone' in loginJ) && !('email' in loginJ) && !('document' in loginJ));
const missing = await expectOk('login missing slug', `select public.get_public_totem_login('nada') j`);
ok('missing slug is null', missing && missing.rows[0].j == null);

// --- admin users ---
await asRole(null);
await expectErr('anon create user', `select public.admin_create_totem_user($1,'Balcão','totem01','senha1234')`, [T], 'FORBIDDEN');
await asRole('STAFF', STAFF);
await expectErr('staff create user', `select public.admin_create_totem_user($1,'Balcão','totem01','senha1234')`, [T], 'FORBIDDEN');
await asRole('OWNER');
await expectErr('short password', `select public.admin_create_totem_user($1,'Balcão','totem01','123')`, [T], 'INVALID_TOTEM_PASSWORD');
await expectErr('bad username', `select public.admin_create_totem_user($1,'Balcão','A B','senha1234')`, [T], 'INVALID_TOTEM_USER');
const created = await expectOk('owner create user', `select public.admin_create_totem_user($1,'Balcão 1','Totem01','senha1234') j`, [T]);
ok('username lowercased', created && created.rows[0].j.username === 'totem01');
await expectErr('duplicate user', `select public.admin_create_totem_user($1,'Outro','totem01','senha1234')`, [T], 'TOTEM_USER_EXISTS');
const listed = await expectOk('list users', `select public.admin_list_totem_users($1) j`, [T]);
const listStr = JSON.stringify(listed?.rows?.[0]?.j || {});
ok('list has user and no hash', listStr.includes('totem01') && !listStr.includes('password') && !listStr.includes('bf$'));
const hashRow = await expectOk('hash stored', `select password_hash from public.totem_users where username='totem01'`);
const storedHash = hashRow?.rows?.[0]?.password_hash || '';
ok('hash is not plaintext', storedHash.startsWith('bf$') && !storedHash.includes('senha1234'));

// --- activate ---
await asRole(null);
await expectErr('wrong password', `select public.totem_activate('loja','totem01','erradaaaa','Caixa 1', false, 'ip1')`, [], 'TOTEM_AUTH_FAILED');
const act1 = await expectOk('activate ok', `select public.totem_activate('loja','totem01','senha1234','Caixa 1', false, 'ip1') j`);
const tok1 = act1?.rows?.[0]?.j;
ok('token is 64 hex and ok', tok1 && tok1.ok && /^[0-9a-f]{64}$/.test(tok1.token));
const rawInDb = await query(`select count(*)::int c from public.totem_devices d where d.token_hash = $1 or encode(d.token_hash::bytea,'escape') = $2`, [tok1.token, tok1.token]);
ok('plaintext token not stored as hash', rawInDb.rows[0].c === 0);

const warn = await expectOk('second activate warns', `select public.totem_activate('loja','totem01','senha1234','Caixa 2', false, 'ip1') j`);
ok('ACTIVE_DEVICE warning', warn?.rows?.[0]?.j?.reason === 'ACTIVE_DEVICE' && warn.rows[0].j.ok === false);

const act2 = await expectOk('activate with confirm', `select public.totem_activate('loja','totem01','senha1234','Caixa 2', true, 'ip1') j`);
const tok2 = act2?.rows?.[0]?.j;
ok('revoked previous id returned', tok2 && tok2.ok && tok2.revokedDeviceId && tok2.token !== tok1.token);

await expectErr('old token rejected', `select public.totem_current_device($1)`, [tok1.token], 'TOTEM_DEVICE_INVALID');
const cur = await expectOk('new token session', `select public.totem_current_device($1) j`, [tok2.token]);
ok('session has design and welcome', cur?.rows?.[0]?.j?.design?.colors?.addButtonBg && cur.rows[0].j.welcome);

const store = await expectOk('store with token', `select public.get_totem_store($1) j`, [tok2.token]);
ok('store includes catalog and design', store?.rows?.[0]?.j?.products && store.rows[0].j.totemDesign);
await expectErr('store without token', `select public.get_totem_store('x')`, [], 'TOTEM_DEVICE_INVALID');

// --- orders ---
const key1 = 'c0000000-0000-0000-0000-000000000001';
const items = JSON.stringify([{ productId: P1, quantity: 2 }]);
const ord = await expectOk('create order', `select public.create_totem_order($1,$2::jsonb,$3::uuid) j`, [tok2.token, items, key1]);
ok('order total is server price 25.80', ord?.rows?.[0]?.j?.ok && Number(ord.rows[0].j.total) === 25.8);
const again = await expectOk('idempotent order', `select public.create_totem_order($1,$2::jsonb,$3::uuid) j`, [tok2.token, items, key1]);
ok('same key returns same order', again?.rows?.[0]?.j?.idempotent === true && again.rows[0].j.orderId === ord.rows[0].j.orderId);
const ordRow = await expectOk('order row fields', `select fulfillment_type, payment_status, status, totem_device_id::text, idempotency_key::text, total_amount::text, origin from public.orders where id = $1`, [ord.rows[0].j.orderId]);
const orow = ordRow?.rows?.[0];
ok('order is pickup totem with server total and key', orow && orow.fulfillment_type === 'PICKUP' && orow.payment_status === 'PAYMENT_ON_DELIVERY' && orow.status === 'CONFIRMED' && orow.origin === 'direct' && Number(orow.total_amount) === 25.8 && orow.idempotency_key === key1 && orow.totem_device_id);
const itemRow = await expectOk('order items', `select quantity, unit_price::text, total_price::text from public.order_items where order_id = $1`, [ord.rows[0].j.orderId]);
ok('item uses server price 12.90 x 2', itemRow?.rows?.length === 1 && Number(itemRow.rows[0].quantity) === 2 && Number(itemRow.rows[0].unit_price) === 12.9 && Number(itemRow.rows[0].total_price) === 25.8);
await expectErr('inactive product', `select public.create_totem_order($1,$2::jsonb,$3::uuid)`, [tok2.token, JSON.stringify([{productId:PINACTIVE,quantity:1}]), 'c0000000-0000-0000-0000-000000000002'], 'INVÁLID_TOTEM_ORDER'.replace('Á','A') && 'INVALID_TOTEM_ORDER');
await expectErr('foreign product', `select public.create_totem_order($1,$2::jsonb,$3::uuid)`, [tok2.token, JSON.stringify([{productId:POTHER,quantity:1}]), 'c0000000-0000-0000-0000-000000000003'], 'INVALID_TOTEM_ORDER');
await expectErr('order without token', `select public.create_totem_order($1,$2::jsonb,$3::uuid)`, ['not-a-token', JSON.stringify([{productId:P1,quantity:1}]), 'c0000000-0000-0000-0000-000000000004'], 'TOTEM_DEVICE_INVALID');

// rate limit: 12 allowed / 5 min; we already placed 1 unique order (key1). Need 12 more unique then 13th fails.
let limited = false;
for (let i = 0; i < 13; i++) {
  const key = `c0000000-0000-0000-0000-0000000001${String(i).padStart(2,'0')}`;
  try {
    await query(`select public.create_totem_order($1,$2::jsonb,$3::uuid)`, [tok2.token, items, key]);
  } catch (e) {
    if (String(e.message).includes('RATE_LIMITED')) { limited = true; break; }
    failed++; console.log('FAIL rate loop unexpected', e.message); break;
  }
}
ok('order rate limited per device', limited);

// --- revoke / password / deactivate ---
await asRole('OWNER');
const devs = await expectOk('list devices', `select public.admin_list_totem_devices($1) j`, [T]);
const devices = devs?.rows?.[0]?.j || [];
const active = devices.find(d => d.active);
ok('list shows user label and last seen keys', active && active.userLabel === 'Balcão 1' && 'lastSeenAt' in active);
await expectOk('revoke device', `select public.admin_revoke_totem_device($1,$2) j`, [T, active.id]);
await expectErr('revoked token dead', `select public.totem_current_device($1)`, [tok2.token], 'TOTEM_DEVICE_INVALID');

const act3 = await expectOk('activate after revoke', `select public.totem_activate('loja','totem01','senha1234','Caixa 3', false, 'ip2') j`);
const tok3 = act3?.rows?.[0]?.j?.token;
await expectOk('change password', `select public.admin_set_totem_user_password($1, (select id from public.totem_users where username='totem01'), 'novasenha99')`, [T]);
await expectErr('old password fails', `select public.totem_activate('loja','totem01','senha1234','X', true, 'ip3')`, [], 'TOTEM_AUTH_FAILED');
ok('existing device still valid after password change', !!(await expectOk('token after pwd change', `select public.totem_current_device($1) j`, [tok3])));

await expectOk('deactivate user', `select public.admin_set_totem_user_active($1, (select id from public.totem_users where username='totem01'), false)`, [T]);
await expectErr('deactivated user cannot login', `select public.totem_activate('loja','totem01','novasenha99','Y', true, 'ip4')`, [], 'TOTEM_AUTH_FAILED');
await expectErr('device revoked with user', `select public.totem_current_device($1)`, [tok3], 'TOTEM_DEVICE_INVALID');

// staff activate
await asRole('STAFF', STAFF);
await expectErr('staff cannot staff-activate', `select public.totem_activate_as_staff('loja','Gerência')`, [], 'FORBIDDEN');
await asRole('OWNER');
const staffAct = await expectOk('owner staff-activate', `select public.totem_activate_as_staff('loja','Gerência') j`);
ok('staff token issued', staffAct?.rows?.[0]?.j?.ok && staffAct.rows[0].j.kind === 'STAFF');
const tokS = staffAct.rows[0].j.token;
await expectOk('staff token session', `select public.totem_current_device($1) j`, [tokS]);

// --- rollback guards ---
try { await exec(R3); failed++; console.log('FAIL rollback with data unexpectedly OK'); }
catch (e) {
  ok('rollback blocked with data', String(e.message).includes('ROLLBACK_BLOCKED'));
  try { await exec('ROLLBACK'); } catch { /* in txn already aborted? pglite may auto rollback */ }
}

// fresh db: apply, rollback empty, reapply
const db2 = new PGlite();
async function load(d) {
  await d.exec(stub); await d.exec(M1); await d.exec(M2); await d.exec(extra);
}
await load(db2);
await db2.exec(M3);
await db2.exec(R3);
console.log('ROLLBACK_EMPTY_OK');
const cols = await db2.query(`select column_name from information_schema.columns where table_name='tenant_settings' and column_name='totem_design'`);
ok('design column dropped after rollback', cols.rows.length === 0);
const tbl = await db2.query(`select to_regclass('public.totem_users') c`);
ok('users table dropped after rollback', tbl.rows[0].c == null);
await db2.exec(M3);
console.log('REAPPLY_OK');
const cols2 = await db2.query(`select column_name from information_schema.columns where table_name='tenant_settings' and column_name='totem_design'`);
ok('design column back after reapply', cols2.rows.length === 1);

if (failed) { console.log(`FAILED ${failed} checks`); process.exit(1); }
console.log('ALL_TOTEM_ACCESS_SQL_OK');
