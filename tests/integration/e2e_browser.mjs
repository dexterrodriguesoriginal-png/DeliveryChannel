import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
const SECRET = 'local-integration-secret-only-for-tests-0123456789';
const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = c => { const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ exp: Math.floor(Date.now()/1000)+3600, ...c }); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const OWNER = 'a0000000-0000-0000-0000-000000000001';
const results = []; const ok = (name, cond, extra='') => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--ignore-certificate-errors'] });

async function session(ctx, uid) {
  const token = jwt({ sub: uid, role: 'authenticated', email: 'owner.a@test.local' });
  const s = { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, refresh_token: 'local-test',
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email: 'owner.a@test.local', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
  await ctx.addInitScript(v => { localStorage.setItem('sb-127-auth-token', v); }, JSON.stringify(s));
}
const text = async page => (await page.textContent('body')) || '';
async function clickText(page, t) { const el = page.getByText(t, { exact: false }).first(); await el.click({ timeout: 8000 }); await page.waitForTimeout(1500); }

for (const [mode, port] of [['n1n6', 3101], ['legacy-020', 3102]]) {
  const base = `http://127.0.0.1:${port}`;
  // 1) Vitrine pública (anon)
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const rpcs = []; page.on('request', r => { const m = r.url().match(/\/rest\/v1\/rpc\/([a-z_0-9]+)/); if (m) rpcs.push(m[1]); });
  await page.goto(`${base}/app/adega-a`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
  let t = await text(page);
  ok(`[${mode}] vitrine carrega produtos do servidor`, t.includes('Cerveja A1'), '');
  ok(`[${mode}] vitrine sem RPC inexistente (get_public_campaign_carousels)`, !rpcs.includes('get_public_campaign_carousels'), rpcs.join(','));
  await page.screenshot({ path: `/tmp/e2e/${mode}_vitrine.png` });
  await ctx.close();

  // 2) Login sem bypass
  ctx = await browser.newContext(); page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
  t = await text(page);
  ok(`[${mode}] login sem botão de bypass`, !/sem Fazer Login/i.test(t), '');
  await page.screenshot({ path: `/tmp/e2e/${mode}_login.png` });
  await ctx.close();

  // 3) Painel OWNER
  ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); await session(ctx, OWNER);
  page = await ctx.newPage(); page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`${base}/`, { waitUntil: 'networkidle' }); await page.waitForTimeout(3500);
  await page.screenshot({ path: `/tmp/e2e/${mode}_painel.png` });
  try {
    await clickText(page, 'Pedidos');
    const pdv = page.locator('[data-testid=open-pdv]');
    const disabled = await pdv.isDisabled({ timeout: 8000 });
    ok(`[${mode}] PDV ${mode === 'n1n6' ? 'habilitado' : 'desabilitado com aviso'}`, mode === 'n1n6' ? !disabled : disabled);
    await page.screenshot({ path: `/tmp/e2e/${mode}_pedidos.png` });
  } catch (e) { ok(`[${mode}] tela de pedidos`, false, String(e).slice(0, 160)); }
  try {
    await clickText(page, 'Marketing');
    const hasTab = await page.locator('[data-testid=tab-campaigns]').count();
    ok(`[${mode}] aba Campanhas ${mode === 'n1n6' ? 'presente' : 'ausente'}`, mode === 'n1n6' ? hasTab === 1 : hasTab === 0);
    ok(`[${mode}] aba Desempenho & Vendas presente`, (await text(page)).includes('Desempenho & Vendas'));
    if (mode === 'n1n6' && hasTab) { await page.locator('[data-testid=tab-campaigns]').click(); await page.waitForTimeout(2000);
      ok(`[${mode}] painel de campanhas lista campanha do servidor`, (await text(page)).includes('Campanha Integração'));
      await page.screenshot({ path: `/tmp/e2e/${mode}_campanhas.png` }); }
  } catch (e) { ok(`[${mode}] marketing`, false, String(e).slice(0, 160)); }
  try {
    await clickText(page, 'Configurações');
    t = await text(page);
    ok(`[${mode}] configurações ${mode === 'n1n6' ? 'com card PIX do servidor' : 'com chave PIX legada'}`, mode === 'n1n6' ? /PIX/.test(t) : /Chave PIX/i.test(t));
    await page.screenshot({ path: `/tmp/e2e/${mode}_config.png`, fullPage: false });
  } catch (e) { ok(`[${mode}] configurações`, false, String(e).slice(0, 160)); }
  ok(`[${mode}] sem erros de JS não tratados`, errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(results.join('\n'));
