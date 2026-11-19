// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { injectStoreHead, storeHeadOptionsForUrl } from '../storeHtml';
import { storeBootScreenHtml, STORE_BOOT_LOGO_SIZE_PX, STORE_BOOT_SCREEN_ID } from '../../../src/lib/pwa/bootScreen';
import { DEFAULT_SPLASH_TEST_SLUGS, resolveSplashTestSlugs } from '../splashTest';
import { serverManifest } from '../routes';
import fs from 'node:fs';
import path from 'node:path';
import { DC_MARK_SVG } from '../../../src/lib/brand/dcMark';

const html = '<html><head><title>X</title><link rel="manifest" href="/manifest.json" /></head><body class="bg-gray-50"><div id="root"></div></body></html>';
const store = { id: 't1', slug: 'mercado-teste-dc', name: 'Mercado Teste DC', theme: { storeName: 'Mercado Teste DC', primaryColor: '#15803d', headerColor: '#0a5c36' } } as any;
const opts = storeHeadOptionsForUrl('/app/mercado-teste-dc/?source=pwa');

describe('abertura só com a logo da loja (#store-boot), sem "Delivery Channel apresenta"', () => {
  it('vem logo depois do <body>, antes do #root, com o ícone da loja e o fundo do manifesto', () => {
    const out = injectStoreHead(html, 'mercado-teste-dc', store, opts);
    const body = out.indexOf('<body'); const boot = out.indexOf(`id="${STORE_BOOT_SCREEN_ID}"`); const root = out.indexOf('id="root"');
    expect(boot).toBeGreaterThan(body);
    expect(boot).toBeLessThan(root);
    expect((out.match(/id="store-boot"/g) || []).length).toBe(1);
    const m = serverManifest(store);
    expect(out).toContain(`background:${m.background_color}`);
    expect(out).toMatch(/<img src="\/app\/mercado-teste-dc\/icons\/icon-192\.png\?v=[^"]+" width="96" height="96"/);
    expect(out).toContain('aria-label="Mercado Teste DC"');
  });

  it('nenhuma marca do Delivery Channel na abertura', () => {
    for (const s of [store, null]) {
      const out = injectStoreHead(html, 'mercado-teste-dc', s, opts);
      expect(out).not.toContain('dc-boot');
      expect(out).not.toContain('Delivery Channel apresenta');
      expect(out).not.toContain('#121212');
    }
  });

  it('sem loja resolvida (falha/timeout): nenhuma tela (nada de cor fixa)', () => {
    expect(injectStoreHead(html, 'x', null, opts)).not.toContain('store-boot');
  });

  it('não aparece no cardápio da mesa (?mesa=) nem na prévia do painel (?preview=1)', () => {
    expect(storeHeadOptionsForUrl('/app/x/?source=pwa')).toEqual({ edgeToEdge: true, bootScreen: true });
    expect(storeHeadOptionsForUrl('/app/x/?preview=1').bootScreen).toBe(false);
    expect(storeHeadOptionsForUrl('/app/x/?mesa=' + 'a'.repeat(32))).toEqual({ edgeToEdge: false, bootScreen: false });
    expect(injectStoreHead(html, 'x', store, { edgeToEdge: false, bootScreen: false })).not.toContain('store-boot');
    expect(injectStoreHead(html, 'x', store)).not.toContain('store-boot');
  });

  it('marcação segura: sem script, só ícone do próprio app, nome escapado, cor validada', () => {
    const b = storeBootScreenHtml({ background: '#ABC', iconUrl: '/app/x/icons/icon-192.png?v=1', name: '<b>"Loja"</b>' });
    expect(b).toContain('background:#aabbcc');
    expect(b).not.toContain('<script');
    expect(b).not.toMatch(/https?:\/\//i);
    expect(b).toContain('aria-label="&lt;b&gt;&quot;Loja&quot;&lt;/b&gt;"');
    expect(STORE_BOOT_LOGO_SIZE_PX).toBeGreaterThanOrEqual(64);
    expect(storeBootScreenHtml({ background: 'red;}body{x', iconUrl: '/app/x/i.png', name: 'L' })).toBe('');
    expect(storeBootScreenHtml({ background: '#000000', iconUrl: 'https://evil/x.png', name: 'L' })).toBe('');
  });

  it('splash com a marca do Delivery Channel (experimento) desligada por padrão', () => {
    expect(DEFAULT_SPLASH_TEST_SLUGS).toEqual([]);
    expect(resolveSplashTestSlugs({})).toEqual([]);
  });

  it('marca inline do painel é o mesmo desenho de public/icon-512.svg', () => {
    const file = fs.readFileSync(path.resolve(__dirname, '../../../public/icon-512.svg'), 'utf8');
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(norm(DC_MARK_SVG)).toBe(norm(file));
  });
});

import express from 'express';
import type { AddressInfo } from 'node:net';
import { createPwaRouter } from '../routes';

describe('HTML usa a última leitura da loja na hora (stale-while-revalidate); manifesto segue fresco', () => {
  it('serve o cache vencido ao HTML e atualiza em segundo plano; uma consulta por vez', async () => {
    let calls = 0; let name = 'Loja A';
    let release: () => void = () => undefined;
    const resolveStore = async (slug: string) => {
      calls++;
      if (calls > 1) await new Promise<void>((r) => { release = r; });
      return { status: 'ok' as const, store: { id: 't1', slug, name, theme: { storeName: name } } };
    };
    const router = createPwaRouter({ resolveStore, publicDir: '/nonexistent', ttlMs: 0, htmlStaleMs: 60_000 });
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('Loja A');
    name = 'Loja B';
    // vencido (ttl 0) mas dentro do stale: devolve na hora sem esperar a consulta nova
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('Loja A');
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('Loja A');
    expect(calls).toBe(2);
    release();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('Loja B');
  });

  it('sem cache ou além do stale, espera a consulta (como antes)', async () => {
    let calls = 0;
    const resolveStore = async (slug: string) => { calls++; return { status: 'ok' as const, store: { id: 't1', slug, name: `v${calls}` } }; };
    const router = createPwaRouter({ resolveStore, publicDir: '/nonexistent', ttlMs: 0, htmlStaleMs: 0 });
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('v1');
    expect((await router.lookupStoreForHtml('loja-a'))?.name).toBe('v2');
    expect((await router.lookupStore('loja-a'))?.name).toBe('v3');
  });

  it('slug inválido nunca consulta', async () => {
    let calls = 0;
    const router = createPwaRouter({ resolveStore: async () => { calls++; return { status: 'not_found' as const }; }, publicDir: '/nonexistent' });
    expect(await router.lookupStoreForHtml('../x')).toBeNull();
    expect(calls).toBe(0);
  });
});
